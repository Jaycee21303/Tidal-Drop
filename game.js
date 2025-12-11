// Surf Racer - endless surfing penguin style game
// Built to run as a static site (e.g. GitHub Pages)

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// Canvas helpers -----------------------------------------------------------
// Some browsers (or older Chromium versions used by certain hosting setups)
// don't ship `roundRect` on the 2D context. When that happens the draw calls
// would throw and halt the game loop before anything is rendered. Provide a
// tiny polyfill so rendering always succeeds.
if (ctx && typeof ctx.roundRect !== "function") {
  ctx.roundRect = function roundRect(x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r || 0, Math.min(Math.abs(w), Math.abs(h)) / 2));
    this.beginPath();
    this.moveTo(x + radius, y);
    this.lineTo(x + w - radius, y);
    this.quadraticCurveTo(x + w, y, x + w, y + radius);
    this.lineTo(x + w, y + h - radius);
    this.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    this.lineTo(x + radius, y + h);
    this.quadraticCurveTo(x, y + h, x, y + h - radius);
    this.lineTo(x, y + radius);
    this.quadraticCurveTo(x, y, x + radius, y);
    this.closePath();
  };
}

const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("highScore");
const mobileHintEl = document.getElementById("mobileHint");

const GAME_STATE = {
  MENU: "menu",
  PLAYING: "playing",
  GAME_OVER: "game_over",
};

let state = GAME_STATE.MENU;

const world = {
  speed: 0,
  baseSpeed: 170, // pixels per second
  minSpeed: 130,
  maxSpeed: 520,
  accel: 40, // how much natural accel over time
};

const wave = {
  baseY: canvas.height * 0.72,
  amp: 68,
  freq: 0.011,
  swellAmp: 18,
  swellFreq: 0.18,
};

const detailLUT =
  typeof oceanDetailLUT !== "undefined"
    ? oceanDetailLUT
    : [
        { idx: 0, ripple: 0, foam: 0.4, sparkle: 0.2, crest: 0.7, hue: 200, sat: 60, light: 55 },
      ];
const driftLUT =
  typeof engineDriftLUT !== "undefined"
    ? engineDriftLUT
    : [
        { idx: 0, drag: 0, lift: 0, glide: 1, smooth: 0.62 },
        { idx: 1, drag: 0.2, lift: -0.1, glide: 1.08, smooth: 0.7 },
      ];

const surfer = {
  worldX: 0,
  screenX: canvas.width * 0.25,
  y: wave.baseY - 60,
  width: 58,
  height: 54,
  vy: 0,
  grounded: true,
};

const physics = {
  gravity: 900,
  jumpVelocity: -520,
  slopeBoost: 60,
};

let obstacles = [];
let nextObstacleWorldX = 800;

let cameraX = 0;
let distance = 0;
let score = 0;
let bestScore = parseInt(localStorage.getItem("surfRacerBestScore") || "0", 10) || 0;

let lastTime = 0;
let elapsedTime = 0;
let frameCount = 0;

const engineFilter = {
  buffer: new Float32Array(120),
  index: 0,
  sum: 0,
  ready: false,
  smooth(dt) {
    // remove spikes by sliding-average filtering the delta time
    this.sum -= this.buffer[this.index];
    this.buffer[this.index] = dt;
    this.sum += dt;
    this.index = (this.index + 1) % this.buffer.length;
    if (!this.ready && this.index === 0) this.ready = true;
    const denom = this.ready ? this.buffer.length : this.index || 1;
    return this.sum / denom;
  },
};

const motionTrail = {
  points: Array.from({ length: 14 }, () => ({ x: 0, y: 0 })),
  index: 0,
  push(x, y) {
    this.points[this.index] = { x, y };
    this.index = (this.index + 1) % this.points.length;
  },
  forEach(callback) {
    for (let i = 0; i < this.points.length; i++) {
      const idx = (this.index + i) % this.points.length;
      callback(this.points[idx], i / (this.points.length - 1));
    }
  },
};

const surferImg = new Image();
let surferImgReady = false;

