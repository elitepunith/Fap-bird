// fap-bird — game.js
// drew all the sprites with canvas instead of images, so there's nothing to load
// web audio api handles sounds too — completely self-contained

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// game state machine — simple enum-ish thing
const STATE = { MENU: 0, PLAYING: 1, DEAD: 2 };
let state = STATE.MENU;

// some globals
let frames = 0;
let score = 0;
let bestScore = 0;
let gameSpeed = 2.8;
let audioCtx = null; // lazy init on first interaction (browser policy)

// ─────────────────────────────────────────────
//  CANVAS SIZING
//  fills the screen while keeping portrait ratio
// ─────────────────────────────────────────────
function resizeCanvas() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const targetRatio = 9 / 16;

  if (W / H > targetRatio) {
    // landscape or wide — fit by height
    canvas.height = H;
    canvas.width  = Math.floor(H * targetRatio);
  } else {
    // portrait or square — fit by width
    canvas.width  = W;
    canvas.height = Math.floor(W / targetRatio);
  }
}


// ─────────────────────────────────────────────
//  AUDIO  (web audio api — no .wav files)
//  tones are generated on the fly, old school style
// ─────────────────────────────────────────────
function initAudio() {
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) {
    // some old browsers don't have it, that's fine
    audioCtx = null;
  }
}

function playTone(freq, endFreq, duration, type = 'square', vol = 0.25) {
  if (!audioCtx) return;
  try {
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(endFreq, audioCtx.currentTime + duration);
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.start();
    osc.stop(audioCtx.currentTime + duration + 0.01);
  } catch (e) {
    // audio can fail silently, game still works
  }
}

const SFX = {
  flap  : () => playTone(380, 220, 0.12, 'square', 0.2),
  score : () => { playTone(660, 880, 0.08, 'square', 0.2); setTimeout(() => playTone(880, 1100, 0.08, 'square', 0.15), 80); },
  hit   : () => playTone(220, 60, 0.35, 'sawtooth', 0.4),
  die   : () => setTimeout(() => playTone(150, 40, 0.5, 'sawtooth', 0.35), 200),
};


// ─────────────────────────────────────────────
//  SCREEN SHAKE
//  a little juice goes a long way
// ─────────────────────────────────────────────
const shake = {
  x: 0, y: 0,
  power: 0,
  frames: 0,

  trigger(power, frames) {
    this.power  = power;
    this.frames = frames;
  },

  update() {
    if (this.frames > 0) {
      this.x = (Math.random() - 0.5) * this.power;
      this.y = (Math.random() - 0.5) * this.power;
      this.power  *= 0.88;
      this.frames -= 1;
    } else {
      this.x = 0;
      this.y = 0;
    }
  },
};


