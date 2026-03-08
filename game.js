// fap-bird — game.js
// Uses the original pixel-art assets for BG, pipes, ground, getready, gameover.
// Bird is drawn with canvas (no b0/b1/b2 sprite files needed).
// Canvas stays at native 276×414 — CSS scale fills the screen.

'use strict';

// ─────────────────────────────────────────────
//  CANVAS SETUP
//  Native game resolution matches the original assets exactly.
//  We scale via CSS transform so every sprite pixel stays crisp.
// ─────────────────────────────────────────────
const GAME_W = 276;
const GAME_H = 414;

const scrn = document.getElementById('canvas');
const ctx  = scrn.getContext('2d');

scrn.width  = GAME_W;
scrn.height = GAME_H;

// work out the CSS scale needed to fill the viewport
function resizeToFit() {
  const scaleX = window.innerWidth  / GAME_W;
  const scaleY = window.innerHeight / GAME_H;
  // use the smaller axis so nothing gets clipped
  const scale  = Math.min(scaleX, scaleY);
  scrn.style.transform = `scale(${scale})`;
  // also stretch background to cover any leftover body area
  document.body.style.background = '#30c0df';
}

window.addEventListener('resize', resizeToFit);
resizeToFit();


// ─────────────────────────────────────────────
//  GAME STATE
// ─────────────────────────────────────────────
const STATE = { READY: 0, PLAY: 1, DEAD: 2 };
let state  = STATE.READY;
let frames = 0;
let dx     = 2.2;  // base scroll speed (slightly faster than original for more fun)


// ─────────────────────────────────────────────
//  ASSET LOADING
//  Simple helper — load images, track when all are ready.
//  Real .wav files are used for sounds.
// ─────────────────────────────────────────────
let assetsLoaded   = 0;
let assetsTotal    = 0;
let assetsReady    = false;

function loadImg(src) {
  const img = new Image();
  assetsTotal++;
  img.onload  = () => { assetsLoaded++; if (assetsLoaded >= assetsTotal) assetsReady = true; };
  img.onerror = () => { assetsLoaded++; console.warn('missing asset:', src); if (assetsLoaded >= assetsTotal) assetsReady = true; };
  img.src = src;
  return img;
}

// sounds — wrapped so they don't crash if file is missing
function makeSound(src) {
  const a = new Audio();
  // clone trick so you can play the same sound overlapping (e.g. fast flapping)
  a.src = src;
  return {
    play() {
      try {
        const clone = a.cloneNode();
        clone.volume = 0.6;
        clone.play().catch(() => {});  // browser may block until user gesture — that's fine
      } catch (e) {}
    }
  };
}

// load all the real sprite assets
const SPRITES = {
  bg      : loadImg('img/BG.png'),
  ground  : loadImg('img/ground.png'),
  toppipe : loadImg('img/toppipe.png'),
  botpipe : loadImg('img/botpipe.png'),
  getReady: loadImg('img/getready.png'),
  gameOver: loadImg('img/go.png'),
};

const SFX = {
  start : makeSound('sfx/start.wav'),
  flap  : makeSound('sfx/flap.wav'),
  score : makeSound('sfx/score.wav'),
  hit   : makeSound('sfx/hit.wav'),
  die   : makeSound('sfx/die.wav'),
};


// ─────────────────────────────────────────────
//  SCREEN SHAKE
//  Adds a lot of game-feel on death
// ─────────────────────────────────────────────
const shake = {
  x: 0, y: 0, power: 0, life: 0,

  trigger(power, life) { this.power = power; this.life = life; },

  update() {
    if (this.life > 0) {
      this.x     = (Math.random() - 0.5) * this.power;
      this.y     = (Math.random() - 0.5) * this.power;
      this.power *= 0.86;
      this.life  -= 1;
    } else {
      this.x = 0; this.y = 0;
    }
  },
};