// Embedded surfer sprite so the game stays playable without binary assets.
const embeddedSurferDataUri =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAABQElEQVR42u3XuxHCMBBFUcqhCAJKoQwXQRHExMTEVEA7C86Exuj/sbT" +
  "3zWyEx/AOGls6HAghhJBuOZ4WsUd1eTUIrvIqEAAAAADdAPK+O8uvn08P4BsAZo/q8gD8geB0pPFf5y0AAAAAADALQEixkgMAAADwEARgSIDzRXwDAAAANMoit9YTBND" +
  "it/TC2C9AI4wxACpijAdQGGNsgAIYwwOIyDNrAgCi73n9/ixj5gSwSv6Mdd34AL6SntWwX4C1iHny2yponw4TvqMvQOhSNcu67heLUB3AVTBmqdaabICHvHzTvWQ1gID" +
  "yu0dQC1BkHxABUOy1mLnpiSrtBIgpbyC0LmpfV3Yr3GMFZL5Nks8m2c+AddnFAFR6bSYf1EqsgM0CjfcHyafWnH2Ac2PU+KGYfIR3JrC8jqgsTQghk+cDxYd49AvXy3E" +
  "AAAAASUVORK5CYII=";

surferImg.onload = () => {
  surferImgReady = true;
};
surferImg.onerror = () => {
  // If a custom sprite fails to load, stick with the embedded default.
  surferImgReady = false;
  surferImg.src = embeddedSurferDataUri;
};

// Start with the built-in sprite so the character always renders.
surferImg.src = embeddedSurferDataUri;

// If a custom sprite exists at assets/surfer.png, swap it in without breaking the
// game when the file is missing (e.g., in environments that disallow binaries).
fetch("assets/surfer.png")
  .then((res) => {
    if (!res.ok) return;
    surferImgReady = false;
    surferImg.src = "assets/surfer.png";
  })
  .catch(() => {
    // Ignore missing or blocked assets; the embedded sprite keeps the game playable.
  });

// Wave math helpers
function getWaveY(worldX) {
  const detail = detailLUT[(frameCount + Math.floor(worldX)) % detailLUT.length];
  const swell = Math.sin(elapsedTime * wave.swellFreq) * (wave.swellAmp + detail.crest * 4);
  const amplitude = wave.amp + swell + detail.ripple * 6;
  const n = worldX * wave.freq;
  return (
    wave.baseY +
    Math.sin(n) * amplitude +
    Math.sin(n * 0.5 + 12.3) * amplitude * 0.42 +
    Math.sin(n * 1.6 + 4.2) * detail.crest * 3.2
  );
}

function getWaveSlope(worldX) {
  const delta = 2;
  const y1 = getWaveY(worldX - delta);
  const y2 = getWaveY(worldX + delta);
  return (y2 - y1) / (2 * delta || 1);
}

// Game state management
function resetGame() {
  world.speed = world.baseSpeed;
  surfer.worldX = 0;
  surfer.y = getWaveY(0) - surfer.height * 0.5 - 8;
  surfer.vy = 0;
  surfer.grounded = true;

  distance = 0;
  score = 0;
  obstacles = [];
  nextObstacleWorldX = surfer.worldX + 700;

  // spawn a few starter obstacles
  for (let i = 0; i < 4; i++) {
    spawnObstacle();
  }

  cameraX = surfer.worldX - surfer.screenX;
  updateScoreUI();
}

function startGame() {
  resetGame();
  state = GAME_STATE.PLAYING;
  if (mobileHintEl) mobileHintEl.style.opacity = "0";
}

function gameOver() {
  state = GAME_STATE.GAME_OVER;
  if (score > bestScore) {
    bestScore = score;
    localStorage.setItem("surfRacerBestScore", String(bestScore));
  }
}

// Obstacles
function spawnObstacle() {
  const spacingMin = 620;
  const spacingMax = 1180;
  const spacing = spacingMin + Math.random() * (spacingMax - spacingMin);

  const width = 44;
  const height = 56;

  const worldX = nextObstacleWorldX;
  nextObstacleWorldX += spacing;

  obstacles.push({
    worldX,
    width,
    height,
  });
}

