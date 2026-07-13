# Quiz Duel

A real-time 1-vs-1 Kahoot-style quiz application with a Node.js backend and responsive frontend.

## Features

- Create a private six-character room
- Join with a room code
- Exactly two players per room
- Live questions using Socket.IO
- Countdown timer
- Speed-based scoring
- Topic, difficulty, question count and timer settings
- Real-time score updates
- Correct-answer reveal and explanation
- Winner screen and replay
- Responsive mobile and desktop interface

## Technology

- Node.js
- Express
- Socket.IO
- HTML
- CSS
- Vanilla JavaScript

## Run locally

1. Install Node.js 18 or later.
2. Open a terminal in this project folder.
3. Run:

```bash
npm install
npm start
```

4. Open:

```text
http://localhost:3000
```

5. To test multiplayer locally, open the app in two different browser windows or use one normal window and one incognito window.

## Development mode

```bash
npm run dev
```

## Project structure

```text
quiz-duel-app/
├── data/
│   └── questions.json
├── public/
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── package.json
├── README.md
└── server.js
```

## Add questions

Edit `data/questions.json`. Each question uses this format:

```json
{
  "topic": "Science",
  "difficulty": "Easy",
  "prompt": "Question text",
  "options": ["A", "B", "C", "D"],
  "correctIndex": 0,
  "explanation": "Why the answer is correct."
}
```

`correctIndex` starts from zero.

## Deploy

This app can be deployed to services that support persistent Node.js WebSocket connections, such as Render, Railway, Fly.io or an AWS server.

Set the start command to:

```bash
npm start
```

The server automatically uses the `PORT` environment variable supplied by the hosting platform.
