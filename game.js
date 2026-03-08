/*
  game.js - Fap-Bird
  ------------------

  Physics tuned to match the original Flappy Bird as closely as possible.
  The original ran at 60fps and felt "heavy" - the bird falls fast but
  the flap gives you a real boost. Gap is generous at 120px so beginners
  have a chance. Speed starts at 2px/frame and only creeps up every 10 points.

  Bird is drawn using the flappy.png sprite (1024x522, RGBA).
  It gets scaled down to ~34px tall in-game and rotated with the velocity
  just like the original did.

  Everything else (BG, ground, pipes, UI) uses the original sprite assets.
  Background and ground are pre-rendered to offscreen canvases at startup
  so we're not running gradient code every single frame.
*/

'use strict';

// the game always thinks it's 320x568 internally
// that's roughly an iPhone 5 portrait screen, which is a nice size for this game
const GAME_W = 320;
const GAME_H = 568;

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

canvas.width = GAME_W;
canvas.height = GAME_H;

// scale the canvas to fill the screen while keeping the aspect ratio
// runs once on load and again on every resize
function fitCanvas() {
  const scaleX = window.innerWidth / GAME_W;
  const scaleY = window.innerHeight / GAME_H;
  const scale = Math.min(scaleX, scaleY);
  canvas.style.transform = `scale(${scale})`;
}

window.addEventListener('resize', fitCanvas);
fitCanvas();


// ---------------------------------------------------------------------------
// asset loading
// ---------------------------------------------------------------------------

// simple image loader - marks the image as ready/missing so we can
// fall back gracefully if something doesn't load
function loadImage(src) {
  const img = new Image();
  img.ready = false;
  img.missing = false;
  img.onload = () => { img.ready = true; };
  img.onerror = () => {
    img.ready = true;
    img.missing = true;
    console.warn('could not load:', src);
  };
  img.src = src;
  return img;
}

// audio loader - clone trick lets the same sound play overlapping
// (you can flap fast and hear every flap)
function loadSound(src) {
  const a = new Audio(src);
  a.preload = 'auto';
  return {
    play(volume = 0.6) {
      try {
        const clone = a.cloneNode();
        clone.volume = volume;
        clone.play().catch(() => {
          // browsers block audio until the user has interacted with the page
          // this is expected on first load, just ignore it
        });
      } catch (_) {}
    }
  };
}

const sprites = {
  bg:       loadImage('assets/images/BG.png'),
  ground:   loadImage('assets/images/ground.png'),
  toppipe:  loadImage('assets/images/toppipe.png'),
  botpipe:  loadImage('assets/images/botpipe.png'),
  getReady: loadImage('assets/images/getready.png'),
  gameOver: loadImage('assets/images/go.png'),
  bird:     loadImage('assets/images/flappy.png'), // the pixel art bird
};

const sfx = {
  start: loadSound('assets/sfx/start.wav'),
  flap:  loadSound('assets/sfx/flap.wav'),
  score: loadSound('assets/sfx/score.wav'),
  hit:   loadSound('assets/sfx/hit.wav'),
  die:   loadSound('assets/sfx/die.wav'),
};


// ---------------------------------------------------------------------------
// offscreen canvas caches
// ---------------------------------------------------------------------------
// we draw the background and ground once at startup onto offscreen canvases,
// then just blit those cached images every frame instead of recalculating
// gradients 60 times per second. this is the main lag fix.

const bgCache = document.createElement('canvas');
bgCache.width = GAME_W;
bgCache.height = GAME_H;

// ground strip is 3x wide so we can always scroll without showing a gap
const groundCache = document.createElement('canvas');
groundCache.width = GAME_W * 4;
groundCache.height = 112;

let cachesReady = false;

