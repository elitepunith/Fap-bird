# Fap-Bird

A Flappy Bird clone built with vanilla HTML, CSS, and JavaScript. No frameworks,
no build tools, no dependencies. Just open index.html and it runs.

The physics are tuned to match the original game as closely as possible.
Gravity is 0.28 per frame, flap force is -7.2, and the pipe gap is 120px.
If you've played the original, it should feel immediately familiar.


## Project structure

```
fap-bird/
    index.html              entry point, minimal markup
    style.css               fullscreen CSS scale approach, no resize logic in JS
    game.js                 entire game - ~530 lines, no external dependencies
    vercel.json             static deployment config
    assets/
        images/
            flappy.png      the bird sprite (pixel art, 1024x522)
            BG.png          background sprite (276x228)
            ground.png      ground strip (552x112, tiles seamlessly)
            toppipe.png     top pipe (52x400)
            botpipe.png     bottom pipe (52x400)
            getready.png    "Get Ready!" screen (174x160)
            go.png          "Game Over" screen (188x144)
        sfx/
            start.wav
            flap.wav
            score.wav
            hit.wav
            die.wav
```


## How fullscreen works

The canvas is always 320x568 internally. That resolution was chosen because
it makes the sprites feel the right size and matches a common phone screen ratio.

Instead of resizing the canvas and recalculating all the sprite positions,
the CSS just applies a `transform: scale()` to blow it up to whatever the
screen happens to be. The game logic never has to care about window size.

On a 1920x1080 monitor it fills the screen vertically. On a phone it fills
the whole display. On an ultrawide it letterboxes with the sky colour as background.


## Why it was lagging before (and what fixed it)

The old version ran all the background drawing code every frame - gradient
calculations, arc drawing for clouds, the whole thing, 60 times per second.
That adds up fast, especially on phones.

The fix is to pre-render the background and ground onto offscreen canvases
at startup, then just blit those cached images every frame. One drawImage
call is dramatically cheaper than re-running the gradient code each tick.

Using requestAnimationFrame instead of setInterval also helps. setInterval
drifts over time and can cause the browser to do redundant work. rAF syncs
to the display refresh rate and the browser can pause it when the tab is hidden.


## Physics reference

These values were eyeballed from video recordings of the original game.

    gravity per frame:   0.28
    flap velocity:       -7.2  (negative = upward)
    max fall speed:       10 px/frame
    scroll speed:         2.0 px/frame (starts here, max 3.6)
    pipe gap:             120 px
    pipe spawn interval:  90 frames (~1.5 seconds at 60fps)
    speed increase:       +0.18 px/frame every 10 points
    hitbox:               78% of visual bird size (same forgiveness as original)


## Controls

    Click / Tap     flap
    Spacebar        flap
    W               flap
    Up arrow        flap
    Enter           flap


## Running locally

No build step needed. Open index.html directly in a browser, or use any
static file server if you want proper MIME types for the audio files:

    npx serve .
    # or
    python3 -m http.server 3000

The audio sometimes doesn't play when opening the file directly via file://
because browsers restrict autoplay on local files. Using a local server fixes that.


## Deploying to Vercel

Option A - Vercel CLI:

    npm install -g vercel
    cd fap-bird
    vercel

Option B - from GitHub:

1. Push this folder to a repository
2. Go to vercel.com and click "New Project"
3. Import the repository
4. Set the framework preset to "Other"
5. Leave the root directory and build settings blank
6. Click Deploy

No environment variables, no build commands. It's a static site.


## Adding your own bird logo to the title screen

Drop an image file at assets/images/birds/logo.png and update the
birdLogo path in game.js. The get-ready screen will show it above the
"Get Ready!" text automatically.