// ─────────────────────────────────────────────
//  PARTICLES
//  used for flap puffs and death explosion
// ─────────────────────────────────────────────
const particles = {
  list: [],

  emit(x, y, count, colors) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd   = Math.random() * 3.5 + 0.8;
      this.list.push({
        x, y,
        vx   : Math.cos(angle) * spd,
        vy   : Math.sin(angle) * spd - 1.5,  // slight upward bias
        life : 1,
        decay: 0.04 + Math.random() * 0.04,
        r    : 2 + Math.random() * 4,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
  },

  update() {
    this.list = this.list.filter(p => {
      p.x  += p.vx;
      p.y  += p.vy;
      p.vy += 0.15;  // gravity
      p.vx *= 0.97;  // drag
      p.life -= p.decay;
      return p.life > 0;
    });
  },

  draw() {
    this.list.forEach(p => {
      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.fillStyle   = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  },
};


// ─────────────────────────────────────────────
//  CITY SKYLINE
//  parallax — two layers of buildings scroll at different speeds
//  looks way cooler than a flat background
// ─────────────────────────────────────────────
const cityBg = {
  far   : [],
  close : [],
  clouds: [],
  farOffset  : 0,
  closeOffset: 0,
  cloudOffset: 0,

  init() {
    this.far    = this._genBuildings(60, 20, 40, 25, 75);
    this.close  = this._genBuildings(40, 30, 55, 50, 120);
    this.clouds = this._genClouds(7);
  },

  _genBuildings(count, minW, maxW, minH, maxH) {
    const list = [];
    let x = 0;
    for (let i = 0; i < count; i++) {
      const w = minW + Math.random() * (maxW - minW);
      const h = minH + Math.random() * (maxH - minH);
      // random windows — some lit, some dark
      const wins = [];
      for (let wy = 6; wy < h - 6; wy += 10) {
        for (let wx = 4; wx < w - 4; wx += 8) {
          wins.push({ dx: wx, dy: wy, lit: Math.random() > 0.45 });
        }
      }
      list.push({ x, w, h, wins });
      x += w + 2 + Math.random() * 6;
    }
    return list;
  },

  _genClouds(count) {
    return Array.from({ length: count }, () => ({
      x    : Math.random() * canvas.width,
      y    : canvas.height * (0.05 + Math.random() * 0.28),
      r    : canvas.width * (0.05 + Math.random() * 0.07),
      speed: 0.12 + Math.random() * 0.18,
    }));
  },

  update() {
    const spd = state === STATE.PLAYING ? gameSpeed : 0.4;
    this.farOffset    += spd * 0.25;
    this.closeOffset  += spd * 0.55;
    this.cloudOffset  += spd * 0.12;
  },

  _drawBuildingLayer(list, totalW, offset, color, winColorLit) {
    const gY = canvas.height * 0.875;
    const off = offset % totalW;

    // draw twice so scrolling wraps seamlessly
    for (let pass = 0; pass < 2; pass++) {
      const xShift = pass * totalW - off;
      list.forEach(b => {
        const bx = b.x + xShift;
        const by = gY - b.h;
        if (bx + b.w < -10 || bx > canvas.width + 10) return; // skip offscreen

        ctx.fillStyle = color;
        ctx.fillRect(bx, by, b.w, b.h);

        // windows
        b.wins.forEach(w => {
          if (!w.lit) return;
          ctx.fillStyle = winColorLit;
          ctx.fillRect(bx + w.dx, by + w.dy, 4, 3);
        });
      });
    }
  },

  _totalWidth(list) {
    if (!list.length) return canvas.width;
    const last = list[list.length - 1];
    return last.x + last.w + 8;
  },

  draw() {
    const gY = canvas.height * 0.875;

    // night sky gradient
    const sky = ctx.createLinearGradient(0, 0, 0, gY);
    sky.addColorStop(0, '#050810');
    sky.addColorStop(0.45, '#0b1535');
    sky.addColorStop(0.75, '#152050');
    sky.addColorStop(1,    '#0a1228');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, gY);

    // moon (top right area)
    const mX = canvas.width * 0.84;
    const mY = canvas.height * 0.11;
    const mR = canvas.width * 0.065;
    ctx.save();
    ctx.shadowColor = '#fffad0';
    ctx.shadowBlur  = 28;
    ctx.fillStyle   = '#fffad0';
    ctx.beginPath();
    ctx.arc(mX, mY, mR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    // crater details
    [[0.3, -0.2, 0.18], [-0.15, 0.3, 0.11], [0.1, 0.1, 0.07]].forEach(([dx, dy, cr]) => {
      ctx.fillStyle = 'rgba(180, 170, 130, 0.35)';
      ctx.beginPath();
      ctx.arc(mX + dx * mR, mY + dy * mR, mR * cr, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();

    // clouds (soft, barely visible)
    const cloudOff = this.cloudOffset;
    this.clouds.forEach(c => {
      const cx = (c.x + cloudOff * c.speed) % (canvas.width * 1.3) - canvas.width * 0.15;
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle   = '#aaccff';
      ctx.beginPath();
      ctx.arc(cx, c.y, c.r, 0, Math.PI * 2);
      ctx.arc(cx + c.r * 0.8, c.y - c.r * 0.3, c.r * 0.7, 0, Math.PI * 2);
      ctx.arc(cx + c.r * 1.5, c.y + c.r * 0.1, c.r * 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // far buildings (darker, smaller windows)
    this._drawBuildingLayer(
      this.far,
      this._totalWidth(this.far),
      this.farOffset,
      '#07101e',
      'rgba(255, 220, 100, 0.5)'
    );

    // close buildings
    this._drawBuildingLayer(
      this.close,
      this._totalWidth(this.close),
      this.closeOffset,
      '#04080f',
      'rgba(255, 230, 120, 0.7)'
    );
  },
};


// ─────────────────────────────────────────────
//  STARS
//  tiny dots that slowly drift — adds depth
// ─────────────────────────────────────────────
const stars = {
  list: [],

  init() {
    this.list = Array.from({ length: 70 }, () => ({
      x    : Math.random() * canvas.width,
      y    : Math.random() * canvas.height * 0.72,
      r    : 0.5 + Math.random() * 1.5,
      twink: Math.random() * Math.PI * 2,
      speed: 0.08 + Math.random() * 0.3,
    }));
  },

  update() {
    const spd = state === STATE.PLAYING ? gameSpeed : 0.4;
    this.list.forEach(s => {
      s.x -= s.speed * (spd / 2.8);
      s.twink += 0.04;
      if (s.x < 0) s.x = canvas.width;
    });
  },

  draw() {
    this.list.forEach(s => {
      const alpha = 0.45 + Math.sin(s.twink) * 0.4;
      ctx.fillStyle = `rgba(220, 230, 255, ${alpha})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    });
  },
};


// ─────────────────────────────────────────────
//  GROUND
//  grassy bumpy ground, scrolls with game speed
// ─────────────────────────────────────────────
const ground = {
  y      : 0,
  height : 0,
  offset : 0,
  bumps  : [],

  init() {
    this.bumps = Array.from({ length: 50 }, () => Math.random() * 5);
    this.update();
  },

  update() {
    this.height = canvas.height * 0.125;
    this.y      = canvas.height - this.height;
  },

  scroll(spd) {
    if (state === STATE.PLAYING) {
      this.offset = (this.offset + spd) % (canvas.width / 25);
    }
  },

  draw() {
    const segs  = 25;
    const segW  = canvas.width / segs;
    const gY    = this.y;

    // dirt fill
    const dirt = ctx.createLinearGradient(0, gY, 0, canvas.height);
    dirt.addColorStop(0,   '#7a4e28');
    dirt.addColorStop(0.3, '#5c3318');
    dirt.addColorStop(1,   '#3a1e08');
    ctx.fillStyle = dirt;
    ctx.fillRect(0, gY + 6, canvas.width, this.height);

    // grass with bumps
    ctx.fillStyle = '#2e8b1e';
    ctx.beginPath();
    ctx.moveTo(0, canvas.height);
    ctx.lineTo(0, gY + 6);
    for (let i = 0; i <= segs; i++) {
      const idx = Math.floor((i + this.offset / segW) % this.bumps.length);
      ctx.lineTo(i * segW, gY + 6 - (this.bumps[idx] || 0));
    }
    ctx.lineTo(canvas.width, canvas.height);
    ctx.closePath();
    ctx.fill();

    // brighter grass top edge
    ctx.fillStyle = '#40b82a';
    ctx.beginPath();
    ctx.moveTo(0, gY + 4);
    for (let i = 0; i <= segs; i++) {
      const idx = Math.floor((i + this.offset / segW) % this.bumps.length);
      ctx.lineTo(i * segW, gY + 2 - (this.bumps[idx] || 0));
    }
    ctx.lineTo(canvas.width, gY + 4);
    ctx.closePath();
    ctx.fill();
  },
};


// ─────────────────────────────────────────────
//  BIRD
//  drawn entirely with canvas arcs/paths
//  has a flapping wing animation
// ─────────────────────────────────────────────
const bird = {
  x        : 0,
  y        : 0,
  vy       : 0,
  rot      : 0,      // rotation in radians
  wingAng  : 0,
  wingDir  : 1,
  alive    : true,
  radius   : 0,
  gravity  : 0,
  flapForce: 0,
  deathY   : 0,      // where it lands on death

  init() {
    this.radius   = canvas.width * 0.055;
    this.gravity  = canvas.height * 0.00028;
    this.flapForce= canvas.height * 0.0088;
    this.x        = canvas.width * 0.25;
    this.reset();
  },

  reset() {
    this.y     = canvas.height * 0.38;
    this.vy    = 0;
    this.rot   = 0;
    this.alive = true;
  },

  flap() {
    if (!this.alive) return;
    this.vy = -this.flapForce;
    SFX.flap();
    // little puff behind the bird when flapping
    particles.emit(this.x - this.radius, this.y, 5, ['#FFE066', '#fff', '#FFB800']);
  },

  update() {
    // wing flap animation — always going
    this.wingAng += 0.18 * this.wingDir;
    if (Math.abs(this.wingAng) > 0.45) this.wingDir *= -1;

    if (!this.alive) {
      // dead — fall fast and rotate sideways
      this.vy += this.gravity * 2.5;
      this.y  += this.vy;
      this.rot = Math.PI / 2;
      if (this.y >= ground.y - this.radius) {
        this.y  = ground.y - this.radius;
        this.vy = 0;
      }
      return;
    }

    switch (state) {
      case STATE.MENU:
        // gentle bob on menu screen
        this.y   = canvas.height * 0.38 + Math.sin(frames * 0.055) * 9;
        this.rot = Math.sin(frames * 0.055) * 0.18;
        break;

      case STATE.PLAYING:
        this.vy += this.gravity;
        // cap falling speed so it doesn't go insane
        this.vy  = Math.min(this.vy, canvas.height * 0.013);
        this.y  += this.vy;

        // smooth rotation — nose up when rising, nose down when falling
        const targetRot = this.vy > 0
          ? Math.min(Math.PI / 2, this.vy * 3.2)
          : Math.max(-0.45, this.vy * 2);
        this.rot += (targetRot - this.rot) * 0.14;

        // ceiling bounce
        if (this.y - this.radius < 0) {
          this.y  = this.radius;
          this.vy = 0;
        }

        // floor collision → die
        if (this.y + this.radius >= ground.y) {
          this.y = ground.y - this.radius;
          this._die();
        }
        break;
    }
  },

  _die() {
    if (!this.alive) return;
    this.alive = false;
    SFX.hit();
    SFX.die();
    shake.trigger(7, 14);
    particles.emit(this.x, this.y, 18, ['#FF5555', '#FF9900', '#FFE066', '#fff']);
    // switch to dead state after a short delay so the death animation plays
    setTimeout(() => {
      state = STATE.DEAD;
      _saveBest();
    }, 700);
  },

  draw() {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot);

    const r = this.radius;

    // drop shadow
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(3, r * 0.72, r * 0.72, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // body gradient
    const bodyGrad = ctx.createRadialGradient(-r * 0.25, -r * 0.28, r * 0.08, 0, 0, r);
    bodyGrad.addColorStop(0, '#FFE566');
    bodyGrad.addColorStop(0.55, '#FFD000');
    bodyGrad.addColorStop(1, '#CC8800');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // wing — rotates based on wingAng
    ctx.save();
    ctx.rotate(this.wingAng);
    ctx.fillStyle = '#CC8800';
    ctx.beginPath();
    ctx.ellipse(-r * 0.18, r * 0.05, r * 0.52, r * 0.26, -0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // belly patch (lighter area)
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.ellipse(r * 0.08, r * 0.22, r * 0.42, r * 0.3, 0.2, 0, Math.PI * 2);
    ctx.fill();

    // eye white
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(r * 0.3, -r * 0.18, r * 0.32, 0, Math.PI * 2);
    ctx.fill();

    // pupil — slightly toward beak
    ctx.fillStyle = '#1a1a2e';
    ctx.beginPath();
    ctx.arc(r * 0.38, -r * 0.14, r * 0.16, 0, Math.PI * 2);
    ctx.fill();

    // eye shine
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(r * 0.44, -r * 0.2, r * 0.065, 0, Math.PI * 2);
    ctx.fill();

    // beak (two triangles make a beak shape)
    ctx.fillStyle = '#FF8C00';
    ctx.beginPath();
    ctx.moveTo(r * 0.6, -r * 0.08);
    ctx.lineTo(r * 1.12, r * 0.04);
    ctx.lineTo(r * 0.6, r * 0.22);
    ctx.closePath();
    ctx.fill();
    // beak divider line
    ctx.strokeStyle = '#CC5500';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(r * 0.62, r * 0.07);
    ctx.lineTo(r * 1.02, r * 0.07);
    ctx.stroke();

    ctx.restore();
  },
};


// ─────────────────────────────────────────────
//  PIPES
//  neon green, glow effect, collision detection
// ─────────────────────────────────────────────
const pipes = {
  list    : [],
  timer   : 0,
  interval: 90,     // frames between spawns
  gap     : 0,      // pixel gap between top/bot pipe
  width   : 0,
  scored  : new Set(),  // track which pipes have been scored

  init() {
    this.gap   = canvas.height * 0.23;
    this.width = canvas.width  * 0.145;
    this.reset();
  },

  reset() {
    this.list   = [];
    this.timer  = 50;  // first pipe comes a little early
    this.scored.clear();
    this.interval = 90;
  },

  _spawn() {
    const topMin = canvas.height * 0.12;
    const topMax = canvas.height * 0.60;
    const gapMid = topMin + Math.random() * (topMax - topMin);
    this.list.push({
      x   : canvas.width + this.width + 5,
      mid : gapMid,
      id  : frames,
    });
  },

  update() {
    if (state !== STATE.PLAYING) return;

    this.timer++;
    if (this.timer >= this.interval) {
      this._spawn();
      this.timer = 0;
    }

    const spd = gameSpeed;
    this.list.forEach(p => p.x -= spd);

    // remove offscreen pipes
    this.list = this.list.filter(p => p.x > -this.width * 2);

    // scoring + collision
    this.list.forEach(p => {
      const topBot = p.mid - this.gap / 2;  // bottom edge of top pipe
      const botTop = p.mid + this.gap / 2;  // top edge of bottom pipe

      // did the bird clear this pipe?
      if (p.x + this.width < bird.x && !this.scored.has(p.id)) {
        this.scored.add(p.id);
        score++;
        SFX.score();
        particles.emit(bird.x, bird.y - bird.radius, 8, ['#00ff88', '#00ffcc', '#fff']);
        // gradually speed up — every 5 pipes
        if (score % 5 === 0) {
          gameSpeed     = Math.min(gameSpeed + 0.28, 5.5);
          this.interval = Math.max(this.interval - 2, 68);
        }
      }

      // collision check (using slightly shrunk hitbox — feels fairer)
      if (!bird.alive) return;
      const br  = bird.radius * 0.78;
      const bx  = bird.x;
      const by  = bird.y;
      const pL  = p.x;
      const pR  = p.x + this.width;

      if (bx + br > pL && bx - br < pR) {
        if (by - br < topBot || by + br > botTop) {
          bird._die();
        }
      }
    });
  },

  _drawSinglePipe(x, y, h, isTop) {
    const w    = this.width;
    const capH = Math.max(8, canvas.height * 0.038);
    const capW = w * 1.18;
    const capX = x - (capW - w) / 2;

    // pipe body gradient (left-light-right-dark feel)
    const pg = ctx.createLinearGradient(x, 0, x + w, 0);
    pg.addColorStop(0,    '#126120');
    pg.addColorStop(0.28, '#3ddf5e');
    pg.addColorStop(0.65, '#1e9935');
    pg.addColorStop(1,    '#0a3b12');
    ctx.fillStyle = pg;

    if (isTop) {
      ctx.fillRect(x, y, w, h - capH);
      // cap
      const cg = ctx.createLinearGradient(capX, 0, capX + capW, 0);
      cg.addColorStop(0,    '#126120');
      cg.addColorStop(0.28, '#3ddf5e');
      cg.addColorStop(1,    '#0a3b12');
      ctx.fillStyle = cg;
      ctx.fillRect(capX, h - capH + y, capW, capH);
    } else {
      ctx.fillRect(x, y + capH, w, h - capH);
      // cap
      const cg = ctx.createLinearGradient(capX, 0, capX + capW, 0);
      cg.addColorStop(0,    '#126120');
      cg.addColorStop(0.28, '#3ddf5e');
      cg.addColorStop(1,    '#0a3b12');
      ctx.fillStyle = cg;
      ctx.fillRect(capX, y, capW, capH);
    }

    // highlight stripe on the left side
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    if (isTop) ctx.fillRect(x + w * 0.14, y, w * 0.13, h - capH);
    else        ctx.fillRect(x + w * 0.14, y + capH, w * 0.13, h - capH);

    // neon outline glow
    ctx.save();
    ctx.shadowColor = '#00ff55';
    ctx.shadowBlur  = 10;
    ctx.strokeStyle = 'rgba(0, 255, 80, 0.5)';
    ctx.lineWidth   = 1.5;
    if (isTop) {
      ctx.strokeRect(x, y, w, h - capH);
      ctx.strokeRect(capX, h - capH + y, capW, capH);
    } else {
      ctx.strokeRect(x, y + capH, w, h - capH);
      ctx.strokeRect(capX, y, capW, capH);
    }
    ctx.shadowBlur = 0;
    ctx.restore();
  },

  draw() {
    this.list.forEach(p => {
      const topH = p.mid - this.gap / 2;
      const botY = p.mid + this.gap / 2;
      const botH = ground.y - botY;

      this._drawSinglePipe(p.x, 0,    topH, true);
      this._drawSinglePipe(p.x, botY, botH, false);
    });
  },
};


// ─────────────────────────────────────────────
//  SCORE DISPLAY
// ─────────────────────────────────────────────
function drawHUD() {
  if (state !== STATE.PLAYING) return;
  ctx.save();
  ctx.textAlign  = 'center';
  ctx.textBaseline = 'top';

  const fSize = Math.max(18, canvas.width * 0.11);
  ctx.font = `${fSize}px 'Press Start 2P', monospace`;

  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillText(score, canvas.width / 2 + 3, canvas.height * 0.045 + 3);
  // main text
  ctx.fillStyle = '#ffffff';
  ctx.fillText(score, canvas.width / 2, canvas.height * 0.045);

  ctx.restore();
}


// ─────────────────────────────────────────────
//  MENU SCREEN
// ─────────────────────────────────────────────
function drawMenu() {
  ctx.save();
  ctx.textAlign = 'center';

  // big title — two lines with different colors
  const titleSize = Math.max(22, canvas.width * 0.115);
  ctx.font        = `${titleSize}px 'Press Start 2P', monospace`;

  // glow pass
  ctx.save();
  ctx.shadowColor = '#FFD000';
  ctx.shadowBlur  = 22;
  ctx.fillStyle   = '#FFD000';
  ctx.fillText('FAP', canvas.width / 2, canvas.height * 0.25);
  ctx.shadowColor = '#FF5522';
  ctx.fillStyle   = '#FF6633';
  ctx.fillText('BIRD', canvas.width / 2, canvas.height * 0.36);
  ctx.shadowBlur = 0;
  ctx.restore();

  // tap to play — pulsing opacity
  const pulse    = 0.45 + Math.sin(frames * 0.09) * 0.45;
  const subSize  = Math.max(8, canvas.width * 0.042);
  ctx.font       = `${subSize}px 'Press Start 2P', monospace`;
  ctx.globalAlpha = pulse;
  ctx.fillStyle  = '#ffffff';
  ctx.fillText('TAP TO PLAY', canvas.width / 2, canvas.height * 0.70);
  ctx.globalAlpha = 1;

  // controls hint — tiny
  const hintSize = Math.max(6, canvas.width * 0.032);
  ctx.font       = `${hintSize}px 'Press Start 2P', monospace`;
  ctx.fillStyle  = 'rgba(255,255,255,0.4)';
  ctx.fillText('SPACE / W / ↑  also work', canvas.width / 2, canvas.height * 0.77);

  // best score
  if (bestScore > 0) {
    const bsSize = Math.max(8, canvas.width * 0.040);
    ctx.font      = `${bsSize}px 'Press Start 2P', monospace`;
    ctx.fillStyle = '#FFD000';
    ctx.shadowColor = '#FFD000';
    ctx.shadowBlur  = 8;
    ctx.fillText(`BEST: ${bestScore}`, canvas.width / 2, canvas.height * 0.84);
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}


// ─────────────────────────────────────────────
//  GAME OVER SCREEN
// ─────────────────────────────────────────────
function drawGameOver() {
  // darken overlay
  ctx.fillStyle = 'rgba(0,0,0,0.52)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.textAlign = 'center';

  const bigSize = Math.max(18, canvas.width * 0.096);
  ctx.font      = `${bigSize}px 'Press Start 2P', monospace`;

  // game over text with red glow
  ctx.save();
  ctx.shadowColor = '#FF3333';
  ctx.shadowBlur  = 24;
  ctx.fillStyle   = '#FF4444';
  ctx.fillText('GAME', canvas.width / 2, canvas.height * 0.31);
  ctx.fillText('OVER', canvas.width / 2, canvas.height * 0.42);
  ctx.shadowBlur = 0;
  ctx.restore();

  // score panel — hand drawn panel feel
  const pW = canvas.width * 0.76;
  const pH = canvas.height * 0.18;
  const pX = (canvas.width - pW) / 2;
  const pY = canvas.height * 0.51;

  ctx.fillStyle   = 'rgba(10, 15, 30, 0.85)';
  ctx.strokeStyle = 'rgba(0, 200, 80, 0.5)';
  ctx.lineWidth   = 2;
  _roundRect(pX, pY, pW, pH, 6);
  ctx.fill();
  ctx.stroke();

  const sSize = Math.max(8, canvas.width * 0.042);
  ctx.font      = `${sSize}px 'Press Start 2P', monospace`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`SCORE: ${score}`, canvas.width / 2, pY + pH * 0.3);
  ctx.fillStyle   = '#FFD000';
  ctx.shadowColor = '#FFD000';
  ctx.shadowBlur  = 6;
  ctx.fillText(`BEST: ${bestScore}`, canvas.width / 2, pY + pH * 0.68);
  ctx.shadowBlur = 0;

  // tap to retry
  const pulse    = 0.45 + Math.sin(frames * 0.11) * 0.45;
  const retSize  = Math.max(7, canvas.width * 0.038);
  ctx.font       = `${retSize}px 'Press Start 2P', monospace`;
  ctx.globalAlpha = pulse;
  ctx.fillStyle  = '#ffffff';
  ctx.fillText('TAP TO RETRY', canvas.width / 2, canvas.height * 0.83);
  ctx.globalAlpha = 1;

  ctx.restore();
}

// helper — ctx doesn't have native rounded rects in all browsers
function _roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}


// ─────────────────────────────────────────────
//  SCORE PERSISTENCE
// ─────────────────────────────────────────────
function _saveBest() {
  try {
    bestScore = Math.max(score, parseInt(localStorage.getItem('fapbird-best') || '0'));
    localStorage.setItem('fapbird-best', bestScore);
  } catch (e) {
    // private browsing or blocked storage — just keep in memory
    bestScore = Math.max(score, bestScore);
  }
}

function _loadBest() {
  try {
    bestScore = parseInt(localStorage.getItem('fapbird-best') || '0') || 0;
  } catch (e) {
    bestScore = 0;
  }
}


// ─────────────────────────────────────────────
//  INPUT HANDLING
//  click, touch, and keyboard all do the same thing
// ─────────────────────────────────────────────
let inputCooldown = 0;  // prevent double-firing

function handleInput() {
  if (Date.now() - inputCooldown < 80) return;
  inputCooldown = Date.now();

  // init audio on first interaction (browser requires user gesture)
  if (!audioCtx) initAudio();

  switch (state) {
    case STATE.MENU:
      _startGame();
      break;
    case STATE.PLAYING:
      bird.flap();
      break;
    case STATE.DEAD:
      // brief delay check so you don't accidentally restart mid-animation
      if (!bird.alive && bird.vy === 0) {
        _startGame();
      }
      break;
  }
}

function _startGame() {
  score     = 0;
  gameSpeed = 2.8;
  state     = STATE.PLAYING;
  bird.init();
  bird.reset();
  pipes.reset();
  particles.list = [];
}

canvas.addEventListener('click', handleInput);
canvas.addEventListener('touchstart', (e) => { e.preventDefault(); handleInput(); }, { passive: false });

document.addEventListener('keydown', (e) => {
  // space, W, arrow up, enter
  if ([32, 87, 38, 13].includes(e.keyCode)) {
    e.preventDefault();
    handleInput();
  }
});


// ─────────────────────────────────────────────
//  RESIZE HANDLER
//  reinit size-dependent values on window resize
// ─────────────────────────────────────────────
window.addEventListener('resize', () => {
  resizeCanvas();
  ground.update();
  bird.init();
  pipes.init();
  stars.init();
  cityBg.init();
});


// ─────────────────────────────────────────────
//  MAIN LOOP
// ─────────────────────────────────────────────
function loop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  shake.update();
  ctx.translate(shake.x, shake.y);

  // draw order: bg → stars → pipes → ground → bird → particles → HUD → UI
  cityBg.update();
  cityBg.draw();

  stars.update();
  stars.draw();

  pipes.update();
  pipes.draw();

  ground.scroll(gameSpeed);
  ground.draw();

  bird.update();
  bird.draw();

  particles.update();
  particles.draw();

  drawHUD();

  if (state === STATE.MENU) drawMenu();
  if (state === STATE.DEAD) drawGameOver();

  ctx.restore();

  frames++;
  requestAnimationFrame(loop);
}


// ─────────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────────
resizeCanvas();
_loadBest();
ground.init();
stars.init();
cityBg.init();
bird.init();
pipes.init();

loop();