function buildCaches() {
  const bgCtx = bgCache.getContext('2d');

  // BG.png is 276x228, which doesn't fill our 320x568 canvas
  // draw it scaled to full width, anchored above the ground
  // and fill above it with a solid sky colour
  const bgH = 228;
  const bgScaled = (GAME_W / 276) * bgH; // scale height proportionally
  const bgY = GAME_H - 112 - bgScaled;

  // fill the sky above the background sprite
  bgCtx.fillStyle = '#4ec0ca';
  bgCtx.fillRect(0, 0, GAME_W, bgY + 5);

  if (!sprites.bg.missing) {
    bgCtx.drawImage(sprites.bg, 0, bgY, GAME_W, bgScaled);
  }

  // ground - tile the 552px wide sprite across our wider cache
  const gCtx = groundCache.getContext('2d');
  if (!sprites.ground.missing) {
    const gW = sprites.ground.naturalWidth || 552;
    const gH = sprites.ground.naturalHeight || 112;
    for (let i = 0; i < 5; i++) {
      gCtx.drawImage(sprites.ground, i * gW, 0);
    }
  } else {
    // fallback if the ground image didn't load
    gCtx.fillStyle = '#c8a060';
    gCtx.fillRect(0, 0, groundCache.width, 112);
    gCtx.fillStyle = '#5aad3a';
    gCtx.fillRect(0, 0, groundCache.width, 18);
  }

  cachesReady = true;
}

// build caches once the sprites have had a moment to load
// if they're already cached by the browser, 50ms is plenty
setTimeout(buildCaches, 80);


// ---------------------------------------------------------------------------
// game state
// ---------------------------------------------------------------------------

const STATE = {
  READY: 0,   // title screen, bird is idle, no pipes
  PLAY: 1,    // actively playing
  DEAD: 2,    // game over
};

let state = STATE.READY;
let frameCount = 0;
let score = 0;
let bestScore = 0;
let scrollSpeed = 2.0;   // pipes start at 2px/frame, same as original
let deathSoundPlayed = false;


// ---------------------------------------------------------------------------
// screen shake
// ---------------------------------------------------------------------------
// translates the canvas context by a small random offset each frame
// damped so it fades out quickly. small effect, big impact on feel.

const shake = {
  x: 0,
  y: 0,
  power: 0,
  frames: 0,

  trigger(power, duration) {
    this.power = power;
    this.frames = duration;
  },

  update() {
    if (this.frames > 0) {
      this.x = (Math.random() - 0.5) * this.power;
      this.y = (Math.random() - 0.5) * this.power;
      this.power *= 0.83;
      this.frames -= 1;
    } else {
      this.x = 0;
      this.y = 0;
    }
  },
};


// ---------------------------------------------------------------------------
// particles
// ---------------------------------------------------------------------------
// small coloured circles that burst out on death and pop on scoring.
// kept simple - just position, velocity, and a life value that fades to 0.

