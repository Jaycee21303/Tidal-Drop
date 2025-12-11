// Surf Racer - endless surfing penguin style game
// Built to run as a static site (e.g. GitHub Pages)

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

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
  baseSpeed: 180, // pixels per second
  minSpeed: 140,
  maxSpeed: 520,
  accel: 40, // how much natural accel over time
};

const wave = {
  baseY: canvas.height * 0.72,
  amp: 55,
  freq: 0.012,
};

const surfer = {
  worldX: 0,
  screenX: canvas.width * 0.25,
  y: wave.baseY - 60,
  width: 52,
  height: 42,
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


// Wave math helpers
function getWaveY(worldX) {
  const n = worldX * wave.freq;
  return (
    wave.baseY +
    Math.sin(n) * wave.amp +
    Math.sin(n * 0.5 + 12.3) * wave.amp * 0.4
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
  const spacingMin = 420;
  const spacingMax = 880;
  const spacing = spacingMin + Math.random() * (spacingMax - spacingMin);

  const width = 40;
  const height = 64;

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

  // world speed tweaks
  world.speed += world.accel * dt;
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
    surfer.vy += physics.gravity * dt;
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
    const ow = o.width;
    const oh = o.height;
    const oy = getWaveY(o.worldX) - oh;

    const ox = screenX;

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
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, "#081e42");
  grad.addColorStop(0.5, "#04203a");
  grad.addColorStop(1, "#011019");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // distant horizon glow
  const horizonY = canvas.height * 0.55;
  const glowGrad = ctx.createLinearGradient(0, horizonY - 40, 0, horizonY + 80);
  glowGrad.addColorStop(0, "rgba(255,255,255,0.10)");
  glowGrad.addColorStop(0.5, "rgba(0,188,255,0.18)");
  glowGrad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, horizonY - 40, canvas.width, 120);
}

function drawWave() {
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
  waterGrad.addColorStop(0, "#0c67c6");
  waterGrad.addColorStop(0.5, "#04539d");
  waterGrad.addColorStop(1, "#012b57");
  ctx.fillStyle = waterGrad;
  ctx.fill();

  // foam
  ctx.save();
  ctx.clip();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(224, 244, 255, 0.8)";
  ctx.beginPath();
  for (let x = 0; x <= canvas.width; x += 4) {
    const worldX = cameraX + x;
    const y = getWaveY(worldX);
    const foamY = y - 4;
    if (x === 0) ctx.moveTo(x, foamY);
    else ctx.lineTo(x, foamY);
  }
  ctx.stroke();
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

    // buoy body
    ctx.fillStyle = "#ffb347";
    ctx.fillRect(-ow / 2 + 4, -oh / 2 + 6, ow - 8, oh - 12);

    // top cap
    ctx.fillStyle = "#ffe9c2";
    ctx.fillRect(-ow / 4, -oh / 2, ow / 2, 10);

    // stripe
    ctx.fillStyle = "#f04747";
    ctx.fillRect(-ow / 2 + 4, -4, ow - 8, 8);

    ctx.restore();
  }
}

function drawSurfer() {
  ctx.save();
  ctx.translate(surfer.screenX, surfer.y);

  const slope = getWaveSlope(surfer.worldX);
  ctx.rotate(slope * 0.7);

  const w = surfer.width;
  const h = surfer.height;

  // board
  ctx.fillStyle = "#f6f1d1";
  ctx.beginPath();
  ctx.moveTo(-w * 0.7, h * 0.3);
  ctx.quadraticCurveTo(0, h * 0.8, w * 0.7, h * 0.3);
  ctx.quadraticCurveTo(0, h * 0.4, -w * 0.7, h * 0.3);
  ctx.closePath();
  ctx.fill();

  // board stripe
  ctx.strokeStyle = "rgba(255, 99, 71, 0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-w * 0.6, h * 0.35);
  ctx.lineTo(w * 0.6, h * 0.32);
  ctx.stroke();

  // surfer character
  const skin = "#f4c7a1";
  const shirt = "#0c6cff";
  const shorts = "#ff5f6d";

  // legs
  ctx.strokeStyle = skin;
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-w * 0.08, -h * 0.04);
  ctx.lineTo(-w * 0.2, h * 0.22);
  ctx.moveTo(w * 0.08, -h * 0.04);
  ctx.lineTo(w * 0.24, h * 0.25);
  ctx.stroke();

  // shorts
  ctx.fillStyle = shorts;
  ctx.beginPath();
  ctx.roundRect(-w * 0.26, -h * 0.2, w * 0.52, h * 0.24, 6);
  ctx.fill();

  // torso
  ctx.fillStyle = shirt;
  ctx.beginPath();
  ctx.roundRect(-w * 0.2, -h * 0.5, w * 0.4, h * 0.32, 10);
  ctx.fill();

  // neck
  ctx.fillStyle = skin;
  ctx.fillRect(-w * 0.04, -h * 0.6, w * 0.08, h * 0.08);

  // arms
  ctx.strokeStyle = skin;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-w * 0.16, -h * 0.38);
  ctx.lineTo(-w * 0.36, -h * 0.16);
  ctx.moveTo(w * 0.16, -h * 0.38);
  ctx.lineTo(w * 0.38, -h * 0.14);
  ctx.stroke();

  // head
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(0, -h * 0.68, h * 0.22, 0, Math.PI * 2);
  ctx.fill();

  // hair
  ctx.fillStyle = "#3c2f2f";
  ctx.beginPath();
  ctx.arc(0, -h * 0.72, h * 0.22, Math.PI * 0.9, Math.PI * 2.1);
  ctx.fill();

  // sunglasses
  ctx.fillStyle = "#0a1a32";
  ctx.fillRect(-w * 0.1, -h * 0.72, w * 0.08, h * 0.06);
  ctx.fillRect(w * 0.02, -h * 0.72, w * 0.08, h * 0.06);
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-w * 0.02, -h * 0.7);
  ctx.lineTo(w * 0.02, -h * 0.7);
  ctx.stroke();

  // nose shadow
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.69);
  ctx.lineTo(-w * 0.016, -h * 0.65);
  ctx.stroke();

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

  update(dt);
  draw();

  requestAnimationFrame(loop);
}

updateScoreUI();
requestAnimationFrame(loop);
