# 🐦 Fap-Bird

A Flappy Bird clone with a neon night-city aesthetic.
No images, no sound files — everything is drawn and generated with code.

## Project Structure

```
fap-bird/
├── index.html      ← entry point, minimal markup
├── style.css       ← fullscreen layout + CRT scanline overlay
├── game.js         ← entire game (canvas drawing, physics, audio)
├── vercel.json     ← static deployment config
└── README.md       ← you're here
```

## Features

- **Zero external assets** — sprites drawn with Canvas API, sounds via Web Audio API
- **Night city parallax** — two-layer scrolling skyline with lit windows + moon
- **Particle effects** — flap puffs, death explosion
- **Screen shake** on collision
- **High score** saved in localStorage
- **Progressive difficulty** — pipes get faster every 5 points
- **Mobile responsive** — touch input, fills screen on any device
- **Keyboard support** — Space / W / ↑ / Enter

## Controls

| Input        | Action     |
|-------------|------------|
| Click / Tap  | Flap       |
| Space        | Flap       |
| W or ↑       | Flap       |
| Enter        | Flap       |

## Deploy to Vercel

### Option A — Vercel CLI (fastest)
```bash
npm i -g vercel
cd fap-bird
vercel
# follow prompts, it'll detect static and deploy instantly
```

### Option B — Vercel Dashboard (no CLI)
1. Push this folder to a GitHub repo
2. Go to vercel.com → New Project → Import repo
3. Framework preset: **Other**
4. Root directory: leave as-is
5. Click Deploy ✓

That's it — no build step, no dependencies.

## Local Development

Just open `index.html` in a browser.
Or use any static server:
```bash
npx serve .
# or
python3 -m http.server 3000
```
