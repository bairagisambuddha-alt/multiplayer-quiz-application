const socket = io();

const screens = document.querySelectorAll(".screen");
const toast = document.getElementById("toast");

let currentRoom = null;
let currentUserId = null;
let currentQuestion = null;
let selectedAnswer = null;
let lastPlayers = [];

function showScreen(id) {
  screens.forEach((screen) => {
    screen.classList.toggle("active", screen.id === id);
  });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2400);
}

function initials(name) {
  return String(name || "?")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function renderLobby(room) {
  currentRoom = room;
  lastPlayers = room.players;

  document.getElementById("lobby-code").textContent = room.code;
  document.getElementById("lobby-settings").textContent =
    `${room.settings.topic} • ${room.settings.difficulty} • ${room.settings.questionCount} questions • ${room.settings.timePerQuestion}s each`;

  const container = document.getElementById("lobby-players");
  container.innerHTML = room.players
    .map(
      (player) => `
      <div class="player-card">
        <div class="player-avatar">${initials(player.name)}</div>
        <strong>${escapeHtml(player.name)}</strong>
        <div class="muted">${player.id === room.hostId ? "Host" : "Challenger"}</div>
      </div>`
    )
    .join("");

  if (room.players.length < 2) {
    container.innerHTML += `
      <div class="player-card">
        <div class="player-avatar">?</div>
        <strong>Waiting...</strong>
        <div class="muted">Opponent slot</div>
      </div>`;
  }

  const isHost = socket.id === room.hostId;
  const ready = room.players.length === 2;

  document.getElementById("waiting-message").classList.toggle("hidden", ready);
  document.getElementById("start-quiz").classList.toggle("hidden", !isHost || !ready);
  showScreen("lobby-screen");
}

function renderScoreboard(players) {
  lastPlayers = players;
  document.getElementById("scoreboard").innerHTML = players
    .map(
      (player) => `
      <div class="score-pill ${player.answered ? "answered" : ""}">
        <span>${player.id === socket.id ? "You" : escapeHtml(player.name)}</span>
        <strong>${player.score.toLocaleString()} pts</strong>
      </div>`
    )
    .join("");
}

function setAnswerButtonsDisabled(disabled) {
  document.querySelectorAll(".answer-button").forEach((button) => {
    button.disabled = disabled;
  });
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

document.getElementById("show-create").addEventListener("click", () => {
  showScreen("create-screen");
});

document.getElementById("show-join").addEventListener("click", () => {
  showScreen("join-screen");
});

document.querySelectorAll("[data-back]").forEach((button) => {
  button.addEventListener("click", () => showScreen("home-screen"));
});

document.getElementById("create-form").addEventListener("submit", (event) => {
  event.preventDefault();

  const payload = {
    name: document.getElementById("create-name").value,
    settings: {
      topic: document.getElementById("topic").value,
      difficulty: document.getElementById("difficulty").value,
      questionCount: Number(document.getElementById("question-count").value),
      timePerQuestion: Number(document.getElementById("question-time").value)
    }
  };

  socket.emit("create-room", payload, (response) => {
    if (!response.success) {
      showToast(response.message);
      return;
    }

    currentUserId = socket.id;
    renderLobby(response.room);
  });
});

document.getElementById("join-form").addEventListener("submit", (event) => {
  event.preventDefault();

  socket.emit(
    "join-room",
    {
      name: document.getElementById("join-name").value,
      code: document.getElementById("room-code-input").value
    },
    (response) => {
      if (!response.success) {
        showToast(response.message);
        return;
      }

      currentUserId = socket.id;
      renderLobby(response.room);
    }
  );
});

document.getElementById("copy-code").addEventListener("click", async () => {
  if (!currentRoom) return;

  try {
    await navigator.clipboard.writeText(currentRoom.code);
    showToast("Room code copied.");
  } catch {
    showToast(`Room code: ${currentRoom.code}`);
  }
});

document.getElementById("start-quiz").addEventListener("click", () => {
  socket.emit("start-quiz", { code: currentRoom.code }, (response) => {
    if (!response.success) showToast(response.message);
  });
});

document.getElementById("play-again").addEventListener("click", () => {
  socket.emit("play-again", { code: currentRoom.code }, (response) => {
    if (!response.success) showToast(response.message);
  });
});

document.getElementById("return-home").addEventListener("click", () => {
  window.location.reload();
});

socket.on("room-update", (room) => {
  currentRoom = room;

  if (room.status === "waiting") {
    renderLobby(room);
  }
});

socket.on("question-start", (data) => {
  currentQuestion = data;
  selectedAnswer = null;

  document.getElementById("question-counter").textContent =
    `Question ${data.number} of ${data.total}`;
  document.getElementById("progress-fill").style.width =
    `${(data.number / data.total) * 100}%`;
  document.getElementById("question-topic").textContent = data.topic;
  document.getElementById("question-difficulty").textContent = data.difficulty;
  document.getElementById("question-text").textContent = data.prompt;
  document.getElementById("timer-value").textContent = data.timeLeft;
  document.getElementById("timer-circle").classList.remove("urgent");

  const feedback = document.getElementById("answer-feedback");
  feedback.className = "feedback hidden";
  feedback.textContent = "";

  const answersGrid = document.getElementById("answers-grid");
  answersGrid.innerHTML = data.options
    .map(
      (option, index) => `
      <button class="answer-button" data-index="${index}">
        ${String.fromCharCode(65 + index)}. ${escapeHtml(option)}
      </button>`
    )
    .join("");

  document.querySelectorAll(".answer-button").forEach((button) => {
    button.addEventListener("click", () => {
      if (selectedAnswer !== null) return;

      selectedAnswer = Number(button.dataset.index);
      button.classList.add("selected");
      setAnswerButtonsDisabled(true);

      socket.emit(
        "submit-answer",
        {
          code: currentRoom.code,
          answerIndex: selectedAnswer
        },
        (response) => {
          if (!response.success) showToast(response.message);
        }
      );
    });
  });

  renderScoreboard(data.players);
  showScreen("quiz-screen");
});

socket.on("timer", ({ timeLeft }) => {
  document.getElementById("timer-value").textContent = timeLeft;
  document.getElementById("timer-circle").classList.toggle("urgent", timeLeft <= 5);
});

socket.on("answer-received", ({ isCorrect, points }) => {
  const feedback = document.getElementById("answer-feedback");
  feedback.classList.remove("hidden", "success", "error");
  feedback.classList.add(isCorrect ? "success" : "error");
  feedback.textContent = isCorrect
    ? `Correct! +${points.toLocaleString()} points`
    : "Answer locked. Wait for the reveal.";
});

socket.on("players-status", ({ players }) => {
  renderScoreboard(players);
});

socket.on("answer-reveal", ({ correctIndex, explanation, players }) => {
  setAnswerButtonsDisabled(true);

  document.querySelectorAll(".answer-button").forEach((button) => {
    const index = Number(button.dataset.index);
    button.classList.remove("selected");

    if (index === correctIndex) {
      button.classList.add("correct");
    } else {
      button.classList.add("wrong");
    }
  });

  const feedback = document.getElementById("answer-feedback");
  feedback.classList.remove("hidden");
  feedback.textContent = explanation;
  renderScoreboard(players);
});

socket.on("quiz-finished", ({ players, winnerId, resultText }) => {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const isWinner = winnerId === socket.id;
  const isTie = winnerId === null;

  document.getElementById("result-icon").textContent = isTie ? "🤝" : isWinner ? "🏆" : "🎯";
  document.getElementById("result-title").textContent =
    isTie ? "It is a tie!" : isWinner ? "You won!" : resultText;

  document.getElementById("final-scores").innerHTML = sorted
    .map(
      (player, index) => `
      <div class="final-score-row ${player.id === winnerId ? "winner" : ""}">
        <span>${index + 1}. ${player.id === socket.id ? "You" : escapeHtml(player.name)}</span>
        <strong>${player.score.toLocaleString()} pts</strong>
      </div>`
    )
    .join("");

  const isHost = currentRoom && socket.id === currentRoom.hostId;
  document.getElementById("play-again").classList.toggle("hidden", !isHost);
  showScreen("result-screen");
});

socket.on("opponent-left", ({ message }) => {
  showToast(message);
});

socket.on("connect", () => {
  currentUserId = socket.id;
});
