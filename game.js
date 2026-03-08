/*
  game.js - Fap-Bird (Production Refactor)
  ----------------------------------------
  This version implements a robust ES6 class architecture, a fixed-timestep 
  game loop for consistent physics across all device refresh rates, and 
  Promise-based asset loading with strict error handling.
*/

'use strict';

const CONFIG = {
  width: 320,
  height: 568,
  physics: {
    gravity: 0.28,
    thrust: -7.2,
    maxFallSpeed: 10,
    scrollSpeed: 2.0
  },
  fps: 60, // Fixed target for physics calculations
};

// ---------------------------------------------------------------------------
// 1. Asset Management & Error Handling
// ---------------------------------------------------------------------------
// Using Promises ensures the game doesn't boot until everything is ready.
// If an asset 404s, we catch the error instead of crashing the canvas.

class AssetManager {
  constructor() {
    this.images = {};
    this.audio = {};
  }

  loadImage(name, src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.images[name] = img;
        resolve(img);
      };
      img.onerror = () => {
        console.warn(`[AssetManager] Non-fatal error: Could not load image ${src}. Falling back to canvas rendering.`);
        // Resolve anyway so the game continues using fallback drawing
        resolve(null); 
      };
      img.src = src;
    });
  }

  loadAudio(name, src) {
    return new Promise((resolve) => {
      const audio = new Audio(src);
      audio.preload = 'auto';
      
      // We wrap play() in a try/catch because browsers strictly block 
      // autoplaying audio before user interaction.
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
      resolve(); // Audio is non-blocking
    });
  }

  async loadAll() {
    try {
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
      console.log("[AssetManager] All assets loaded successfully.");
    } catch (error) {
      console.error("[AssetManager] Critical failure loading assets:", error);
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Entities (Encapsulated logic)
// ---------------------------------------------------------------------------

class Bird {
  constructor(assets) {
    this.assets = assets;
    this.reset();
  }

  reset() {
    this.x = 72;
    this.y = 250;
    this.vy = 0;
    this.rotation = 0;
    this.alive = true;
    this.radius = 12;
  }

  flap() {
    if (!this.alive || this.y - this.radius < 0) return;
    this.vy = CONFIG.physics.thrust;
    this.assets.audio.flap.play(0.55);
  }

  update(state) {
    if (state === 'READY') {
      // Gentle floating animation
      this.y = 250 + Math.sin(Date.now() / 150) * 4;
      return;
    }

    // Apply physics
    this.vy = Math.min(this.vy + CONFIG.physics.gravity, CONFIG.physics.maxFallSpeed);
    this.y += this.vy;

    // Rotation calculation
    if (this.vy < 0) {
      this.rotation = Math.max(-30, (-30 * this.vy) / CONFIG.physics.thrust);
    } else {
      this.rotation = Math.min(90, (90 * this.vy) / CONFIG.physics.maxFallSpeed);
    }
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation * (Math.PI / 180));

    const sprite = this.assets.images.bird;
    if (sprite) {
      const drawHeight = 34;
      const drawWidth = drawHeight * (sprite.naturalWidth / sprite.naturalHeight);
      ctx.drawImage(sprite, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    } else {
      // Fallback graphics (vibrant colors)
      ctx.fillStyle = '#FFC800';
      ctx.beginPath();
      ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// 3. Main Game Loop (Fixed Timestep)
// ---------------------------------------------------------------------------

class Game {
  constructor() {
    this.canvas = document.getElementById('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.assets = new AssetManager();
    
    this.canvas.width = CONFIG.width;
    this.canvas.height = CONFIG.height;
    
    this.state = 'LOADING'; // LOADING, READY, PLAY, DEAD
    this.bird = new Bird(this.assets);
    
    // Fixed timestep variables
    this.lastTime = 0;
    this.accumulator = 0;
    this.step = 1000 / CONFIG.fps;

    this.bindEvents();
    this.init();
  }

  async init() {
    this.handleResize();
    window.addEventListener('resize', () => this.handleResize());
    
    await this.assets.loadAll();
    this.state = 'READY';
    
    // Start the animation frame
    requestAnimationFrame((time) => this.loop(time));
  }

  handleResize() {
    const scaleX = window.innerWidth / CONFIG.width;
    const scaleY = window.innerHeight / CONFIG.height;
    const scale = Math.min(scaleX, scaleY);
    this.canvas.style.transform = `scale(${scale})`;
  }

  bindEvents() {
    const triggerFlap = (e) => {
      e.preventDefault();
      if (this.state === 'READY') {
        this.state = 'PLAY';
        this.assets.audio.start.play(0.5);
      }
      if (this.state === 'PLAY') this.bird.flap();
      if (this.state === 'DEAD' && this.bird.vy === 0) this.reset();
    };

    this.canvas.addEventListener('pointerdown', triggerFlap);
    document.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'KeyW'].includes(e.code)) triggerFlap(e);
    });
  }

  reset() {
    this.bird.reset();
    this.state = 'READY';
  }

  update() {
    // Physics and logic update goes here.
    // Because of the fixed timestep, this ALWAYS runs 60 times a second.
    this.bird.update(this.state);
    
    // Ground collision check
    if (this.bird.y + this.bird.radius >= CONFIG.height - 112) {
      this.bird.y = CONFIG.height - 112 - this.bird.radius;
      if (this.state === 'PLAY') {
        this.state = 'DEAD';
        this.assets.audio.hit.play(0.7);
      }
    }
  }

  draw() {
    this.ctx.clearRect(0, 0, CONFIG.width, CONFIG.height);
    
    // Draw sky background fallback
    this.ctx.fillStyle = '#4ec0ca';
    this.ctx.fillRect(0, 0, CONFIG.width, CONFIG.height);

    this.bird.draw(this.ctx);
  }

  loop(currentTime) {
    if (this.lastTime) {
      // Calculate delta time
      let deltaTime = currentTime - this.lastTime;
      
      // Cap delta time to prevent spiral of death on lag spikes
      if (deltaTime > 250) deltaTime = 250; 
      
      this.accumulator += deltaTime;

      // Consume the accumulator in fixed physical steps
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