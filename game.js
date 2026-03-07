/**
 * Fap-bird Pro Engine
 * -------------------
 * We've split the logic into manageable pieces. Asset loading happens first, 
 * then we define our entities, and finally the Game class brings it all together.
 */

// --- 1. Asset & Sound Managers ---

const assets = {
    bird: new Image(),
    pipeTop: new Image(),
    pipeBottom: new Image()
};

// Flags to track if an image actually loaded. If a file is missing, we'll draw shapes instead.
let imagesLoaded = { bird: false, pipeTop: false, pipeBottom: false };

assets.bird.onload = () => imagesLoaded.bird = true;
assets.pipeTop.onload = () => imagesLoaded.pipeTop = true;
assets.pipeBottom.onload = () => imagesLoaded.pipeBottom = true;

// Pointing to your new directory structure!
assets.bird.src = 'assets/images/bird.png'; 
assets.pipeTop.src = 'assets/images/pipe-top.png';
assets.pipeBottom.src = 'assets/images/pipe-bottom.png';

class SoundManager {
    constructor() {
        try {
            // Loading sounds from the assets folder.
            this.flapSound = new Audio('assets/sounds/flap.mp3');
            this.scoreSound = new Audio('assets/sounds/score.mp3');
            this.hitSound = new Audio('assets/sounds/hit.mp3');
            
            this.flapSound.volume = 0.5;
            this.scoreSound.volume = 0.5;
            this.hitSound.volume = 0.6;
        } catch (error) {
            console.warn("Audio not found. Game will run silently.");
        }
    }

    play(soundName) {
        try {
            const sound = this[soundName + 'Sound'];
            if (!sound) return;
            // Reset to 0 so we can play the same sound rapidly (like fast flapping)
            sound.currentTime = 0; 
            sound.play().catch(e => { /* Ignore browser autoplay block errors */ });
        } catch (e) {}
    }
}

// --- 2. Game Entities ---

class Bird {
    constructor(canvas) {
        this.canvas = canvas;
        this.x = 60;
        this.y = canvas.height / 2;
        
        // These dimensions should roughly match your bird.png
        this.width = 34; 
        this.height = 24; 
        
        this.velocity = 0;
        this.gravity = 0.4; 
        this.jumpStrength = -6.5; 
    }

    flap() {
        this.velocity = this.jumpStrength;
    }

    update() {
        this.velocity += this.gravity;
        this.y += this.velocity;
    }

    draw(ctx) {
        if (imagesLoaded.bird) {
            ctx.save();
            ctx.translate(this.x, this.y);
            
            // Give the bird a slight tilt based on whether it's going up or down.
            let rotation = Math.min(Math.PI / 4, Math.max(-Math.PI / 4, (this.velocity * 0.1)));
            ctx.rotate(rotation);
            
            ctx.drawImage(assets.bird, -this.width / 2, -this.height / 2, this.width, this.height);
            ctx.restore();
        } else {
            // Safe fallback to a yellow circle
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.height / 2, 0, Math.PI * 2);
            ctx.fillStyle = '#f1c40f';
            ctx.fill();
            ctx.stroke();
        }
    }
}

class Pipe {
    constructor(canvas) {
        this.canvas = canvas;
        this.x = canvas.width;
        this.width = 52; 
        this.gapSize = 110; 
        this.speed = 2.5;

        // Calculate random heights ensuring the gap never goes off-screen
        const minPipeHeight = 50;
        const maxTopPipeHeight = canvas.height - this.gapSize - minPipeHeight;
        
        this.topHeight = Math.floor(Math.random() * (maxTopPipeHeight - minPipeHeight + 1) + minPipeHeight);
        this.bottomY = this.topHeight + this.gapSize;
        this.bottomHeight = this.canvas.height - this.bottomY;
        
        this.passed = false;
    }

    update() {
        this.x -= this.speed;
    }

    draw(ctx) {
        if (imagesLoaded.pipeTop) {
            // The image might be tall, so we draw it stretching upwards from the gap.
            ctx.drawImage(assets.pipeTop, this.x, this.topHeight - 320, this.width, 320); 
        } else {
            ctx.fillStyle = '#2ecc71';
            ctx.fillRect(this.x, 0, this.width, this.topHeight);
            ctx.strokeRect(this.x, 0, this.width, this.topHeight);
        }

        if (imagesLoaded.pipeBottom) {
            ctx.drawImage(assets.pipeBottom, this.x, this.bottomY, this.width, 320);
        } else {
            ctx.fillStyle = '#2ecc71';
            ctx.fillRect(this.x, this.bottomY, this.width, this.bottomHeight);
            ctx.strokeRect(this.x, this.bottomY, this.width, this.bottomHeight);
        }
    }
}