// ─────────────────────────────────────────────
//  PARTICLES
//  puffs on flap, explosion on death
// ─────────────────────────────────────────────
const particles = {
  list: [],

  emit(x, y, n, cols) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.8 + Math.random() * 3.2;
      this.list.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 1.2,
        life: 1,
        decay: 0.045 + Math.random() * 0.04,
        r: 1.5 + Math.random() * 3,
        col: cols[Math.floor(Math.random() * cols.length)],
      });
    }
  },

  update() {
    this.list = this.list.filter(p => {
      p.x  += p.vx;
      p.y  += p.vy;
      p.vy += 0.18;
      p.vx *= 0.96;
      p.life -= p.decay;
      return p.life > 0;
    });
  },

  draw() {
    this.list.forEach(p => {
      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.fillStyle   = p.col;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  },
};


// ─────────────────────────────────────────────
//  BACKGROUND
//  The BG sprite is 276×228. Draw it twice stacked
//  to fill the full 414px height canvas.
// ─────────────────────────────────────────────
const bg = {
  draw() {
    if (!SPRITES.bg.complete) {
      // fallback sky color while loading
      ctx.fillStyle = '#30c0df';
      ctx.fillRect(0, 0, GAME_W, GAME_H);
      return;
    }
    const h = SPRITES.bg.height;  // 228
    // tile vertically — draw top piece, then second piece below
    ctx.drawImage(SPRITES.bg, 0, 0);
    // fill remaining below with the bottom portion of BG
    ctx.drawImage(SPRITES.bg, 0, 0, GAME_W, GAME_H - h, 0, h, GAME_W, GAME_H - h);
  },
};


// ─────────────────────────────────────────────
//  GROUND
//  552×112 sprite (exactly 2× game width) — scrolls left
// ─────────────────────────────────────────────
const gnd = {
  x   : 0,
  y   : 0,  // set in update
  draw() {
    if (!SPRITES.ground.complete) return;
    this.y = GAME_H - SPRITES.ground.height;  // 414 - 112 = 302
    // draw twice so it tiles seamlessly while scrolling
    ctx.drawImage(SPRITES.ground, this.x, this.y);
    ctx.drawImage(SPRITES.ground, this.x + SPRITES.ground.width / 2, this.y);
    ctx.drawImage(SPRITES.ground, this.x + SPRITES.ground.width, this.y);
  },
  update() {
    if (state !== STATE.PLAY) return;
    this.x -= dx;
    // reset when we've scrolled exactly half the sprite width (seamless loop)
    if (this.x <= -SPRITES.ground.width / 2) {
      this.x = 0;
    }
  },
};


// ─────────────────────────────────────────────
//  PIPES
//  toppipe.png and botpipe.png are both 52×400.
//  Gap between them is 85px (matches original).
// ─────────────────────────────────────────────
const pipes = {
  gap    : 85,
  list   : [],
  timer  : 0,
  spacing: 100,   // frames between spawns
  moved  : true,  // for scoring — did bird pass this pipe?

  reset() {
    this.list  = [];
    this.timer = 0;
    this.moved = true;
    this.spacing = 100;
  },

  // each pipe has an x position and a y offset
  // y is negative so the top pipe sticks out from the top of screen
  _spawn() {
    const pipeH = SPRITES.toppipe.complete ? SPRITES.toppipe.height : 400;
    this.list.push({
      x    : GAME_W + 10,
      y    : -210 * Math.min(Math.random() + 1, 1.8),  // same formula as original
      scored: false,
    });
  },

  update() {
    if (state !== STATE.PLAY) return;

    this.timer++;
    if (this.timer % this.spacing === 0) {
      this._spawn();
    }

    this.list.forEach(p => { p.x -= dx; });

    // clean up pipes that scrolled off screen
    const pipeW = SPRITES.toppipe.complete ? SPRITES.toppipe.width : 52;
    this.list = this.list.filter(p => p.x > -pipeW - 10);
  },

  draw() {
    if (!SPRITES.toppipe.complete || !SPRITES.botpipe.complete) return;
    const topH = SPRITES.toppipe.height;  // 400

    this.list.forEach(p => {
      // top pipe
      ctx.drawImage(SPRITES.toppipe, p.x, p.y);
      // bottom pipe — placed right below the gap
      ctx.drawImage(SPRITES.botpipe, p.x, p.y + topH + this.gap);
    });
  },
};


// ─────────────────────────────────────────────
//  BIRD
//  Drawn with canvas — 4 frame wing animation.
//  Matches the yellow-bird look from the original.
// ─────────────────────────────────────────────
const bird = {
  x        : 60,
  y        : 150,
  vy       : 0,
  rot      : 0,    // degrees (matching original's degree-based rotation)
  frame    : 0,
  wingAngle: 0,
  wingDir  : 1,
  alive    : true,

  // physics constants from original
  gravity : 0.125,
  thrust  : 3.6,
  radius  : 12,   // collision radius (roughly half the original sprite width)

  reset() {
    this.y     = 150;
    this.vy    = 0;
    this.rot   = 0;
    this.frame = 0;
    this.alive = true;
  },

  flap() {
    if (this.y > 0 && this.alive) {
      SFX.flap.play();
      this.vy = -this.thrust;
      // feather puff effect
      particles.emit(this.x - 8, this.y + 4, 6, ['#fff', '#FFE066', '#FFB800']);
    }
  },

  setRotation() {
    if (this.vy <= 0) {
      this.rot = Math.max(-25, (-25 * this.vy) / (-1 * this.thrust));
    } else {
      this.rot = Math.min(90, (90 * this.vy) / (this.thrust * 2));
    }
  },

  update() {
    // wing flap animation — runs regardless of state
    this.wingAngle += 0.22 * this.wingDir;
    if (Math.abs(this.wingAngle) > 0.5) this.wingDir *= -1;

    // advance animation frame
    if (frames % 5 === 0) this.frame = (this.frame + 1) % 4;

    switch (state) {
      case STATE.READY:
        // idle bob while waiting to start
        this.rot = 0;
        if (frames % 10 === 0) this.y += Math.sin(frames * (Math.PI / 180));
        break;

      case STATE.PLAY:
        this.vy  += this.gravity;
        this.y   += this.vy;
        this.setRotation();

        // hit the ground
        if (this.y + this.radius >= gnd.y) {
          this.y  = gnd.y - this.radius;
          this._die();
        }
        break;

      case STATE.DEAD:
        if (!this.alive) {
          // keep falling after death until it hits the ground
          if (this.y + this.radius < gnd.y) {
            this.vy += this.gravity * 2;
            this.y  += this.vy;
            this.rot = 90;
          } else {
            this.vy = 0;
            this.y  = gnd.y - this.radius;
            this.rot = 90;
          }
        }
        break;
    }
  },

  _die() {
    if (!this.alive) return;
    this.alive = false;
    SFX.hit.play();
    shake.trigger(6, 14);
    particles.emit(this.x, this.y, 16, ['#FF5555', '#FF9900', '#FFE066', '#fff', '#88ff66']);
    setTimeout(() => {
      SFX.die.play();
      state = STATE.DEAD;
      _saveBest();
    }, 400);
  },

  // hand-drawn bird with canvas — yellow body, orange beak, animated wing
  draw() {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot * (Math.PI / 180));

    const r = this.radius;

    // drop shadow (subtle)
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(2, r * 0.8, r * 0.75, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // wing (behind body, rotates)
    ctx.save();
    ctx.rotate(this.wingAngle);
    ctx.fillStyle = '#D4820A';
    ctx.beginPath();
    ctx.ellipse(-r * 0.2, r * 0.05, r * 0.58, r * 0.28, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // body
    const grad = ctx.createRadialGradient(-r * 0.2, -r * 0.3, r * 0.1, 0, 0, r);
    grad.addColorStop(0, '#FFE566');
    grad.addColorStop(0.5, '#FFC800');
    grad.addColorStop(1, '#CC8800');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // belly highlight
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.beginPath();
    ctx.ellipse(r * 0.1, r * 0.25, r * 0.45, r * 0.3, 0.2, 0, Math.PI * 2);
    ctx.fill();

    // eye white
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(r * 0.3, -r * 0.2, r * 0.34, 0, Math.PI * 2);
    ctx.fill();

    // pupil
    ctx.fillStyle = '#1a1a2e';
    ctx.beginPath();
    ctx.arc(r * 0.4, -r * 0.16, r * 0.17, 0, Math.PI * 2);
    ctx.fill();

    // eye shine
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(r * 0.46, -r * 0.22, r * 0.06, 0, Math.PI * 2);
    ctx.fill();

    // beak
    ctx.fillStyle = '#FF8C00';
    ctx.beginPath();
    ctx.moveTo(r * 0.56,  -r * 0.1);
    ctx.lineTo(r * 1.15,  r * 0.04);
    ctx.lineTo(r * 0.56,  r * 0.2);
    ctx.closePath();
    ctx.fill();

    // beak divider
    ctx.strokeStyle = '#CC5500';
    ctx.lineWidth   = 1.2;
    ctx.beginPath();
    ctx.moveTo(r * 0.58, r * 0.05);
    ctx.lineTo(r * 1.05, r * 0.05);
    ctx.stroke();

    ctx.restore();
  },

  // collision check (same logic as original, adapted)
  collisionCheck() {
    if (!pipes.list.length) return false;
    const pipeW = SPRITES.toppipe.complete ? SPRITES.toppipe.width   : 52;
    const pipeH = SPRITES.toppipe.complete ? SPRITES.toppipe.height  : 400;
    const r     = this.radius * 0.82;  // slightly forgiving hitbox

    for (let i = 0; i < pipes.list.length; i++) {
      const p     = pipes.list[i];
      const roof  = p.y + pipeH;          // bottom of top pipe
      const floor = roof + pipes.gap;     // top of bottom pipe

      if (this.x + r > p.x && this.x - r < p.x + pipeW) {
        // bird is horizontally inside the pipe zone
        if (this.y - r <= roof || this.y + r >= floor) {
          return true;  // hit!
        }
      }

      // scoring — bird just passed this pipe
      if (!p.scored && this.x - r > p.x + pipeW) {
        p.scored = true;
        UI.score.curr++;
        SFX.score.play();
        particles.emit(this.x, this.y - r, 7, ['#FFD700', '#fff', '#00ff88']);
        // every 5 points, make it a little harder
        if (UI.score.curr % 5 === 0) {
          dx = Math.min(dx + 0.25, 5.0);
          pipes.spacing = Math.max(pipes.spacing - 3, 72);
        }
      }
    }
    return false;
  },
};


// ─────────────────────────────────────────────
//  UI
//  Uses real getready.png and go.png sprites.
//  Tap indicator drawn with canvas.
//  Score drawn with Press Start 2P font.
// ─────────────────────────────────────────────
const UI = {
  score  : { curr: 0, best: 0 },
  tapAnim: 0,  // for the hand-drawn tap icon bob

  reset() {
    this.score.curr = 0;
    this.tapAnim    = 0;
  },

  // draws a little tap/click finger icon since we don't have t0/t1 pngs
  _drawTapHint(x, y) {
    const bob   = Math.sin(frames * 0.1) * 4;  // gentle bob
    const bx    = x;
    const by    = y + bob;
    const alpha = 0.65 + Math.sin(frames * 0.1) * 0.3;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle   = 'rgba(255,255,255,0.9)';
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth   = 1.5;

    // finger pointer shape
    ctx.beginPath();
    ctx.roundRect
      ? ctx.roundRect(bx - 6, by - 18, 14, 24, 7)
      : (ctx.rect(bx - 6, by - 18, 14, 24));  // fallback for older browsers
    ctx.fill();
    ctx.stroke();

    // fingernail
    ctx.fillStyle = 'rgba(200,180,160,0.8)';
    ctx.beginPath();
    ctx.arc(bx + 1, by - 14, 4, Math.PI, 0);
    ctx.fill();

    // tap ripple
    const ripple = (frames % 30) / 30;
    ctx.globalAlpha = (1 - ripple) * 0.45;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.arc(bx + 1, by + 3, ripple * 18, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  },

  drawReady() {
    if (!SPRITES.getReady.complete) return;
    const sp = SPRITES.getReady;
    const x  = (GAME_W - sp.width)  / 2;
    const y  = (GAME_H - sp.height) / 2 - 30;
    ctx.drawImage(sp, x, y);
    this._drawTapHint(GAME_W / 2, y + sp.height + 30);
  },

  drawDead() {
    if (!SPRITES.gameOver.complete) return;
    const sp = SPRITES.gameOver;
    const x  = (GAME_W - sp.width)  / 2;
    const y  = (GAME_H - sp.height) / 2 - 40;
    ctx.drawImage(sp, x, y);

    // score panel below game over text
    this._drawScorePanel(GAME_W / 2, y + sp.height + 14);

    this._drawTapHint(GAME_W / 2, y + sp.height + 90);
  },

  _drawScorePanel(cx, panelY) {
    const pw = 200;
    const ph = 58;
    const px = cx - pw / 2;

    // panel bg
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    _roundRect(px, panelY, pw, ph, 8);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth   = 1.5;
    _roundRect(px, panelY, pw, ph, 8);
    ctx.stroke();

    // scores
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font         = '12px "Press Start 2P", monospace';

    ctx.fillStyle = '#fff';
    ctx.fillText(`SCORE: ${this.score.curr}`, cx, panelY + 18);

    ctx.fillStyle   = '#FFD700';
    ctx.shadowColor = '#FFD700';
    ctx.shadowBlur  = 6;
    ctx.fillText(`BEST: ${this.score.best}`, cx, panelY + 40);
    ctx.shadowBlur = 0;
  },

  drawPlayScore() {
    // live score shown during play
    ctx.save();
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.font         = '28px "Press Start 2P", monospace';

    // shadow pass
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillText(this.score.curr, GAME_W / 2 + 2, 26);
    // main text
    ctx.fillStyle = '#ffffff';
    ctx.fillText(this.score.curr, GAME_W / 2, 24);
    ctx.restore();
  },
};


// ─────────────────────────────────────────────
//  SCORE SAVE/LOAD  (localStorage with fallback)
// ─────────────────────────────────────────────
function _saveBest() {
  try {
    UI.score.best = Math.max(UI.score.curr, parseInt(localStorage.getItem('fapbird-best') || '0'));
    localStorage.setItem('fapbird-best', UI.score.best);
  } catch (e) {
    UI.score.best = Math.max(UI.score.curr, UI.score.best);
  }
}

function _loadBest() {
  try {
    UI.score.best = parseInt(localStorage.getItem('fapbird-best') || '0') || 0;
  } catch (e) {
    UI.score.best = 0;
  }
}


// ─────────────────────────────────────────────
//  INPUT
//  Click, touch, keyboard — all funnel to one handler
// ─────────────────────────────────────────────
let lastInput = 0;  // debounce accidental double-fires

function handleInput() {
  const now = Date.now();
  if (now - lastInput < 90) return;
  lastInput = now;

  switch (state) {
    case STATE.READY:
      state = STATE.PLAY;
      SFX.start.play();
      break;

    case STATE.PLAY:
      bird.flap();
      break;

    case STATE.DEAD:
      // wait until bird has fully landed before allowing restart
      if (bird.vy === 0) {
        _restartGame();
      }
      break;
  }
}

function _restartGame() {
  state = STATE.READY;
  dx    = 2.2;
  bird.reset();
  pipes.reset();
  particles.list = [];
  UI.reset();
  _loadBest();
}

// mouse click
scrn.addEventListener('click', handleInput);

// touch (prevent default so the page doesn't scroll/zoom)
scrn.addEventListener('touchstart', (e) => {
  e.preventDefault();
  handleInput();
}, { passive: false });

// keyboard — Space, W, Up arrow, Enter
document.addEventListener('keydown', (e) => {
  if ([32, 87, 38, 13].includes(e.keyCode)) {
    e.preventDefault();
    handleInput();
  }
});

// also make canvas focusable so keydown events reach it on mobile keyboard scenarios
scrn.tabIndex = 1;


// ─────────────────────────────────────────────
//  COLLISION  (run each frame during play)
// ─────────────────────────────────────────────
function checkCollision() {
  if (state !== STATE.PLAY || !bird.alive) return;
  if (bird.collisionCheck()) {
    bird._die();
  }
}


// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────
function _roundRect(x, y, w, h, r) {
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


// ─────────────────────────────────────────────
//  MAIN LOOP
//  update → draw → requestAnimationFrame
// ─────────────────────────────────────────────
function loop() {
  // ── update ──
  shake.update();
  gnd.update();
  pipes.update();
  bird.update();
  particles.update();
  checkCollision();

  // ── draw ──
  ctx.save();
  ctx.translate(shake.x, shake.y);

  bg.draw();
  pipes.draw();
  gnd.draw();
  bird.draw();
  particles.draw();

  // UI on top of everything
  if (state === STATE.READY) UI.drawReady();
  if (state === STATE.PLAY)  UI.drawPlayScore();
  if (state === STATE.DEAD)  UI.drawDead();

  ctx.restore();

  frames++;
  requestAnimationFrame(loop);
}


// ─────────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────────
_loadBest();

// wait for DOM fonts to load before starting so score text looks right
document.fonts.ready.then(() => {
  // init ground y position
  if (SPRITES.ground.complete) {
    gnd.y = GAME_H - SPRITES.ground.height;
  } else {
    SPRITES.ground.onload = () => { gnd.y = GAME_H - SPRITES.ground.height; };
  }
  loop();
});
