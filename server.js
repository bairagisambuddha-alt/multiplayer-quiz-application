const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const questions = require("./data/questions.json");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const rooms = new Map();

app.use(express.static(path.join(__dirname, "public")));

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 6 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join("");
  } while (rooms.has(code));
  return code;
}

function sanitizeName(name) {
  return String(name || "Player").trim().slice(0, 20) || "Player";
}

function getPublicPlayers(room) {
  return room.players.map((player) => ({
    id: player.id,
    name: player.name,
    score: player.score,
    answered: player.answered
  }));
}

function shuffledQuestions(topic, difficulty, count) {
  let pool = questions.filter((q) => {
    const topicMatch = topic === "Mixed" || q.topic === topic;
    const difficultyMatch = difficulty === "Mixed" || q.difficulty === difficulty;
    return topicMatch && difficultyMatch;
  });

  if (pool.length < count) {
    pool = questions.filter((q) => topic === "Mixed" || q.topic === topic);
  }

  return [...pool]
    .sort(() => Math.random() - 0.5)
    .slice(0, Math.min(count, pool.length))
    .map((q) => ({
      ...q,
      options: [...q.options]
    }));
}

function roomSnapshot(room) {
  return {
    code: room.code,
    players: getPublicPlayers(room),
    status: room.status,
    hostId: room.hostId,
    settings: room.settings
  };
}

function broadcastRoom(room) {
  io.to(room.code).emit("room-update", roomSnapshot(room));
}

function clearRoomTimer(room) {
  if (room.timer) clearInterval(room.timer);
  room.timer = null;
}

function finishQuiz(room) {
  clearRoomTimer(room);
  room.status = "finished";

  const sorted = [...room.players].sort((a, b) => b.score - a.score);
  let winnerId = null;
  let resultText = "It is a tie!";

  if (sorted.length > 1 && sorted[0].score !== sorted[1].score) {
    winnerId = sorted[0].id;
    resultText = `${sorted[0].name} wins!`;
  }

  io.to(room.code).emit("quiz-finished", {
    players: getPublicPlayers(room),
    winnerId,
    resultText
  });

  broadcastRoom(room);
}

function sendQuestion(room) {
  if (room.currentQuestionIndex >= room.quizQuestions.length) {
    finishQuiz(room);
    return;
  }

  room.players.forEach((player) => {
    player.answered = false;
    player.answerIndex = null;
    player.answerTime = null;
  });

  const question = room.quizQuestions[room.currentQuestionIndex];
  room.timeLeft = room.settings.timePerQuestion;

  io.to(room.code).emit("question-start", {
    number: room.currentQuestionIndex + 1,
    total: room.quizQuestions.length,
    prompt: question.prompt,
    options: question.options,
    topic: question.topic,
    difficulty: question.difficulty,
    timeLeft: room.timeLeft,
    players: getPublicPlayers(room)
  });

  clearRoomTimer(room);
  room.timer = setInterval(() => {
    room.timeLeft -= 1;
    io.to(room.code).emit("timer", { timeLeft: room.timeLeft });

    if (room.timeLeft <= 0) {
      revealAnswer(room);
    }
  }, 1000);
}

function revealAnswer(room) {
  if (room.status !== "playing") return;

  clearRoomTimer(room);
  const question = room.quizQuestions[room.currentQuestionIndex];

  io.to(room.code).emit("answer-reveal", {
    correctIndex: question.correctIndex,
    explanation: question.explanation,
    players: getPublicPlayers(room)
  });

  setTimeout(() => {
    if (room.status !== "playing") return;
    room.currentQuestionIndex += 1;
    sendQuestion(room);
  }, 3500);
}

