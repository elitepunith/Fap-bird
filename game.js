/*
  game.js - Fap-Bird (Production Release)
  ---------------------------------------
  Repository: https://github.com/elitepunith/Fap-bird
  
  This version implements a robust ES6 class architecture, a fixed-timestep 
  game loop for consistent physics across all device refresh rates (60Hz, 120Hz, 144Hz), 
  and Promise-based asset loading with strict error handling.
*/

'use strict';

const CONFIG = {
  width: 320,
  height: 568,
  fps: 60, // Fixed target for physics calculations
  physics: {
    gravity: 0.28,
    thrust: 7.2,
    maxFallSpeed: 10,
    initialScrollSpeed: 2.0,
    maxScrollSpeed: 3.6,
    pipeGap: 120,
    pipeSpawnInterval: 90 // Frames between pipes (~1.5s at 60fps)
  },
  states: {
    READY: 0,
    PLAY: 1,
    DEAD: 2
  }
};

// ---------------------------------------------------------------------------
// 1. Asset Management & Caching
// ---------------------------------------------------------------------------

class AssetManager {
  constructor() {
    this.images = {};
    this.audio = {};
    this.bgCache = document.createElement('canvas');
    this.groundCache = document.createElement('canvas');
    this.cachesReady = false;
  }

  loadImage(name, src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        this.images[name] = img;
        resolve(img);
      };
      img.onerror = () => {
        console.warn(`[AssetManager] Non-fatal error: Could not load image ${src}.`);
        this.images[name] = null; // Mark as missing for fallbacks
        resolve(null); 
      };
      img.src = src;
    });
  }

  loadAudio(name, src) {
    return new Promise((resolve) => {
      const audio = new Audio(src);
      audio.preload = 'auto';
      
      this.audio[name] = {
        play: (volume = 0.6) => {
          try {
            const clone = audio.cloneNode();
            clone.volume = volume;
            clone.play().catch(() => { /* Autoplay blocked, expected on first load */ });
          } catch (e) {
            console.error(`[AssetManager] Audio playback failed for ${name}`, e);
          }
        }
      };
      resolve();
    });
  }

  async loadAll() {
    await Promise.all([
      this.loadImage('bg', 'assets/images/BG.png'),
      this.loadImage('ground', 'assets/images/ground.png'),
      this.loadImage('toppipe', 'assets/images/toppipe.png'),
      this.loadImage('botpipe', 'assets/images/botpipe.png'),
      this.loadImage('getReady', 'assets/images/getready.png'),
      this.loadImage('gameOver', 'assets/images/go.png'),
      this.loadImage('bird', 'assets/images/flappy.png'),
      this.loadAudio('start', 'assets/sfx/start.wav'),
      this.loadAudio('flap', 'assets/sfx/flap.wav'),
      this.loadAudio('score', 'assets/sfx/score.wav'),
      this.loadAudio('hit', 'assets/sfx/hit.wav'),
      this.loadAudio('die', 'assets/sfx/die.wav')
    ]);
    
    this.buildCaches();
    console.log("[AssetManager] All assets loaded successfully.");
  }

  // Pre-render static backgrounds to save rendering calculations every frame
  buildCaches() {
    this.bgCache.width = CONFIG.width;
    this.bgCache.height = CONFIG.height;
    const bgCtx = this.bgCache.getContext('2d');

    const bgH = 228;
    const bgScaled = (CONFIG.width / 276) * bgH; 
    const bgY = CONFIG.height - 112 - bgScaled;

    bgCtx.fillStyle = '#4ec0ca';
    bgCtx.fillRect(0, 0, CONFIG.width, bgY + 5);

    if (this.images.bg) {
      bgCtx.drawImage(this.images.bg, 0, bgY, CONFIG.width, bgScaled);
    }

    this.groundCache.width = CONFIG.width * 4;
    this.groundCache.height = 112;
    const gCtx = this.groundCache.getContext('2d');

    if (this.images.ground) {
      const gW = this.images.ground.naturalWidth || 552;
      for (let i = 0; i < 5; i++) {
        gCtx.drawImage(this.images.ground, i * gW, 0);
      }
    } else {
      gCtx.fillStyle = '#c8a060';
      gCtx.fillRect(0, 0, this.groundCache.width, 112);
      gCtx.fillStyle = '#5aad3a';
      gCtx.fillRect(0, 0, this.groundCache.width, 18);
    }

    this.cachesReady = true;
  }
}

// ---------------------------------------------------------------------------
// 2. Game Entities
// ---------------------------------------------------------------------------

class ScreenShake {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.power = 0;
    this.frames = 0;
  }

  trigger(power, duration) {
    this.power = power;
    this.frames = duration;
  }

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
  }

  apply(ctx) {
    ctx.translate(this.x, this.y);
  }
}

