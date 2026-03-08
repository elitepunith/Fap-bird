/*
  fap-bird — game.js
  ==================

  A Flappy Bird clone using the original pixel-art sprites.

  Architecture overview:
  - Canvas stays at 276×414 (native sprite resolution) internally
  - CSS transform scales it fullscreen — no game logic changes needed
  - requestAnimationFrame for smooth 60fps (no more setInterval drift)
  - Background + ground are pre-rendered to offscreen canvases once on boot
    → this kills the lag (no gradient math every frame)
  - Bird drawn with canvas API — 4 frame wing flap animation
  - Screen shake + particles for game feel

  Asset paths: assets/images/ and assets/sfx/
  (matching the repo's assets/ folder structure)
*/

'use strict';

// ─── CANVAS SETUP ─────────────────────────────────────────────────────────────

// The game always thinks it's 276×414 — the CSS scale handles the rest
const GAME_W = 276;
const GAME_H = 414;

const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');

canvas.width  = GAME_W;
canvas.height = GAME_H;

// Work out what CSS scale fills the screen while keeping the aspect ratio.
// Called once on load and again whenever the window resizes.
function fitToScreen() {
  const scaleX = window.innerWidth  / GAME_W;
  const scaleY = window.innerHeight / GAME_H;
  const scale  = Math.min(scaleX, scaleY); // never clip — letterbox if needed
  canvas.style.transform = `scale(${scale})`;
}

window.addEventListener('resize', fitToScreen);
fitToScreen();


// ─── ASSET PATHS ──────────────────────────────────────────────────────────────
// All in assets/ so they match the GitHub repo folder layout

const ASSET = {
  images: {
    bg      : 'assets/images/BG.png',
    ground  : 'assets/images/ground.png',
    toppipe : 'assets/images/toppipe.png',
    botpipe : 'assets/images/botpipe.png',
    getReady: 'assets/images/getready.png',
    gameOver: 'assets/images/go.png',
  },
  sfx: {
    start : 'assets/sfx/start.wav',
    flap  : 'assets/sfx/flap.wav',
    score : 'assets/sfx/score.wav',
    hit   : 'assets/sfx/hit.wav',
    die   : 'assets/sfx/die.wav',
  },
};


// ─── IMAGE + SOUND LOADERS ────────────────────────────────────────────────────

// Simple image loader — marks the image as loaded/missing so we can
// fall back gracefully without throwing errors
function loadImg(src) {
  const img    = new Image();
  img.ready    = false;  // true once loaded (or failed)
  img.missing  = false;
  img.onload   = () => { img.ready = true; };
  img.onerror  = () => { img.ready = true; img.missing = true; console.warn('Missing:', src); };
  img.src      = src;
  return img;
}

// Sound loader — uses the clone trick so the same sound can play
// multiple times overlapping (important for rapid flapping)
function loadSound(src) {
  const audio  = new Audio(src);
  audio.preload = 'auto';
  return {
    play(vol = 0.6) {
      try {
        const clone = audio.cloneNode();
        clone.volume = vol;
        // modern browsers require a user gesture first — catch silently
        clone.play().catch(() => {});
      } catch (_) {}
    }
  };
}

// Load everything up
const sprites = {
  bg      : loadImg(ASSET.images.bg),
  ground  : loadImg(ASSET.images.ground),
  toppipe : loadImg(ASSET.images.toppipe),
  botpipe : loadImg(ASSET.images.botpipe),
  getReady: loadImg(ASSET.images.getReady),
  gameOver: loadImg(ASSET.images.gameOver),
};

const sfx = {
  start : loadSound(ASSET.sfx.start),
  flap  : loadSound(ASSET.sfx.flap),
  score : loadSound(ASSET.sfx.score),
  hit   : loadSound(ASSET.sfx.hit),
  die   : loadSound(ASSET.sfx.die),
};