const particles = {
  list: [],

  spawn(x, y, count, colours) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.8 + Math.random() * 3.5;
      this.list.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.5,
        life: 1.0,
        decay: 0.035 + Math.random() * 0.04,
        size: 2 + Math.random() * 3.5,
        colour: colours[Math.floor(Math.random() * colours.length)],
      });
    }
  },

  update() {
    this.list = this.list.filter(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.18;  // gravity pulls particles down
      p.vx *= 0.97;  // a little air resistance
      p.life -= p.decay;
      return p.life > 0;
    });
  },

  draw() {
    this.list.forEach(p => {
      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.colour;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  },
};


// ---------------------------------------------------------------------------
// background
// ---------------------------------------------------------------------------

const background = {
  draw() {
    if (cachesReady) {
      ctx.drawImage(bgCache, 0, 0);
    } else {
      // just fill sky while loading, takes maybe one frame
      ctx.fillStyle = '#4ec0ca';
      ctx.fillRect(0, 0, GAME_W, GAME_H);
    }
  },
};


// ---------------------------------------------------------------------------
// ground
// ---------------------------------------------------------------------------

const ground = {
  scrollX: 0,
  y: GAME_H - 112,
  height: 112,
  spriteWidth: 552,

  update() {
    if (state !== STATE.PLAY) return;
    this.scrollX += scrollSpeed;
    // loop back when we've scrolled one full sprite width
    if (this.scrollX >= this.spriteWidth) {
      this.scrollX = 0;
    }
  },

  draw() {
    if (!cachesReady) return;
    ctx.drawImage(
      groundCache,
      this.scrollX, 0,
      GAME_W, this.height,
      0, this.y,
      GAME_W, this.height
    );
  },
};


// ---------------------------------------------------------------------------
// pipes
// ---------------------------------------------------------------------------
//
// physics tuning vs original:
//   gap:      120px  (original was around 100-110, this is a tiny bit more forgiving)
//   speed:    starts at 2.0, max 3.6  (original was around 2-3px/frame)
//   interval: 90 frames  (roughly 1.5 seconds at 60fps, same as original)
//
// the original game had no difficulty scaling at all for the first ~10 pipes.
// i'm adding very gentle scaling (every 10 points) so it doesn't stay
// trivially easy forever.

const pipes = {
  list: [],
  gap: 120,        // vertical gap between top and bottom pipe - 120 feels like the original
  pipeWidth: 52,   // matches the sprite width
  pipeHeight: 400, // matches the sprite height
  timer: 0,
  spawnInterval: 90,  // frames between new pipes - 90 frames = ~1.5 seconds at 60fps

  reset() {
    this.list = [];
    this.timer = 0;
    this.spawnInterval = 90;
    scrollSpeed = 2.0;
  },

  spawnPipe() {
    // same randomisation formula as the original
    // y is negative so the top pipe comes from off the top of the screen
    const y = -210 * Math.min(Math.random() + 1, 1.8);
    this.list.push({
      x: GAME_W + this.pipeWidth + 4,
      y,
      counted: false,  // whether we've already awarded a point for this pipe
    });
  },

  update() {
    if (state !== STATE.PLAY) return;

    this.timer++;
    if (this.timer >= this.spawnInterval) {
      this.spawnPipe();
      this.timer = 0;
    }

    this.list.forEach(p => { p.x -= scrollSpeed; });

    // remove pipes that have fully scrolled past the left edge
    this.list = this.list.filter(p => p.x > -(this.pipeWidth + 20));
  },

  draw() {
    const topOk = sprites.toppipe.ready && !sprites.toppipe.missing;
    const botOk = sprites.botpipe.ready && !sprites.botpipe.missing;

    this.list.forEach(p => {
      const topBottom = p.y + this.pipeHeight;      // bottom edge of top pipe
      const botTop = topBottom + this.gap;           // top edge of bottom pipe

      if (topOk && botOk) {
        ctx.drawImage(sprites.toppipe, p.x, p.y);
        ctx.drawImage(sprites.botpipe, p.x, botTop);
      } else {
        this.drawFallback(p.x, topBottom, botTop);
      }
    });
  },

  // drawn pipe as fallback if the sprite files don't load
  drawFallback(x, topH, botY) {
    const w = this.pipeWidth;
    const grad = ctx.createLinearGradient(x, 0, x + w, 0);
    grad.addColorStop(0, '#1a6b1a');
    grad.addColorStop(0.3, '#45d445');
    grad.addColorStop(0.7, '#2eaa2e');
    grad.addColorStop(1, '#1a6b1a');

    ctx.fillStyle = grad;
    ctx.fillRect(x, 0, w, topH - 16);
    ctx.fillStyle = '#2ecc2e';
    ctx.fillRect(x - 3, topH - 16, w + 6, 16);
    ctx.fillStyle = '#2ecc2e';
    ctx.fillRect(x - 3, botY, w + 6, 16);
    ctx.fillStyle = grad;
    ctx.fillRect(x, botY + 16, w, ground.y - botY - 16);
  },

  // returns true if the bird at (bx, by) with radius br is touching a pipe
  // hitbox is 78% of the visual size - a little forgiveness goes a long way
  checkCollision(bx, by, br) {
    const r = br * 0.78;

    for (let i = 0; i < this.list.length; i++) {
      const p = this.list[i];
      const roof = p.y + this.pipeHeight;   // bottom of top pipe
      const floor = roof + this.gap;        // top of bottom pipe
      const left = p.x;
      const right = p.x + this.pipeWidth;

      const inXZone = bx + r > left && bx - r < right;

      if (inXZone && (by - r < roof || by + r > floor)) {
        return true;
      }

      // award a point when the bird's left edge clears the pipe's right edge
      if (!p.counted && bx - r > right) {
        p.counted = true;
        score++;
        sfx.score.play();
        particles.spawn(bx + 18, by - br, 7, ['#FFD700', '#FFFFFF', '#FFA500', '#FFE066']);

        // very gentle speed increase every 10 points
        // the original had no scaling, but zero scaling gets boring fast
        if (score % 10 === 0) {
          scrollSpeed = Math.min(scrollSpeed + 0.18, 3.6);
          this.spawnInterval = Math.max(this.spawnInterval - 2, 78);
        }
      }
    }

    return false;
  },
};


// ---------------------------------------------------------------------------
// bird
// ---------------------------------------------------------------------------
//
// uses flappy.png as the sprite. the image is 1024x522 which is wide,
// so we draw it scaled to about 34px tall and a proportional width.
// rotation is applied with ctx.rotate(), same as the original's approach.
//
// physics values tuned to feel like the original:
//   gravity: 0.28 per frame  (heavier than my last version, more original-feeling)
//   thrust: -7.2             (strong upward kick on flap)
//   max fall speed: capped at 10px/frame so it doesn't feel instant
//
// the original had these rough values (at 60fps):
//   gravity: ~0.25-0.30
//   flap velocity: -8 to -9
//   terminal velocity: ~10-12

const bird = {
  x: 72,
  y: 250,
  vy: 0,        // vertical velocity in pixels per frame
  rotation: 0,  // current rotation in degrees (positive = nose down)
  alive: true,

  // display size - the sprite will be drawn at this height, width is proportional
  drawHeight: 34,
  drawWidth: 0,   // calculated from sprite aspect ratio on first draw

  // collision radius - smaller than the visual size
  // the original game also used a smaller hitbox than the sprite
  r: 12,

  // physics - tuned to match original Flappy Bird feel
  gravity: 0.28,
  thrust: 7.2,
  maxFallSpeed: 10,

  reset() {
    this.x = 72;
    this.y = 250;
    this.vy = 0;
    this.rotation = 0;
    this.alive = true;
  },

  flap() {
    if (!this.alive) return;
    if (this.y - this.r < 0) return;

    sfx.flap.play(0.55);
    this.vy = -this.thrust;

    // small white puff behind the bird on flap - gives it some weight
    particles.spawn(this.x - this.r - 4, this.y + 2, 4, ['#ffffff', '#e8f8e8']);
  },

  // rotation logic from the original:
  // when moving up -> tilt nose up (negative degrees)
  // when falling -> tilt nose down (positive degrees, max 90)
  updateRotation() {
    if (this.vy < 0) {
      // going up - tilt up proportionally to how hard we're flapping
      this.rotation = Math.max(-30, (-30 * this.vy) / (-this.thrust));
    } else {
      // falling - tilt down, reaches 90 degrees at max fall speed
      this.rotation = Math.min(90, (90 * this.vy) / this.maxFallSpeed);
    }
  },

  update() {
    switch (state) {
      case STATE.READY:
        // bob up and down gently while waiting on the title screen
        this.rotation = 0;
        if (frameCount % 8 === 0) {
          this.y += Math.sin(frameCount * 0.08) * 0.9;
        }
        break;

      case STATE.PLAY:
        this.vy = Math.min(this.vy + this.gravity, this.maxFallSpeed);
        this.y += this.vy;
        this.updateRotation();

        // hit the ceiling
        if (this.y - this.r <= 0) {
          this.y = this.r;
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
        // keep falling until landing on the ground
        if (this.y + this.r < ground.y) {
          this.vy = Math.min(this.vy + this.gravity * 2.2, 14);
          this.y += this.vy;
          this.rotation = 90;
        } else {
          this.vy = 0;
          this.y = ground.y - this.r;
          this.rotation = 90;

          if (!deathSoundPlayed) {
            sfx.die.play(0.65);
            deathSoundPlayed = true;
          }
        }
        break;
    }
  },

  die() {
    if (!this.alive) return;
    this.alive = false;

    sfx.hit.play(0.7);
    shake.trigger(8, 18);

    particles.spawn(this.x, this.y, 22, [
      '#FF5555', '#FF8800', '#FFD700', '#ffffff', '#FF3333', '#FFAA00'
    ]);

    // delay the game over screen so the death fall animation plays out
    setTimeout(() => {
      state = STATE.DEAD;
      saveBest();
    }, 500);
  },

  draw() {
    const sp = sprites.bird;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation * (Math.PI / 180));

    if (sp.ready && !sp.missing) {
      // figure out draw width from the sprite's actual aspect ratio
      // only needs to happen once, but safe to recalculate every frame
      const aspectRatio = sp.naturalWidth / sp.naturalHeight;
      this.drawWidth = this.drawHeight * aspectRatio;

      // centre the sprite on the bird's position
      const dw = this.drawWidth;
      const dh = this.drawHeight;

      ctx.drawImage(sp, -dw / 2, -dh / 2, dw, dh);
    } else {
      // fallback circle if the sprite didn't load for some reason
      const r = this.r;
      const g = ctx.createRadialGradient(-r * 0.2, -r * 0.3, 2, 0, 0, r);
      g.addColorStop(0, '#FFE566');
      g.addColorStop(0.6, '#FFC800');
      g.addColorStop(1, '#C87A00');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  },
};


// ---------------------------------------------------------------------------
// HUD - score display during gameplay
// ---------------------------------------------------------------------------

function drawScore() {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = '28px "Press Start 2P", monospace';

  // dark shadow first so the white text is readable over the sky
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillText(score, GAME_W / 2 + 2, 30);

  ctx.fillStyle = '#ffffff';
  ctx.fillText(score, GAME_W / 2, 28);

  ctx.restore();
}


// ---------------------------------------------------------------------------
// UI screens - get ready and game over
// ---------------------------------------------------------------------------

// animated tap hint - the little hand icon
// drawn with canvas since we don't have the tap sprite files
function drawTapHint(x, y) {
  const bob = Math.sin(frameCount * 0.09) * 6;
  const alpha = 0.5 + Math.sin(frameCount * 0.09) * 0.45;

  ctx.save();
  ctx.translate(x, y + bob);
  ctx.globalAlpha = alpha;

  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.lineWidth = 1.5;

  // finger body
  ctx.beginPath();
  roundRect(-9, -24, 20, 30, 10);
  ctx.fill();
  ctx.stroke();

  // fingernail
  ctx.fillStyle = 'rgba(215, 190, 165, 0.85)';
  ctx.beginPath();
  ctx.arc(1, -19, 5.5, Math.PI, 0);
  ctx.fill();

  // tap ripple animation that loops every 28 frames
  const ripple = (frameCount % 28) / 28;
  ctx.globalAlpha = (1 - ripple) * 0.4;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(1, 3, ripple * 24, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}

function drawGetReady() {
  const sp = sprites.getReady;

  if (sp.ready && !sp.missing) {
    // centre the sprite horizontally, position it in the upper-middle area
    const sw = sp.naturalWidth;
    const sh = sp.naturalHeight;
    // scale it up a bit since our canvas is wider than the original 276px
    const scale = GAME_W / 276;
    const dw = sw * scale;
    const dh = sh * scale;
    const x = (GAME_W - dw) / 2;
    const y = GAME_H * 0.2;
    ctx.drawImage(sp, x, y, dw, dh);
  } else {
    // text fallback
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '16px "Press Start 2P", monospace';
    ctx.fillStyle = '#FFE000';
    ctx.shadowColor = '#FF8800';
    ctx.shadowBlur = 10;
    ctx.fillText('GET READY!', GAME_W / 2, GAME_H * 0.28);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  drawTapHint(GAME_W / 2, GAME_H * 0.72);

  // show the best score if the player has played before
  if (bestScore > 0) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '9px "Press Start 2P", monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillText('BEST: ' + bestScore, GAME_W / 2, GAME_H * 0.84);
    ctx.restore();
  }
}

function drawGameOver() {
  // dim everything behind the game over UI
  ctx.fillStyle = 'rgba(0, 0, 0, 0.44)';
  ctx.fillRect(0, 0, GAME_W, GAME_H);

  const sp = sprites.gameOver;

  if (sp.ready && !sp.missing) {
    const scale = GAME_W / 276;
    const dw = sp.naturalWidth * scale;
    const dh = sp.naturalHeight * scale;
    ctx.drawImage(sp, (GAME_W - dw) / 2, GAME_H * 0.2, dw, dh);
  } else {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '18px "Press Start 2P", monospace';
    ctx.fillStyle = '#FF4444';
    ctx.shadowColor = '#FF0000';
    ctx.shadowBlur = 14;
    ctx.fillText('GAME OVER', GAME_W / 2, GAME_H * 0.24);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // score panel
  const pw = 230;
  const ph = 70;
  const px = (GAME_W - pw) / 2;
  const py = GAME_H * 0.50;

  ctx.save();
  ctx.fillStyle = 'rgba(6, 8, 18, 0.78)';
  roundRect(px, py, pw, ph, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.lineWidth = 1.5;
  roundRect(px, py, pw, ph, 10);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = '12px "Press Start 2P", monospace';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('SCORE  ' + score, GAME_W / 2, py + 22);

  ctx.fillStyle = '#FFD700';
  ctx.shadowColor = '#FFD700';
  ctx.shadowBlur = 8;
  ctx.font = '12px "Press Start 2P", monospace';
  ctx.fillText('BEST   ' + bestScore, GAME_W / 2, py + 49);
  ctx.shadowBlur = 0;
  ctx.restore();

  // pulsing retry prompt
  const pulse = 0.45 + Math.sin(frameCount * 0.09) * 0.5;
  ctx.save();
  ctx.globalAlpha = pulse;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '9px "Press Start 2P", monospace';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('TAP TO PLAY AGAIN', GAME_W / 2, GAME_H * 0.85);
  ctx.restore();
}


// ---------------------------------------------------------------------------
// score persistence
// ---------------------------------------------------------------------------

function saveBest() {
  try {
    bestScore = Math.max(score, parseInt(localStorage.getItem('fapbird_best') || '0', 10));
    localStorage.setItem('fapbird_best', String(bestScore));
  } catch (_) {
    // private browsing mode or storage blocked - just keep in memory
    bestScore = Math.max(score, bestScore);
  }
}

function loadBest() {
  try {
    bestScore = parseInt(localStorage.getItem('fapbird_best') || '0', 10) || 0;
  } catch (_) {
    bestScore = 0;
  }
}


// ---------------------------------------------------------------------------
// input handling
// ---------------------------------------------------------------------------
// all three input types (click, touch, keyboard) call the same function.
// the 90ms debounce stops a single tap from registering twice on devices
// that fire both touchstart and click events.

let lastInput = 0;

function handleInput() {
  const now = Date.now();
  if (now - lastInput < 90) return;
  lastInput = now;

  switch (state) {
    case STATE.READY:
      state = STATE.PLAY;
      sfx.start.play(0.5);
      break;

    case STATE.PLAY:
      bird.flap();
      break;

    case STATE.DEAD:
      // don't restart until the bird has actually landed on the ground
      if (bird.vy === 0) restartGame();
      break;
  }
}

function restartGame() {
  state = STATE.READY;
  score = 0;
  deathSoundPlayed = false;
  particles.list = [];
  bird.reset();
  pipes.reset();
  loadBest();
}

canvas.addEventListener('click', handleInput);
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  handleInput();
}, { passive: false });

document.addEventListener('keydown', (e) => {
  // space, W, up arrow, enter
  if ([32, 87, 38, 13].includes(e.keyCode)) {
    e.preventDefault();
    handleInput();
  }
});

canvas.tabIndex = 1;
canvas.focus();


// ---------------------------------------------------------------------------
// utility
// ---------------------------------------------------------------------------

// browsers are inconsistent about ctx.roundRect() so just rolling our own
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}


// ---------------------------------------------------------------------------
// main loop
// ---------------------------------------------------------------------------

function gameLoop() {
  ctx.clearRect(0, 0, GAME_W, GAME_H);

  // apply shake by offsetting the canvas transform for this frame
  ctx.save();
  ctx.translate(shake.x, shake.y);

  // draw order: background first, then pipes, ground, bird, particles, UI on top
  background.draw();
  pipes.draw();
  ground.draw();
  bird.draw();
  particles.draw();

  if (state === STATE.READY) drawGetReady();
  if (state === STATE.PLAY)  drawScore();
  if (state === STATE.DEAD)  drawGameOver();

  ctx.restore();

  // update after drawing so the first frame always shows a clean state
  shake.update();
  ground.update();
  pipes.update();
  bird.update();
  particles.update();

  frameCount++;
  requestAnimationFrame(gameLoop);
}


// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

loadBest();

// once sprites load, update the ground sprite width and rebuild caches
sprites.ground.addEventListener('load', () => {
  ground.spriteWidth = sprites.ground.naturalWidth;
  buildCaches();
});

// start the loop once the custom font is ready
// this stops the score from flashing in system font for the first frame
document.fonts.ready.then(() => {
  gameLoop();
});