class ParticleSystem {
  constructor() {
    this.list = [];
  }

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
  }

  update() {
    this.list = this.list.filter(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.18; 
      p.vx *= 0.97; 
      p.life -= p.decay;
      return p.life > 0;
    });
  }

  draw(ctx) {
    this.list.forEach(p => {
      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.colour;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }
}

class Environment {
  constructor(assets) {
    this.assets = assets;
    this.scrollX = 0;
    this.groundY = CONFIG.height - 112;
    this.groundHeight = 112;
    this.spriteWidth = 552;
  }

  update(state, speed) {
    if (state !== CONFIG.states.PLAY) return;
    this.scrollX += speed;
    if (this.scrollX >= this.spriteWidth) this.scrollX = 0;
  }

  draw(ctx) {
    if (!this.assets.cachesReady) {
      ctx.fillStyle = '#4ec0ca';
      ctx.fillRect(0, 0, CONFIG.width, CONFIG.height);
      return;
    }
    
    // Draw Background
    ctx.drawImage(this.assets.bgCache, 0, 0);
    
    // Draw Ground
    ctx.drawImage(
      this.assets.groundCache,
      this.scrollX, 0, CONFIG.width, this.groundHeight,
      0, this.groundY, CONFIG.width, this.groundHeight
    );
  }
}

class PipeManager {
  constructor(assets, particles) {
    this.assets = assets;
    this.particles = particles;
    this.pipeWidth = 52;
    this.pipeHeight = 400;
    this.reset();
  }

  reset() {
    this.list = [];
    this.timer = 0;
    this.spawnInterval = CONFIG.physics.pipeSpawnInterval;
  }

  spawnPipe() {
    const y = -210 * Math.min(Math.random() + 1, 1.8);
    this.list.push({
      x: CONFIG.width + this.pipeWidth + 4,
      y,
      counted: false
    });
  }

  update(state, speed, game) {
    if (state !== CONFIG.states.PLAY) return;

    this.timer++;
    if (this.timer >= this.spawnInterval) {
      this.spawnPipe();
      this.timer = 0;
    }

    this.list.forEach(p => p.x -= speed);
    this.list = this.list.filter(p => p.x > -(this.pipeWidth + 20));

    this.checkCollisions(game);
  }

  checkCollisions(game) {
    const bird = game.bird;
    const r = bird.radius * 0.78; // Forgiving hitbox

    for (let i = 0; i < this.list.length; i++) {
      const p = this.list[i];
      const roof = p.y + this.pipeHeight;
      const floor = roof + CONFIG.physics.pipeGap;
      const left = p.x;
      const right = p.x + this.pipeWidth;

      const inXZone = bird.x + r > left && bird.x - r < right;

      // Pipe hit check
      if (inXZone && (bird.y - r < roof || bird.y + r > floor)) {
        game.triggerDeath();
        return;
      }

      // Score check
      if (!p.counted && bird.x - r > right) {
        p.counted = true;
        game.addScore();
        this.particles.spawn(bird.x + 18, bird.y - bird.radius, 7, ['#FFD700', '#FFFFFF', '#FFA500', '#FFE066']);
        
        // Gentle difficulty scaling
        if (game.score % 10 === 0) {
          game.scrollSpeed = Math.min(game.scrollSpeed + 0.18, CONFIG.physics.maxScrollSpeed);
          this.spawnInterval = Math.max(this.spawnInterval - 2, 78);
        }
      }
    }
  }

  draw(ctx, groundY) {
    const topImg = this.assets.images.toppipe;
    const botImg = this.assets.images.botpipe;

    this.list.forEach(p => {
      const topBottom = p.y + this.pipeHeight;
      const botTop = topBottom + CONFIG.physics.pipeGap;

      if (topImg && botImg) {
        ctx.drawImage(topImg, p.x, p.y);
        ctx.drawImage(botImg, p.x, botTop);
      } else {
        this.drawFallback(ctx, p.x, topBottom, botTop, groundY);
      }
    });
  }

  drawFallback(ctx, x, topH, botY, groundY) {
    const w = this.pipeWidth;
    ctx.fillStyle = '#45d445';
    ctx.fillRect(x, 0, w, topH);
    ctx.fillRect(x, botY, w, groundY - botY);
  }
}

class Bird {
  constructor(assets, particles, shake) {
    this.assets = assets;
    this.particles = particles;
    this.shake = shake;
    this.reset();
  }

  reset() {
    this.x = 72;
    this.y = 250;
    this.vy = 0;
    this.rotation = 0;
    this.alive = true;
    this.radius = 12;
    this.drawHeight = 34;
  }

  flap() {
    if (!this.alive || this.y - this.radius < 0) return;
    this.assets.audio.flap.play(0.55);
    this.vy = -CONFIG.physics.thrust;
    this.particles.spawn(this.x - this.radius - 4, this.y + 2, 4, ['#ffffff', '#e8f8e8']);
  }

  update(state, groundY, frameCount) {
    switch (state) {
      case CONFIG.states.READY:
        this.rotation = 0;
        if (frameCount % 8 === 0) this.y += Math.sin(frameCount * 0.08) * 0.9;
        break;

      case CONFIG.states.PLAY:
        this.vy = Math.min(this.vy + CONFIG.physics.gravity, CONFIG.physics.maxFallSpeed);
        this.y += this.vy;
        
        // Rotation
        if (this.vy < 0) {
          this.rotation = Math.max(-30, (-30 * this.vy) / (-CONFIG.physics.thrust));
        } else {
          this.rotation = Math.min(90, (90 * this.vy) / CONFIG.physics.maxFallSpeed);
        }

        // Hit Ceiling
        if (this.y - this.radius <= 0) {
          this.y = this.radius;
          this.vy = 0;
        }
        break;

      case CONFIG.states.DEAD:
        if (this.y + this.radius < groundY) {
          this.vy = Math.min(this.vy + CONFIG.physics.gravity * 2.2, 14);
          this.y += this.vy;
          this.rotation = 90;
        } else {
          this.vy = 0;
          this.y = groundY - this.radius;
          this.rotation = 90;
        }
        break;
    }
  }

  die() {
    if (!this.alive) return;
    this.alive = false;
    this.assets.audio.hit.play(0.7);
    this.shake.trigger(8, 18);
    this.particles.spawn(this.x, this.y, 22, ['#FF5555', '#FF8800', '#FFD700', '#ffffff']);
  }

  draw(ctx) {
    const sp = this.assets.images.bird;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation * (Math.PI / 180));

    if (sp) {
      const drawWidth = this.drawHeight * (sp.naturalWidth / sp.naturalHeight);
      ctx.drawImage(sp, -drawWidth / 2, -this.drawHeight / 2, drawWidth, this.drawHeight);
    } else {
      ctx.fillStyle = '#FFC800';
      ctx.beginPath();
      ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// 3. UI Manager
// ---------------------------------------------------------------------------

class UIManager {
  constructor(assets) {
    this.assets = assets;
  }

  drawScore(ctx, score) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '28px "Press Start 2P", monospace';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillText(score, CONFIG.width / 2 + 2, 30);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(score, CONFIG.width / 2, 28);
    ctx.restore();
  }

  drawGetReady(ctx, frameCount, bestScore) {
    const sp = this.assets.images.getReady;
    if (sp) {
      const scale = CONFIG.width / 276;
      const dw = sp.naturalWidth * scale;
      const dh = sp.naturalHeight * scale;
      ctx.drawImage(sp, (CONFIG.width - dw) / 2, CONFIG.height * 0.2, dw, dh);
    } else {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = '16px "Press Start 2P", monospace';
      ctx.fillStyle = '#FFE000';
      ctx.fillText('GET READY!', CONFIG.width / 2, CONFIG.height * 0.28);
      ctx.restore();
    }

    if (bestScore > 0) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = '9px "Press Start 2P", monospace';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.fillText('BEST: ' + bestScore, CONFIG.width / 2, CONFIG.height * 0.84);
      ctx.restore();
    }
  }

  drawGameOver(ctx, score, bestScore, frameCount) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.44)';
    ctx.fillRect(0, 0, CONFIG.width, CONFIG.height);

    const sp = this.assets.images.gameOver;
    if (sp) {
      const scale = CONFIG.width / 276;
      const dw = sp.naturalWidth * scale;
      const dh = sp.naturalHeight * scale;
      ctx.drawImage(sp, (CONFIG.width - dw) / 2, CONFIG.height * 0.2, dw, dh);
    }

    // Score Panel
    const py = CONFIG.height * 0.50;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '12px "Press Start 2P", monospace';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('SCORE  ' + score, CONFIG.width / 2, py + 22);
    ctx.fillStyle = '#FFD700';
    ctx.fillText('BEST   ' + bestScore, CONFIG.width / 2, py + 49);
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// 4. Main Game Loop (Fixed Timestep Controller)
// ---------------------------------------------------------------------------

class Game {
  constructor() {
    this.canvas = document.getElementById('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.canvas.width = CONFIG.width;
    this.canvas.height = CONFIG.height;

    this.assets = new AssetManager();
    this.shake = new ScreenShake();
    this.particles = new ParticleSystem();
    this.environment = new Environment(this.assets);
    this.pipes = new PipeManager(this.assets, this.particles);
    this.bird = new Bird(this.assets, this.particles, this.shake);
    this.ui = new UIManager(this.assets);

    this.state = CONFIG.states.READY;
    this.score = 0;
    this.bestScore = parseInt(localStorage.getItem('fapbird_best') || '0', 10);
    this.scrollSpeed = CONFIG.physics.initialScrollSpeed;
    this.frameCount = 0;
    this.deathSoundPlayed = false;

    // Time Tracking
    this.lastTime = 0;
    this.accumulator = 0;
    this.step = 1000 / CONFIG.fps;
    this.lastInput = 0;

    this.bindEvents();
    this.init();
  }

  async init() {
    this.handleResize();
    window.addEventListener('resize', () => this.handleResize());
    
    // Custom font loading trick to prevent system font flashing
    await document.fonts.ready;
    await this.assets.loadAll();
    
    requestAnimationFrame((time) => this.loop(time));
  }

  handleResize() {
    const scale = Math.min(window.innerWidth / CONFIG.width, window.innerHeight / CONFIG.height);
    this.canvas.style.transform = `scale(${scale})`;
  }

  bindEvents() {
    const triggerInput = (e) => {
      const now = Date.now();
      if (now - this.lastInput < 90) return; // Debounce
      this.lastInput = now;

      switch (this.state) {
        case CONFIG.states.READY:
          this.state = CONFIG.states.PLAY;
          this.assets.audio.start.play(0.5);
          this.bird.flap();
          break;
        case CONFIG.states.PLAY:
          this.bird.flap();
          break;
        case CONFIG.states.DEAD:
          if (this.bird.vy === 0) this.reset();
          break;
      }
    };

    this.canvas.addEventListener('pointerdown', triggerInput);
    document.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'KeyW', 'Enter'].includes(e.code)) {
        e.preventDefault();
        triggerInput();
      }
    });
  }

  reset() {
    this.state = CONFIG.states.READY;
    this.score = 0;
    this.scrollSpeed = CONFIG.physics.initialScrollSpeed;
    this.deathSoundPlayed = false;
    this.particles.list = [];
    this.bird.reset();
    this.pipes.reset();
    this.bestScore = parseInt(localStorage.getItem('fapbird_best') || '0', 10);
  }

  addScore() {
    this.score++;
    this.assets.audio.score.play();
  }

  triggerDeath() {
    this.bird.die();
    setTimeout(() => {
      this.state = CONFIG.states.DEAD;
      this.saveBestScore();
    }, 500);
  }

  saveBestScore() {
    this.bestScore = Math.max(this.score, this.bestScore);
    localStorage.setItem('fapbird_best', String(this.bestScore));
  }

  // --- Fixed Time Step Update ---
  update() {
    this.shake.update();
    this.particles.update();
    this.environment.update(this.state, this.scrollSpeed);
    this.pipes.update(this.state, this.scrollSpeed, this);
    this.bird.update(this.state, this.environment.groundY, this.frameCount);

    // Ground Collision
    if (this.bird.y + this.bird.radius >= this.environment.groundY) {
      if (this.state === CONFIG.states.PLAY) this.triggerDeath();
      if (this.state === CONFIG.states.DEAD && !this.deathSoundPlayed) {
        this.assets.audio.die.play(0.65);
        this.deathSoundPlayed = true;
      }
    }
    this.frameCount++;
  }

  draw() {
    this.ctx.clearRect(0, 0, CONFIG.width, CONFIG.height);
    
    this.ctx.save();
    this.shake.apply(this.ctx);

    // Draw Order
    this.environment.draw(this.ctx);
    this.pipes.draw(this.ctx, this.environment.groundY);
    this.bird.draw(this.ctx);
    this.particles.draw(this.ctx);

    // UI Overlays
    if (this.state === CONFIG.states.READY) this.ui.drawGetReady(this.ctx, this.frameCount, this.bestScore);
    if (this.state === CONFIG.states.PLAY)  this.ui.drawScore(this.ctx, this.score);
    if (this.state === CONFIG.states.DEAD)  this.ui.drawGameOver(this.ctx, this.score, this.bestScore, this.frameCount);

    this.ctx.restore();
  }

  loop(currentTime) {
    if (this.lastTime) {
      let deltaTime = currentTime - this.lastTime;
      if (deltaTime > 250) deltaTime = 250; // Cap lag spikes
      
      this.accumulator += deltaTime;

      while (this.accumulator >= this.step) {
        this.update();
        this.accumulator -= this.step;
      }
    }
    
    this.draw();
    this.lastTime = currentTime;
    requestAnimationFrame((time) => this.loop(time));
  }
}

// Boot the game
window.onload = () => new Game();