// ─── OFFSCREEN CACHES ─────────────────────────────────────────────────────────
//
// This is the main performance fix vs the original.
// Instead of drawing the background each frame (which means iterating
// gradients, arcs, etc. 60 times per second), we draw it ONCE to an
// offscreen canvas when the assets load, then just blit that every frame.
//
// Same for the ground strip — pre-render it once, scroll by adjusting
// the draw X position.

const bgOffscreen     = document.createElement('canvas');
const groundOffscreen = document.createElement('canvas');

bgOffscreen.width     = GAME_W;
bgOffscreen.height    = GAME_H;
groundOffscreen.width = GAME_W * 3;  // 3× wide so there's never a gap while scrolling
groundOffscreen.height = 112;        // matches ground.png height

let cachesBuilt = false;

function buildOffscreenCaches() {
  // ── background ──────────────────────────────────────────────────────────────
  //
  // BG.png is 276×228 — not tall enough on its own for a 414px canvas.
  // Draw it anchored to the bottom (just above the ground), then fill the
  // sky above it with a gradient that matches the sprite's top edge colour.

  const bgCtx  = bgOffscreen.getContext('2d');
  const bgImg  = sprites.bg;
  const BG_H   = bgImg.missing ? 228 : bgImg.naturalHeight || 228;
  const bgY    = GAME_H - 112 - BG_H;  // sit BG right above the ground

  // sky gradient — sampled from the sprite's top edge (#4ec0ca ish)
  const skyGrad = bgCtx.createLinearGradient(0, 0, 0, bgY + 20);
  skyGrad.addColorStop(0,   '#3ab4cc');
  skyGrad.addColorStop(0.6, '#4ec0ca');
  skyGrad.addColorStop(1,   '#5dcfd8');
  bgCtx.fillStyle = skyGrad;
  bgCtx.fillRect(0, 0, GAME_W, bgY + 20);

  // draw the actual BG sprite
  if (!bgImg.missing) {
    bgCtx.drawImage(bgImg, 0, bgY, GAME_W, BG_H);
  }

  // ── ground ──────────────────────────────────────────────────────────────────
  //
  // ground.png is 552×112 — exactly 2× the canvas width.
  // Tile it 3× across the offscreen canvas so we can always shift by
  // one full width and never show a gap.

  const gCtx  = groundOffscreen.getContext('2d');
  const gImg  = sprites.ground;
  const GW    = gImg.missing ? 552 : gImg.naturalWidth  || 552;
  const GH    = gImg.missing ? 112 : gImg.naturalHeight || 112;

  if (!gImg.missing) {
    // tile it 3 times across
    for (let i = 0; i < 3; i++) {
      gCtx.drawImage(gImg, i * GW, 0);
    }
  } else {
    // fallback ground if sprite didn't load
    const dirtGrad = gCtx.createLinearGradient(0, 0, 0, GH);
    dirtGrad.addColorStop(0,   '#c8a060');
    dirtGrad.addColorStop(0.2, '#b08040');
    dirtGrad.addColorStop(1,   '#8a6030');
    gCtx.fillStyle = dirtGrad;
    gCtx.fillRect(0, 0, GAME_W * 3, GH);
    gCtx.fillStyle = '#5aad3a';
    gCtx.fillRect(0, 0, GAME_W * 3, 18);
    gCtx.fillStyle = '#72cc50';
    gCtx.fillRect(0, 0, GAME_W * 3, 6);
  }

  cachesBuilt = true;
}


// ─── GAME STATE ───────────────────────────────────────────────────────────────

const STATE = {
  READY : 0,  // waiting for first tap — bird bobs, no pipes
  PLAY  : 1,  // actively playing
  DEAD  : 2,  // game over — bird fell, showing score screen
};

let state      = STATE.READY;
let frameCount = 0;       // increments every game tick
let score      = 0;
let bestScore  = 0;
let scrollSpeed = 2.2;    // pixels per frame — increases with score
let deathSfxPlayed = false;


