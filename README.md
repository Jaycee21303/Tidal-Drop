# Surf Racer

A tiny endless surfer game built for the browser (GitHub Pages friendly).  
Think *penguin sliding / Tiny Wings–style* momentum, but you're a surfer riding an endless blue wave and dodging buoys.

## How to play

- Tap / click / press **Space** (or **Arrow Up**) to jump.
- You normally stick to the wave.
- Land on **downhill** sections to gain speed and momentum.
- Dodge the orange buoys – hitting one is a wipeout.
- Your score is based on how far you surf.

The game stores your **best score** locally in `localStorage`.

## Repo structure

```text
.
├─ index.html     # main page
├─ style.css      # layout + styling
├─ game.js        # all game logic & rendering
└─ assets/
   └─ surfer.png  # (optional) drop your own surfer sprite here
```

If `assets/surfer.png` exists, the game will render that sprite on the board.  
If not, it'll use the built–in simple “stick surfer” character.

## Hosting on GitHub Pages

1. Create a new repo (for example: `surf-racer`).
2. Upload **all files from this folder** (`index.html`, `style.css`, `game.js`, `assets/`).
3. In GitHub:
   - Go to **Settings → Pages**.
   - Under “Source”, choose `Deploy from a branch`.
   - Select branch `main` (or `master`) and folder `/ (root)`.
   - Save.

GitHub will give you a URL like:

```text
https://YOUR-USERNAME.github.io/surf-racer/
```

Open that URL and the game should load immediately.

## Customizing

- Tweak physics & feel in `game.js`:
  - `world.baseSpeed`, `world.maxSpeed`
  - `physics.gravity`, `physics.jumpVelocity`
  - `physics.slopeBoost`
- Change colors in `drawBackground`, `drawWave`, and `drawObstacles`.
- Replace the surfer sprite:
  - Drop a PNG into `assets/surfer.png` (transparent background recommended).
  - Adjust `surfer.width` / `surfer.height` if needed.

Have fun surfing 🏄‍♂️