function updateObstacles(dt) {
  // spawn ahead of player
  while (nextObstacleWorldX < surfer.worldX + 1600) {
    spawnObstacle();
  }

  // recycle old obstacles
  const minWorldX = cameraX - 200;
  obstacles = obstacles.filter((o) => o.worldX + o.width > minWorldX);
}

// UI
function updateScoreUI() {
  if (scoreEl) {
    scoreEl.textContent = "Score: " + score;
  }
  if (bestEl) {
    bestEl.textContent = "Best: " + bestScore;
  }
}

// Input
function primaryAction() {
  if (state === GAME_STATE.MENU) {
    startGame();
    return;
  }
  if (state === GAME_STATE.GAME_OVER) {
    startGame();
    return;
  }
  if (state === GAME_STATE.PLAYING) {
    if (surfer.grounded) {
      surfer.grounded = false;
      surfer.vy = physics.jumpVelocity;
    }
  }
}

window.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code === "ArrowUp") {
    e.preventDefault();
    primaryAction();
  }
});

canvas.addEventListener("mousedown", (e) => {
  e.preventDefault();
  primaryAction();
});

canvas.addEventListener(
  "touchstart",
  (e) => {
    e.preventDefault();
    primaryAction();
  },
  { passive: false }
);

// Main update
function update(dt) {
  if (state !== GAME_STATE.PLAYING) return;

  const drift = driftLUT[frameCount % driftLUT.length];
  const smoothingBoost = 1 - drift.smooth * 0.12;

  // world speed tweaks
  world.speed += world.accel * dt * drift.glide * smoothingBoost;
  world.speed += drift.drag * 0.25 * dt;
  if (world.speed < world.minSpeed) world.speed = world.minSpeed;
  if (world.speed > world.maxSpeed) world.speed = world.maxSpeed;

  // move surfer forward in world space
  surfer.worldX += world.speed * dt;

  // ground vs air physics
  if (surfer.grounded) {
    const targetY = getWaveY(surfer.worldX) - surfer.height * 0.5 - 8;
    surfer.y = targetY;

    const slope = getWaveSlope(surfer.worldX);
    world.speed += -slope * physics.slopeBoost * dt;
    if (world.speed < world.minSpeed) world.speed = world.minSpeed;
    if (world.speed > world.maxSpeed) world.speed = world.maxSpeed;

    surfer.vy = 0;
  } else {
    surfer.vy += (physics.gravity + drift.lift * 6) * dt;
    surfer.y += surfer.vy * dt;

    // landing
    const groundY = getWaveY(surfer.worldX) - surfer.height * 0.5 - 8;
    if (surfer.y >= groundY && surfer.vy > 0) {
      surfer.y = groundY;
      surfer.grounded = true;
      const slope = getWaveSlope(surfer.worldX);
      world.speed += -slope * physics.slopeBoost * 1.5 * dt;
      if (world.speed < world.minSpeed) world.speed = world.minSpeed;
      if (world.speed > world.maxSpeed) world.speed = world.maxSpeed;
      surfer.vy = 0;
    }
  }

  // update camera
  cameraX = surfer.worldX - surfer.screenX;

  // distance & score
  distance += world.speed * dt;
  score = Math.floor(distance / 10);
  updateScoreUI();

  // obstacles
  updateObstacles(dt);

  motionTrail.push(surfer.screenX, surfer.y);

  // collisions
  checkCollisions();
}

function checkCollisions() {
  const sx = surfer.screenX - surfer.width / 2;
  const sy = surfer.y - surfer.height / 2;
  const sw = surfer.width;
  const sh = surfer.height;

  for (const o of obstacles) {
    const screenX = o.worldX - cameraX;
    const ow = o.width * 0.9;
    const oh = o.height * 0.9;
    const oy = getWaveY(o.worldX) - oh;

    const ox = screenX + (o.width - ow) / 2;

    const collision =
      sx < ox + ow &&
      sx + sw > ox &&
      sy < oy + oh &&
      sy + sh > oy;

    if (collision) {
      gameOver();
      break;
    }
  }
}