// ─── SCREEN SHAKE ─────────────────────────────────────────────────────────────
// Just offsetting the canvas context translation a tiny bit each frame.
// Simple but really sells the collision impact.

const shake = {
  x: 0, y: 0,
  intensity: 0,
  framesLeft: 0,

  trigger(intensity, duration) {
    this.intensity  = intensity;
    this.framesLeft = duration;
  },

  update() {
    if (this.framesLeft > 0) {
      this.x          = (Math.random() - 0.5) * this.intensity;
      this.y          = (Math.random() - 0.5) * this.intensity;
      this.intensity *= 0.85;   // dampen each frame
      this.framesLeft -= 1;
    } else {
      this.x = 0;
      this.y = 0;
    }
  },
};


// ─── PARTICLE SYSTEM ──────────────────────────────────────────────────────────
// Used for:
//  - small feather puffs when the bird flaps
//  - a burst explosion when the bird hits something
//  - little golden pop when passing a pipe

const particles = {
  pool: [],

  spawn(x, y, count, colours) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.7 + Math.random() * 3.2;
      this.pool.push({
        x, y,
        vx   : Math.cos(angle) * speed,
        vy   : Math.sin(angle) * speed - 1.4,  // slight upward bias feels better
        life : 1.0,
        decay: 0.04 + Math.random() * 0.045,
        size : 1.8 + Math.random() * 3.2,
        color: colours[Math.floor(Math.random() * colours.length)],
      });
    }
  },

  update() {
    // filter in-place — remove dead particles
    this.pool = this.pool.filter(p => {
      p.x    += p.vx;
      p.y    += p.vy;
      p.vy   += 0.17;   // gravity
      p.vx   *= 0.97;   // air resistance
      p.life -= p.decay;
      return p.life > 0;
    });
  },

  draw() {
    this.pool.forEach(p => {
      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.fillStyle   = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  },
};


// ─── BACKGROUND ───────────────────────────────────────────────────────────────

const background = {
  draw() {
    if (cachesBuilt) {
      ctx.drawImage(bgOffscreen, 0, 0);
    } else {
      // fallback while caches are being built (first frame or two)
      ctx.fillStyle = '#4ec0ca';
      ctx.fillRect(0, 0, GAME_W, GAME_H);
    }
  },
};


// ─── GROUND ───────────────────────────────────────────────────────────────────
// Scrolls left continuously using the pre-rendered offscreen ground strip.

const ground = {
  x      : 0,      // current scroll offset
  y      : GAME_H - 112,  // 302px from top — right at the bottom
  height : 112,
  GW     : 552,    // ground sprite width (updated when sprite loads)

  update() {
    if (state !== STATE.PLAY) return;
    this.x -= scrollSpeed;
    // reset when we've scrolled exactly one sprite width
    if (this.x <= -this.GW) this.x = 0;
  },

  draw() {
    if (cachesBuilt) {
      // draw from the pre-rendered 3× wide strip at offset x
      ctx.drawImage(
        groundOffscreen,
        -this.x, 0,     // source x/y
        GAME_W, this.height,   // source w/h
        0, this.y,      // dest x/y
        GAME_W, this.height    // dest w/h
      );
    } else {
      // dark green placeholder
      ctx.fillStyle = '#5aad3a';
      ctx.fillRect(0, this.y, GAME_W, this.height);
    }
  },
};


// ─── PIPES ────────────────────────────────────────────────────────────────────
// Uses toppipe.png (52×400) and botpipe.png (52×400).
// The gap between them is fixed at 85px — same as original.

const pipes = {
  list    : [],
  gap     : 85,    // vertical gap between top and bottom pipe
  PW      : 52,    // pipe width — matches sprite
  PH      : 400,   // pipe height — matches sprite
  timer   : 0,
  interval: 100,   // frames between pipe spawns

  reset() {
    this.list     = [];
    this.timer    = 0;
    this.interval = 100;
    scrollSpeed   = 2.2;
  },

  spawnPipe() {
    // y is negative — top pipe hangs from off-screen ceiling
    // same formula the original used, just slightly cleaned up
    const y = -210 * Math.min(Math.random() + 1, 1.8);
    this.list.push({
      x      : GAME_W + this.PW + 5,
      y,
      scored : false,  // track if we've given a point for this pipe
    });
  },

  update() {
    if (state !== STATE.PLAY) return;

    this.timer++;
    if (this.timer >= this.interval) {
      this.spawnPipe();
      this.timer = 0;
    }

    this.list.forEach(p => { p.x -= scrollSpeed; });

    // remove pipes that have fully scrolled off screen
    this.list = this.list.filter(p => p.x > -(this.PW + 10));
  },

  draw() {
    const topOk = sprites.toppipe.ready && !sprites.toppipe.missing;
    const botOk = sprites.botpipe.ready && !sprites.botpipe.missing;

    this.list.forEach(p => {
      const topPipeBottom = p.y + this.PH;           // bottom edge of top pipe
      const botPipeTop    = topPipeBottom + this.gap; // top edge of bottom pipe

      if (topOk && botOk) {
        ctx.drawImage(sprites.toppipe, p.x, p.y);
        ctx.drawImage(sprites.botpipe, p.x, botPipeTop);
      } else {
        // canvas fallback pipe (shouldn't happen, but just in case)
        this.drawFallbackPipe(p.x, topPipeBottom, botPipeTop);
      }
    });
  },

  // fallback pipe drawn with canvas gradients — not needed if sprites load fine
  drawFallbackPipe(x, topH, botY) {
    const w  = this.PW;
    const cX = x - 3;
    const cW = w + 6;

    const grad = ctx.createLinearGradient(x, 0, x + w, 0);
    grad.addColorStop(0,   '#1a6b1a');
    grad.addColorStop(0.3, '#45d445');
    grad.addColorStop(0.7, '#2eaa2e');
    grad.addColorStop(1,   '#1a6b1a');

    ctx.fillStyle = grad;
    ctx.fillRect(x, 0,     w, topH - 16);
    ctx.fillStyle = '#2ecc2e';
    ctx.fillRect(cX, topH - 16, cW, 16);
    ctx.fillStyle = '#2ecc2e';
    ctx.fillRect(cX, botY, cW, 16);
    ctx.fillStyle = grad;
    ctx.fillRect(x, botY + 16, w, ground.y - botY - 16);
  },

  // Returns true if the bird is colliding with any pipe.
  // Uses a slightly shrunk hitbox (80%) — the original was very tight
  // and people complained it felt unfair.
  checkCollision(bx, by, br) {
    const r = br * 0.8;

    for (let i = 0; i < this.list.length; i++) {
      const p    = this.list[i];
      const roof = p.y + this.PH;         // bottom of top pipe
      const floor= roof + this.gap;       // top of bottom pipe

      const hitHorizontally = bx + r > p.x && bx - r < p.x + this.PW;

      if (hitHorizontally) {
        if (by - r < roof || by + r > floor) {
          return true; // ouch
        }
      }

      // award a point when the bird clears the pipe
      if (!p.scored && bx - r > p.x + this.PW) {
        p.scored = true;
        score++;
        sfx.score.play();

        // golden pop particles
        particles.spawn(bx + 20, by - br, 8, ['#FFD700', '#FFFFFF', '#FFA500']);

        // gradually speed things up every 5 points
        if (score % 5 === 0) {
          scrollSpeed = Math.min(scrollSpeed + 0.22, 4.8);
          this.interval = Math.max(this.interval - 3, 72);
        }
      }
    }

    return false;
  },
};


// ─── BIRD ─────────────────────────────────────────────────────────────────────
// Drawn entirely with canvas — no bird sprite sheets needed.
// The original game had separate b0/b1/b2 PNG files; here we replicate
// the yellow flappy bird look with just canvas paths.
//
// Physics constants are kept identical to the original so it "feels" right.

const bird = {
  x       : 60,
  y       : 150,
  vy      : 0,       // vertical velocity (pixels per frame)
  rotation: 0,       // degrees — positive = nose down
  frame   : 0,       // 0-3 animation cycle
  wingAng : 0,       // wing flap angle (radians)
  wingDir : 1,       // +1 or -1 — controls flap direction
  alive   : true,
  r       : 12,      // collision + drawing radius

  // exact physics from the original
  gravity : 0.125,
  thrust  : 3.6,

  reset() {
    this.x        = 60;
    this.y        = 150;
    this.vy       = 0;
    this.rotation = 0;
    this.frame    = 0;
    this.alive    = true;
  },

  flap() {
    if (!this.alive) return;
    if (this.y <= this.r) return;  // already at ceiling

    sfx.flap.play(0.5);
    this.vy = -this.thrust;

    // little feather puff behind the bird on flap
    particles.spawn(
      this.x - this.r, this.y + 4, 5,
      ['#ffffff', '#ffe066', '#ffd000']
    );
  },

  // same rotation formula as original — nose down when falling, nose up when rising
  updateRotation() {
    if (this.vy <= 0) {
      this.rotation = Math.max(-25, (-25 * this.vy) / (-1 * this.thrust));
    } else {
      this.rotation = Math.min(90,  (90  * this.vy) / (this.thrust * 2));
    }
  },

  update() {
    // wing flap animation — runs at all times (even on menu screen)
    this.wingAng += 0.2 * this.wingDir;
    if (Math.abs(this.wingAng) > 0.55) this.wingDir *= -1;
    if (frameCount % 5 === 0) this.frame = (this.frame + 1) % 4;

    switch (state) {
      case STATE.READY:
        // idle bob while waiting
        this.rotation = 0;
        if (frameCount % 10 === 0) {
          this.y += Math.sin(frameCount * (Math.PI / 180));
        }
        break;

      case STATE.PLAY:
        this.vy += this.gravity;
        this.y  += this.vy;
        this.updateRotation();

        // hit the ceiling
        if (this.y - this.r < 0) {
          this.y  = this.r;
          this.vy = 0;
        }

        // hit the ground
        if (this.y + this.r >= ground.y) {
          this.y = ground.y - this.r;
          this.die();
          return;
        }

        // hit a pipe
        if (pipes.checkCollision(this.x, this.y, this.r)) {
          this.die();
        }
        break;

      case STATE.DEAD:
        // keep falling until we land
        if (this.y + this.r < ground.y) {
          this.vy += this.gravity * 2.2;
          this.y  += this.vy;
          this.rotation = 90;
        } else {
          this.vy       = 0;
          this.y        = ground.y - this.r;
          this.rotation = 90;

          // play the die sound once, only after landing
          if (!deathSfxPlayed) {
            sfx.die.play(0.6);
            deathSfxPlayed = true;
          }
        }
        break;
    }
  },

  die() {
    if (!this.alive) return;  // prevent double-triggering
    this.alive = false;

    sfx.hit.play(0.7);
    shake.trigger(7, 16);

    // big death explosion
    particles.spawn(this.x, this.y, 20, [
      '#FF5555', '#FF9900', '#FFE066', '#ffffff', '#88ff66', '#ff88aa'
    ]);

    // switch to DEAD state after a short delay so the fall animation plays first
    setTimeout(() => {
      state = STATE.DEAD;
      saveBestScore();
    }, 450);
  },

  draw() {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation * (Math.PI / 180));

    const r = this.r;

    // ── drop shadow ──────────────────────────────────────────────────────────
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.beginPath();
    ctx.ellipse(3, r * 0.85, r * 0.8, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // ── wing (behind body) ───────────────────────────────────────────────────
    ctx.save();
    ctx.rotate(this.wingAng);
    ctx.fillStyle = '#C87200';
    ctx.beginPath();
    ctx.ellipse(-r * 0.2, r * 0.06, r * 0.62, r * 0.27, -0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // ── body ─────────────────────────────────────────────────────────────────
    // radial gradient gives it a nice round, slightly lit look
    const bodyGrad = ctx.createRadialGradient(-r * 0.22, -r * 0.3, r * 0.08, 0, 0, r);
    bodyGrad.addColorStop(0,    '#FFE566');
    bodyGrad.addColorStop(0.5,  '#FFC800');
    bodyGrad.addColorStop(1,    '#C87A00');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // ── belly highlight ───────────────────────────────────────────────────────
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.beginPath();
    ctx.ellipse(r * 0.1, r * 0.28, r * 0.46, r * 0.32, 0.18, 0, Math.PI * 2);
    ctx.fill();

    // ── eye white ─────────────────────────────────────────────────────────────
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(r * 0.3, -r * 0.2, r * 0.34, 0, Math.PI * 2);
    ctx.fill();

    // ── pupil ─────────────────────────────────────────────────────────────────
    ctx.fillStyle = '#1a1025';
    ctx.beginPath();
    ctx.arc(r * 0.39, -r * 0.15, r * 0.17, 0, Math.PI * 2);
    ctx.fill();

    // ── eye shine ────────────────────────────────────────────────────────────
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(r * 0.46, -r * 0.23, r * 0.065, 0, Math.PI * 2);
    ctx.fill();

    // ── beak ─────────────────────────────────────────────────────────────────
    ctx.fillStyle = '#FF8C00';
    ctx.beginPath();
    ctx.moveTo(r * 0.56,  -r * 0.1);
    ctx.lineTo(r * 1.16,   r * 0.04);
    ctx.lineTo(r * 0.56,   r * 0.22);
    ctx.closePath();
    ctx.fill();

    // beak divider line
    ctx.strokeStyle = '#C05500';
    ctx.lineWidth   = 1.2;
    ctx.beginPath();
    ctx.moveTo(r * 0.58, r * 0.06);
    ctx.lineTo(r * 1.06, r * 0.06);
    ctx.stroke();

    ctx.restore();
  },
};


// ─── HUD ──────────────────────────────────────────────────────────────────────
// Score display during gameplay and on the game-over screen.
// Uses Press Start 2P font — matches the pixel art aesthetic perfectly.

const hud = {
  drawLiveScore() {
    ctx.save();
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.font         = '26px "Press Start 2P", monospace';

    // black outline/shadow — same trick as the original strokeText approach
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillText(score, GAME_W / 2 + 2, 28);

    ctx.fillStyle = '#ffffff';
    ctx.fillText(score, GAME_W / 2, 26);

    ctx.restore();
  },

  // the score panel that appears on the Game Over screen
  drawScorePanel() {
    const PW = 210;
    const PH = 64;
    const PX = (GAME_W - PW) / 2;
    const PY = GAME_H * 0.52;

    // panel background with rounded corners
    ctx.save();
    ctx.fillStyle = 'rgba(8, 8, 18, 0.72)';
    roundRect(PX, PY, PW, PH, 9);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth   = 1.5;
    roundRect(PX, PY, PW, PH, 9);
    ctx.stroke();

    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';

    // current score
    ctx.font      = '11px "Press Start 2P", monospace';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`SCORE  ${score}`, GAME_W / 2, PY + 20);

    // best score — gold with a glow
    ctx.font        = '11px "Press Start 2P", monospace';
    ctx.fillStyle   = '#FFD700';
    ctx.shadowColor = '#FFD700';
    ctx.shadowBlur  = 7;
    ctx.fillText(`BEST   ${bestScore}`, GAME_W / 2, PY + 44);
    ctx.shadowBlur  = 0;
    ctx.restore();
  },
};


// ─── UI SCREENS ───────────────────────────────────────────────────────────────
// GET READY  → uses getready.png sprite (174×160)
// GAME OVER  → uses go.png sprite (188×144) + score panel
// Tap hint is drawn with canvas — we don't have t0/t1 PNG files

const ui = {
  // animated tap/click hint — bobs up and down
  drawTapHint(x, y) {
    const bob   = Math.sin(frameCount * 0.1) * 5;
    const alpha = 0.55 + Math.sin(frameCount * 0.1) * 0.4;

    ctx.save();
    ctx.translate(x, y + bob);
    ctx.globalAlpha = alpha;

    // finger shape
    ctx.fillStyle   = 'rgba(255, 255, 255, 0.92)';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    roundRect(-8, -22, 18, 28, 9);
    ctx.fill();
    ctx.stroke();

    // fingernail detail
    ctx.fillStyle = 'rgba(210, 185, 160, 0.85)';
    ctx.beginPath();
    ctx.arc(1, -17, 5, Math.PI, 0);
    ctx.fill();

    // tap ripple (cycles every 32 frames)
    const ripple = (frameCount % 32) / 32;
    ctx.globalAlpha = (1 - ripple) * 0.45;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.arc(1, 3, ripple * 22, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  },

  drawGetReady() {
    const sp = sprites.getReady;

    if (sp.ready && !sp.missing) {
      // centre the getReady sprite vertically around 40% down
      const x = (GAME_W - sp.naturalWidth)  / 2;
      const y = GAME_H * 0.22;
      ctx.drawImage(sp, x, y);
    } else {
      // canvas fallback title
      ctx.save();
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      ctx.font         = '15px "Press Start 2P", monospace';
      ctx.fillStyle    = '#FFE000';
      ctx.shadowColor  = '#FF8800';
      ctx.shadowBlur   = 10;
      ctx.fillText('GET READY!', GAME_W / 2, GAME_H * 0.25);
      ctx.shadowBlur   = 0;
      ctx.restore();
    }

    this.drawTapHint(GAME_W / 2, GAME_H * 0.72);

    // best score reminder (only show if there's something to show)
    if (bestScore > 0) {
      ctx.save();
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.font         = '8px "Press Start 2P", monospace';
      ctx.fillStyle    = 'rgba(255, 255, 255, 0.65)';
      ctx.fillText(`BEST: ${bestScore}`, GAME_W / 2, GAME_H * 0.83);
      ctx.restore();
    }
  },

  drawGameOver() {
    const sp = sprites.gameOver;

    // dim overlay to make the sprites pop out more
    ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
    ctx.fillRect(0, 0, GAME_W, GAME_H);

    if (sp.ready && !sp.missing) {
      const x = (GAME_W - sp.naturalWidth)  / 2;
      const y = GAME_H * 0.22;
      ctx.drawImage(sp, x, y);
    } else {
      // canvas fallback
      ctx.save();
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      ctx.font         = '16px "Press Start 2P", monospace';
      ctx.fillStyle    = '#FF4444';
      ctx.shadowColor  = '#FF0000';
      ctx.shadowBlur   = 16;
      ctx.fillText('GAME OVER', GAME_W / 2, GAME_H * 0.22);
      ctx.shadowBlur   = 0;
      ctx.restore();
    }

    hud.drawScorePanel();

    // pulsing "tap to retry" hint
    const tapAlpha = 0.55 + Math.sin(frameCount * 0.1) * 0.4;
    ctx.save();
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font         = '8px "Press Start 2P", monospace';
    ctx.globalAlpha  = tapAlpha;
    ctx.fillStyle    = '#ffffff';
    ctx.fillText('TAP TO RETRY', GAME_W / 2, GAME_H * 0.86);
    ctx.restore();
  },
};


// ─── SCORE PERSISTENCE ────────────────────────────────────────────────────────
// localStorage with a try/catch — private browsing mode throws on access

function saveBestScore() {
  try {
    bestScore = Math.max(score, parseInt(localStorage.getItem('fapbird_best') || '0', 10));
    localStorage.setItem('fapbird_best', String(bestScore));
  } catch (_) {
    bestScore = Math.max(score, bestScore);
  }
}

function loadBestScore() {
  try {
    bestScore = parseInt(localStorage.getItem('fapbird_best') || '0', 10) || 0;
  } catch (_) {
    bestScore = 0;
  }
}


// ─── INPUT HANDLING ───────────────────────────────────────────────────────────
// Click, touchstart, and keyboard all funnel into one function.
// Debounced to 90ms so a single tap doesn't fire twice on some devices.

let lastInputTime = 0;

function handleInput() {
  const now = Date.now();
  if (now - lastInputTime < 90) return;
  lastInputTime = now;

  switch (state) {
    case STATE.READY:
      state = STATE.PLAY;
      sfx.start.play(0.55);
      break;

    case STATE.PLAY:
      bird.flap();
      break;

    case STATE.DEAD:
      // only allow restart once the bird has fully settled on the ground
      if (bird.vy === 0) {
        restartGame();
      }
      break;
  }
}

function restartGame() {
  state            = STATE.READY;
  score            = 0;
  scrollSpeed      = 2.2;
  deathSfxPlayed   = false;
  particles.pool   = [];
  bird.reset();
  pipes.reset();
  loadBestScore();
}

// mouse / touch
canvas.addEventListener('click',      handleInput);
canvas.addEventListener('touchstart', (e) => { e.preventDefault(); handleInput(); }, { passive: false });

// keyboard — Space, W, Up arrow, Enter all work
document.addEventListener('keydown', (e) => {
  if ([32, 87, 38, 13].includes(e.keyCode)) {
    e.preventDefault();
    handleInput();
  }
});

// make canvas focusable so keyboard events work when canvas is focused
canvas.tabIndex = 1;
canvas.focus();


// ─── UTILITY: ROUNDED RECT PATH ───────────────────────────────────────────────
// ctx.roundRect() isn't in all browsers yet, so rolling our own

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x,     y + h, x,     y + h - r, r);
  ctx.lineTo(x,     y + r);
  ctx.arcTo(x,     y,     x + r, y,         r);
  ctx.closePath();
}