io.on("connection", (socket) => {
  socket.on("create-room", ({ name, settings }, callback) => {
    const code = generateRoomCode();
    const player = {
      id: socket.id,
      name: sanitizeName(name),
      score: 0,
      answered: false,
      answerIndex: null,
      answerTime: null
    };

    const normalizedSettings = {
      topic: settings?.topic || "Mixed",
      difficulty: settings?.difficulty || "Mixed",
      questionCount: Math.max(3, Math.min(Number(settings?.questionCount) || 5, 10)),
      timePerQuestion: Math.max(10, Math.min(Number(settings?.timePerQuestion) || 20, 30))
    };

    const room = {
      code,
      hostId: socket.id,
      players: [player],
      status: "waiting",
      currentQuestionIndex: 0,
      quizQuestions: [],
      timer: null,
      timeLeft: normalizedSettings.timePerQuestion,
      settings: normalizedSettings
    };

    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    callback?.({ success: true, room: roomSnapshot(room) });
  });

  socket.on("join-room", ({ code, name }, callback) => {
    const normalizedCode = String(code || "").trim().toUpperCase();
    const room = rooms.get(normalizedCode);

    if (!room) {
      callback?.({ success: false, message: "Room not found." });
      return;
    }

    if (room.status !== "waiting") {
      callback?.({ success: false, message: "The quiz has already started." });
      return;
    }

    if (room.players.length >= 2) {
      callback?.({ success: false, message: "This room already has two players." });
      return;
    }

    room.players.push({
      id: socket.id,
      name: sanitizeName(name),
      score: 0,
      answered: false,
      answerIndex: null,
      answerTime: null
    });

    socket.join(normalizedCode);
    socket.data.roomCode = normalizedCode;
    callback?.({ success: true, room: roomSnapshot(room) });
    broadcastRoom(room);
  });

  socket.on("start-quiz", ({ code }, callback) => {
    const room = rooms.get(String(code || "").toUpperCase());

    if (!room) {
      callback?.({ success: false, message: "Room not found." });
      return;
    }

    if (socket.id !== room.hostId) {
      callback?.({ success: false, message: "Only the host can start the quiz." });
      return;
    }

    if (room.players.length !== 2) {
      callback?.({ success: false, message: "Two players are required." });
      return;
    }

    room.quizQuestions = shuffledQuestions(
      room.settings.topic,
      room.settings.difficulty,
      room.settings.questionCount
    );

    if (room.quizQuestions.length < 3) {
      callback?.({ success: false, message: "Not enough questions for those settings." });
      return;
    }

    room.status = "playing";
    room.currentQuestionIndex = 0;
    room.players.forEach((player) => {
      player.score = 0;
      player.answered = false;
    });

    callback?.({ success: true });
    broadcastRoom(room);
    sendQuestion(room);
  });

  socket.on("submit-answer", ({ code, answerIndex }, callback) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room || room.status !== "playing") return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player || player.answered) {
      callback?.({ success: false, message: "Answer already submitted." });
      return;
    }

    const question = room.quizQuestions[room.currentQuestionIndex];
    player.answered = true;
    player.answerIndex = Number(answerIndex);
    player.answerTime = room.timeLeft;

    const isCorrect = player.answerIndex === question.correctIndex;
    let points = 0;

    if (isCorrect) {
      const speedBonus = Math.max(0, room.timeLeft) * 25;
      points = 500 + speedBonus;
      player.score += points;
    }

    socket.emit("answer-received", { isCorrect, points });
    io.to(room.code).emit("players-status", {
      players: getPublicPlayers(room)
    });

    callback?.({ success: true });

    if (room.players.length === 2 && room.players.every((p) => p.answered)) {
      setTimeout(() => revealAnswer(room), 700);
    }
  });

  socket.on("play-again", ({ code }, callback) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room) return;

    if (socket.id !== room.hostId) {
      callback?.({ success: false, message: "Only the host can restart." });
      return;
    }

    clearRoomTimer(room);
    room.status = "waiting";
    room.currentQuestionIndex = 0;
    room.quizQuestions = [];
    room.players.forEach((player) => {
      player.score = 0;
      player.answered = false;
    });

    callback?.({ success: true });
    broadcastRoom(room);
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    if (!code) return;

    const room = rooms.get(code);
    if (!room) return;

    room.players = room.players.filter((p) => p.id !== socket.id);

    if (room.players.length === 0) {
      clearRoomTimer(room);
      rooms.delete(code);
      return;
    }

    if (room.hostId === socket.id) {
      room.hostId = room.players[0].id;
    }

    if (room.status === "playing") {
      clearRoomTimer(room);
      room.status = "waiting";
      room.currentQuestionIndex = 0;
      room.players.forEach((player) => {
        player.score = 0;
        player.answered = false;
      });
      io.to(code).emit("opponent-left", {
        message: "Your opponent disconnected. The room has returned to the lobby."
      });
    }

    broadcastRoom(room);
  });
});

server.listen(PORT, () => {
  console.log(`Quiz Duel is running at http://localhost:${PORT}`);
});