// --- 3. Core Engine ---

class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.messageEl = document.getElementById('message');
        this.sounds = new SoundManager();
        
        this.state = 'START'; // Keeps track of what screen we're on
        this.frames = 0;
        this.score = 0;
        this.pipes = [];
        this.bird = new Bird(this.canvas);
        
        this.setupInputs();
        this.loop(); 
    }

    setupInputs() {
        // One unified function to handle both taps and clicks.
        const inputAction = (e) => {
            // Allow normal keys, but steal the Spacebar so the page doesn't scroll down.
            if (e.type === 'keydown' && e.code !== 'Space') return;
            if (e.cancelable) e.preventDefault(); 

            if (this.state === 'START' || this.state === 'GAMEOVER') {
                this.resetGame();
            } else if (this.state === 'PLAYING') {
                this.bird.flap();
                this.sounds.play('flap');
            }
        };

        window.addEventListener('keydown', inputAction);
        this.canvas.addEventListener('mousedown', inputAction); 
        // passive: false is critical here, otherwise e.preventDefault() won't work on mobile
        this.canvas.addEventListener('touchstart', inputAction, { passive: false });
    }

    resetGame() {
        this.bird = new Bird(this.canvas);
        this.pipes = [];
        this.score = 0;
        this.frames = 0;
        this.state = 'PLAYING';
        this.messageEl.classList.add('hidden');
    }

    checkCollisions() {
        // Did we hit the floor or the ceiling?
        if (this.bird.y + (this.bird.height/2) >= this.canvas.height || this.bird.y - (this.bird.height/2) <= 0) {
            return true;
        }

        // Did we smack into a pipe?
        for (let pipe of this.pipes) {
            const birdLeft = this.bird.x - (this.bird.width / 2);
            const birdRight = this.bird.x + (this.bird.width / 2);
            const birdTop = this.bird.y - (this.bird.height / 2);
            const birdBottom = this.bird.y + (this.bird.height / 2);

            const hitPipeX = birdRight > pipe.x && birdLeft < pipe.x + pipe.width;
            const hitTopPipeY = birdTop < pipe.topHeight;
            const hitBottomPipeY = birdBottom > pipe.bottomY;

            if (hitPipeX && (hitTopPipeY || hitBottomPipeY)) {
                return true;
            }
        }
        return false;
    }

    update() {
        if (this.state !== 'PLAYING') return;

        this.frames++;
        this.bird.update();

        // Spawn a pipe every 90 frames
        if (this.frames % 90 === 0) {
            this.pipes.push(new Pipe(this.canvas));
        }

        // Move pipes and check for points
        for (let i = this.pipes.length - 1; i >= 0; i--) {
            let pipe = this.pipes[i];
            pipe.update();

            // Give a point if we just crossed the pipe's right edge
            if (!pipe.passed && this.bird.x > pipe.x + pipe.width) {
                this.score++;
                pipe.passed = true;
                this.sounds.play('score');
            }

            // Clean up pipes that are off-screen to save memory
            if (pipe.x + pipe.width < 0) {
                this.pipes.splice(i, 1);
            }
        }

        if (this.checkCollisions()) {
            this.sounds.play('hit');
            this.state = 'GAMEOVER';
            this.messageEl.innerHTML = `Game Over<br>Score: ${this.score}<br><br><span style="font-size:16px;">Tap to restart</span>`;
            this.messageEl.classList.remove('hidden');
        }
    }

    draw() {
        // Wipe the canvas clean every frame
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        for (let pipe of this.pipes) {
            pipe.draw(this.ctx);
        }
        
        this.bird.draw(this.ctx);

        // Draw the score
        if (this.state === 'PLAYING') {
            this.ctx.fillStyle = 'white';
            this.ctx.font = 'bold 36px sans-serif';
            this.ctx.lineWidth = 2;
            this.ctx.strokeStyle = 'black';
            const scoreStr = this.score.toString();
            const w = this.ctx.measureText(scoreStr).width;
            
            // Center the score at the top
            this.ctx.fillText(scoreStr, (this.canvas.width / 2) - (w / 2), 60);
            this.ctx.strokeText(scoreStr, (this.canvas.width / 2) - (w / 2), 60);
        }
    }

    loop() {
        this.update();
        this.draw();
        // This is much smoother than setInterval
        requestAnimationFrame(() => this.loop());
    }
}

// Start the game once the file runs
const game = new Game();