// Draw helpers
function drawBackground() {
  const detail = detailLUT[frameCount % detailLUT.length];
  const topHue = detail.hue + 8;
  const bottomHue = detail.hue - 12;
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, `hsl(${topHue}, ${detail.sat + 10}%, 95%)`);
  grad.addColorStop(0.5, `hsl(${detail.hue}, ${detail.sat}%, ${detail.light + 20}%)`);
  grad.addColorStop(1, `hsl(${bottomHue}, ${detail.sat + 4}%, ${detail.light + 6}%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // sun glow
  const sunX = canvas.width * 0.18;
  const sunY = canvas.height * 0.22;
  const sunRadius = 80;
  const sunGrad = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, sunRadius);
  sunGrad.addColorStop(0, "rgba(255, 247, 214, 0.95)");
  sunGrad.addColorStop(1, "rgba(255, 247, 214, 0)");
  ctx.fillStyle = sunGrad;
  ctx.beginPath();
  ctx.arc(sunX, sunY, sunRadius, 0, Math.PI * 2);
  ctx.fill();

  // clouds
  const cloudRows = [
    { y: canvas.height * 0.18, speed: 0.7, alpha: 0.35 },
    { y: canvas.height * 0.26, speed: 0.9, alpha: 0.45 },
  ];
  cloudRows.forEach((row, idx) => {
    const drift = (elapsedTime * 20 * row.speed) % (canvas.width + 260);
    for (let i = -1; i < 5; i++) {
      const cx = (i * 260 - drift + canvas.width + 260) % (canvas.width + 260) - 130;
      drawCloud(cx + (idx % 2 === 0 ? 40 : 0), row.y, 120, row.alpha);
    }
  });

  // distant water horizon glow
  const horizonY = canvas.height * 0.55;
  const glowGrad = ctx.createLinearGradient(0, horizonY - 40, 0, horizonY + 120);
  glowGrad.addColorStop(0, "rgba(255,255,255,0.18)");
  glowGrad.addColorStop(0.5, "rgba(130,195,255,0.32)");
  glowGrad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, horizonY - 40, canvas.width, 160);
}

function drawCloud(x, y, size, alpha = 0.5) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  ctx.beginPath();
  ctx.arc(-size * 0.35, 0, size * 0.24, 0, Math.PI * 2);
  ctx.arc(-size * 0.05, -size * 0.08, size * 0.3, 0, Math.PI * 2);
  ctx.arc(size * 0.25, 0, size * 0.26, 0, Math.PI * 2);
  ctx.arc(size * 0.0, size * 0.1, size * 0.2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawWave() {
  const detail = detailLUT[(frameCount * 2) % detailLUT.length];
  ctx.beginPath();
  for (let x = 0; x <= canvas.width; x += 4) {
    const worldX = cameraX + x;
    const y = getWaveY(worldX);
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.lineTo(canvas.width, canvas.height);
  ctx.lineTo(0, canvas.height);
  ctx.closePath();

  const waterGrad = ctx.createLinearGradient(0, canvas.height * 0.4, 0, canvas.height);
  waterGrad.addColorStop(0, `hsl(${detail.hue + 6}, ${detail.sat + 12}%, ${48 + detail.ripple * 3}%)`);
  waterGrad.addColorStop(0.45, `hsl(${detail.hue}, ${detail.sat + 6}%, ${38 + detail.foam * 6}%)`);
  waterGrad.addColorStop(1, `hsl(${detail.hue - 10}, ${detail.sat + 6}%, ${28 + detail.sparkle * 8}%)`);
  ctx.fillStyle = waterGrad;
  ctx.fill();

  // foam
  ctx.save();
  ctx.clip();
  ctx.lineWidth = 3;
  ctx.strokeStyle = `rgba(224, 244, 255, ${0.65 + detail.foam * 0.2})`;
  ctx.beginPath();
  for (let x = 0; x <= canvas.width; x += 4) {
    const worldX = cameraX + x;
    const y = getWaveY(worldX);
    const foamY = y - 4 - detail.ripple * 3;
    if (x === 0) ctx.moveTo(x, foamY);
    else ctx.lineTo(x, foamY);
  }
  ctx.stroke();
  ctx.restore();

  // glints
  ctx.save();
  ctx.globalAlpha = 0.14 + detail.sparkle * 0.3;
  ctx.fillStyle = "#d4f1ff";
  for (let i = 0; i < canvas.width; i += 120) {
    const shimmerDetail = detailLUT[(frameCount + i) % detailLUT.length];
    const width = 36 + shimmerDetail.foam * 16;
    const height = 5 + shimmerDetail.sparkle * 10;
    const y = getWaveY(cameraX + i + elapsedTime * 30 + shimmerDetail.ripple * 40) +
      10 - shimmerDetail.crest * 2;
    ctx.beginPath();
    ctx.ellipse(i + 40 + shimmerDetail.ripple * 12, y, width, height, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawObstacles() {
  for (const o of obstacles) {
    const screenX = o.worldX - cameraX;
    const ow = o.width;
    const oh = o.height;
    const oy = getWaveY(o.worldX) - oh;

    if (screenX + ow < 0 || screenX > canvas.width + 50) continue;

    ctx.save();
    ctx.translate(screenX + ow / 2, oy + oh / 2);
    const barrelWidth = ow - 6;
    const barrelHeight = oh - 6;

    // barrel base
    const grad = ctx.createLinearGradient(-barrelWidth / 2, 0, barrelWidth / 2, 0);
    grad.addColorStop(0, "#7b4319");
    grad.addColorStop(0.5, "#a76a32");
    grad.addColorStop(1, "#7b4319");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(-barrelWidth / 2, -barrelHeight / 2 + 4, barrelWidth, barrelHeight, 8);
    ctx.fill();

    // metal bands
    ctx.fillStyle = "#d6c29a";
    ctx.fillRect(-barrelWidth / 2, -barrelHeight / 4, barrelWidth, 6);
    ctx.fillRect(-barrelWidth / 2, barrelHeight / 8, barrelWidth, 6);

    // highlights
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-barrelWidth / 2 + 4, -barrelHeight / 2 + 10);
    ctx.lineTo(-barrelWidth / 2 + 4, barrelHeight / 2 - 10);
    ctx.stroke();

    // bobbing rope ring
    ctx.strokeStyle = "#f7e6c4";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, -barrelHeight / 2 + 2, barrelWidth * 0.3, 6, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }
}

function drawSurfer() {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  motionTrail.forEach((p, t) => {
    const alpha = Math.max(0, 0.4 - t * 0.35);
    if (alpha <= 0.02) return;
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.5})`;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + Math.sin(t * Math.PI) * 6, 26 * (1 - t * 0.7), 10 * (1 - t * 0.5), 0, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();

  ctx.save();
  ctx.translate(surfer.screenX, surfer.y);

  const slope = getWaveSlope(surfer.worldX);
  ctx.rotate(slope * 0.7);

  const w = surfer.width;
  const h = surfer.height;

  // board
  const boardGrad = ctx.createLinearGradient(-w * 0.7, 0, w * 0.7, 0);
  boardGrad.addColorStop(0, "#ffe6a7");
  boardGrad.addColorStop(0.5, "#ffd16a");
  boardGrad.addColorStop(1, "#ff9f43");
  ctx.fillStyle = boardGrad;
  ctx.beginPath();
  ctx.moveTo(-w * 0.78, h * 0.32);
  ctx.quadraticCurveTo(0, h * 0.92, w * 0.78, h * 0.32);
  ctx.quadraticCurveTo(0, h * 0.36, -w * 0.78, h * 0.32);
  ctx.closePath();
  ctx.fill();

  // board stripes
  ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-w * 0.55, h * 0.4);
  ctx.lineTo(w * 0.55, h * 0.34);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-w * 0.5, h * 0.46);
  ctx.lineTo(w * 0.5, h * 0.42);
  ctx.stroke();

  // surfer character
  if (surferImgReady) {
    const imgW = w * 1.2;
    const imgH = h * 1.6;
    ctx.drawImage(surferImg, -imgW / 2, -imgH + 4, imgW, imgH);
  } else {
    const skin = "#f4c7a1";
    const shirt = "#0c6cff";
    const shorts = "#ff5f6d";

    // legs
    ctx.strokeStyle = skin;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-w * 0.08, -h * 0.04);
    ctx.lineTo(-w * 0.2, h * 0.24);
    ctx.moveTo(w * 0.08, -h * 0.04);
    ctx.lineTo(w * 0.24, h * 0.28);
    ctx.stroke();

    // shorts
    ctx.fillStyle = shorts;
    ctx.beginPath();
    ctx.roundRect(-w * 0.26, -h * 0.22, w * 0.52, h * 0.26, 6);
    ctx.fill();

    // torso
    ctx.fillStyle = shirt;
    ctx.beginPath();
    ctx.roundRect(-w * 0.22, -h * 0.56, w * 0.44, h * 0.36, 10);
    ctx.fill();

    // neck
    ctx.fillStyle = skin;
    ctx.fillRect(-w * 0.04, -h * 0.64, w * 0.08, h * 0.08);

    // arms
    ctx.strokeStyle = skin;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-w * 0.18, -h * 0.42);
    ctx.lineTo(-w * 0.4, -h * 0.18);
    ctx.moveTo(w * 0.18, -h * 0.42);
    ctx.lineTo(w * 0.42, -h * 0.12);
    ctx.stroke();

    // head
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(0, -h * 0.75, h * 0.24, 0, Math.PI * 2);
    ctx.fill();

    // hair
    ctx.fillStyle = "#3c2f2f";
    ctx.beginPath();
    ctx.arc(0, -h * 0.8, h * 0.24, Math.PI * 0.9, Math.PI * 2.1);
    ctx.fill();

    // sunglasses
    ctx.fillStyle = "#0a1a32";
    ctx.fillRect(-w * 0.12, -h * 0.78, w * 0.09, h * 0.06);
    ctx.fillRect(w * 0.02, -h * 0.78, w * 0.09, h * 0.06);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-w * 0.03, -h * 0.75);
    ctx.lineTo(w * 0.03, -h * 0.75);
    ctx.stroke();

    // nose shadow
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, -h * 0.74);
    ctx.lineTo(-w * 0.02, -h * 0.69);
    ctx.stroke();
  }

  ctx.restore();
}