// ─── MAIN GAME LOOP ───────────────────────────────────────────────────────────
// requestAnimationFrame keeps us in sync with the display refresh rate.
// Much smoother than setInterval and doesn't drift.

function gameLoop() {
  ctx.clearRect(0, 0, GAME_W, GAME_H);

  // apply screen shake by translating the whole context
  ctx.save();
  ctx.translate(shake.x, shake.y);

  // draw order matters — back to front
  background.draw();
  pipes.draw();
  ground.draw();
  bird.draw();
  particles.draw();

  // UI overlays
  if (state === STATE.READY) ui.drawGetReady();
  if (state === STATE.PLAY)  hud.drawLiveScore();
  if (state === STATE.DEAD)  ui.drawGameOver();

  ctx.restore();

  // update game objects after drawing so frame 0 always shows a clean scene
  shake.update();
  ground.update();
  pipes.update();
  bird.update();
  particles.update();

  frameCount++;
  requestAnimationFrame(gameLoop);
}


// ─── BOOT ─────────────────────────────────────────────────────────────────────
// Wait for both the custom font AND the key sprites to be ready before
// starting the loop. This avoids the 1-2 frame flicker where text shows
// in a fallback font.

loadBestScore();

// update ground scroll width once sprite is known
sprites.ground.addEventListener('load', () => {
  ground.GW = sprites.ground.naturalWidth;  // 552
  buildOffscreenCaches();
});

// in case the sprites load before we attach listeners (cached)
if (sprites.ground.complete && !sprites.ground.missing) {
  ground.GW = sprites.ground.naturalWidth;
}

// small timeout to let images start loading before we build caches
// (the build function checks .ready flags internally)
setTimeout(buildOffscreenCaches, 50);

// start the loop — document.fonts.ready ensures the pixel font is loaded
document.fonts.ready.then(() => {
  gameLoop();
});
