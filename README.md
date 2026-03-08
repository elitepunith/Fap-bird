# 🐦 Fap-Bird

Flappy Bird using the original pixel-art sprite assets — fullscreen, mobile responsive.

## Project Structure

```
fap-bird/
├── index.html        ← entry point
├── style.css         ← fullscreen CSS transform scaling
├── game.js           ← entire game engine
├── vercel.json       ← static deploy config
├── img/
│   ├── BG.png        ← background (276×228)
│   ├── ground.png    ← ground strip (552×112)
│   ├── toppipe.png   ← top pipe (52×400)
│   ├── botpipe.png   ← bottom pipe (52×400)
│   ├── getready.png  ← "Get Ready" UI (174×160)
│   └── go.png        ← "Game Over" UI (188×144)
└── sfx/
    ├── start.wav
    ├── flap.wav
    ├── score.wav
    ├── hit.wav
    └── die.wav
```

> Bird sprites (b0/b1/b2) are drawn with Canvas API — no extra files needed.

## How Fullscreen Works

The canvas stays at its native **276×414** resolution (matching the sprite assets).
A CSS `transform: scale(N)` makes it fill the screen on any device without stretching.
This keeps every pixel crisp and no sprite coordinates need to change.

## Controls

| Input           | Action |
|----------------|--------|
| Click / Tap     | Flap   |
| Space / W / ↑   | Flap   |
| Enter           | Flap   |

## Deploy to Vercel

```bash
# Option A — CLI
npm i -g vercel
cd fap-bird && vercel

# Option B — GitHub
# Push this folder → vercel.com → New Project → Other framework → Deploy
```