function drawHUD() {
  ctx.save();
  ctx.textAlign = "center";

  if (state === GAME_STATE.MENU) {
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(canvas.width / 2 - 200, canvas.height / 2 - 110, 400, 220);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 40px system-ui, sans-serif";
    ctx.fillText("SURF RACER", canvas.width / 2, canvas.height / 2 - 50);

    ctx.font = "18px system-ui, sans-serif";
    ctx.fillText("Ride the blue waves • Time your jumps", canvas.width / 2, canvas.height / 2 - 15);

    ctx.font = "16px system-ui, sans-serif";
    ctx.fillText("Tap / click / Space to start", canvas.width / 2, canvas.height / 2 + 20);
    ctx.fillText("Dodge buoys • Land on downslopes for speed", canvas.width / 2, canvas.height / 2 + 50);
  }

  if (state === GAME_STATE.GAME_OVER) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(canvas.width / 2 - 220, canvas.height / 2 - 120, 440, 240);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 38px system-ui, sans-serif";
    ctx.fillText("WIPEOUT!", canvas.width / 2, canvas.height / 2 - 55);

    ctx.font = "20px system-ui, sans-serif";
    ctx.fillText("Score: " + score + "   •   Best: " + bestScore, canvas.width / 2, canvas.height / 2 - 15);

    ctx.font = "16px system-ui, sans-serif";
    ctx.fillText("Tap / click / Space to surf again", canvas.width / 2, canvas.height / 2 + 25);
  }

  ctx.restore();
}

function draw() {
  drawBackground();
  drawWave();
  drawObstacles();
  drawSurfer();
  drawHUD();
}

// Game loop
function loop(timestamp) {
  if (!lastTime) lastTime = timestamp;
  const dt = (timestamp - lastTime) / 1000;
  lastTime = timestamp;
  const smoothDt = engineFilter.smooth(dt);
  elapsedTime += smoothDt;
  frameCount++;

  update(smoothDt);
  draw();

  requestAnimationFrame(loop);
}

updateScoreUI();
requestAnimationFrame(loop);
