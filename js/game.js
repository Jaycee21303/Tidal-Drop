// Tidal Drop - Infinite Surf
// Static, GitHub Pages–friendly game (no backend, localStorage only).

(() => {
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");

  const scoreValueEl = document.getElementById("scoreValue");
  const bestValueEl = document.getElementById("bestValue");
  const overlayEl = document.getElementById("overlay");
  const startButton = document.getElementById("startButton");
  const overlayTitle = document.getElementById("overlayTitle");
  const overlaySubtitle = document.getElementById("overlaySubtitle");

  const gameOverPanel = document.getElementById("gameOverPanel");
  const finalScoreEl = document.getElementById("finalScore");
  const playerNameInput = document.getElementById("playerName");
  const saveScoreButton = document.getElementById("saveScoreButton");
  const skipSaveButton = document.getElementById("skipSaveButton");

  const leaderboardList = document.getElementById("leaderboardList");

  const LS_BEST_KEY = "tidalDropBestScore";
  const LS_SCORES_KEY = "tidalDropScores";

  let width = window.innerWidth;
  let height = window.innerHeight;

  canvas.width = width;
  canvas.height = height;

  function resizeCanvas() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
  }

  window.addEventListener("resize", resizeCanvas);

  // Game state
  let gameState = "menu"; // "menu" | "playing" | "gameover"

  let surfer = {
    x: width / 2,
    y: height * 0.2,
    radius: 18,
    vx: 0
  };

  const SURFER_SPEED = 320; // px / s

  let obstacles = [];
  let spawnTimer = 0;
  let spawnInterval = 0.85; // seconds
  let distance = 0;
  let bestScore = loadBestScore();
  let difficultyTimer = 0;

  let lastTimestamp = performance.now();

  let pointerDirection = 0; // -1 left, 1 right, 0 idle

  function resetGameValues() {
    surfer.x = width / 2;
    surfer.y = height * 0.2;
    surfer.vx = 0;
    obstacles = [];
    spawnTimer = 0;
    spawnInterval = 0.85;
    difficultyTimer = 0;
    distance = 0;
    pointerDirection = 0;
  }

  function loadBestScore() {
    const raw = localStorage.getItem(LS_BEST_KEY);
    const val = raw ? parseInt(raw, 10) : 0;
    bestValueEl.textContent = isNaN(val) ? "0" : String(val);
    return isNaN(val) ? 0 : val;
  }

  function saveBestScore(score) {
    if (score > bestScore) {
      bestScore = score;
      localStorage.setItem(LS_BEST_KEY, String(score));
      bestValueEl.textContent = String(score);
    }
  }

  function loadScores() {
    try {
      const raw = localStorage.getItem(LS_SCORES_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveScores(scores) {
    localStorage.setItem(LS_SCORES_KEY, JSON.stringify(scores));
  }

  function addScore(name, score) {
    const scores = loadScores();
    scores.push({
      name: name || "Surfer",
      score,
      ts: Date.now()
    });
    scores.sort((a, b) => b.score - a.score);
    const trimmed = scores.slice(0, 10);
    saveScores(trimmed);
    renderLeaderboard(trimmed);
  }

  function renderLeaderboard(scores = loadScores()) {
    leaderboardList.innerHTML = "";
    scores.forEach((entry) => {
      const li = document.createElement("li");
      li.textContent = `${entry.name}: ${entry.score}`;
      leaderboardList.appendChild(li);
    });
  }

  renderLeaderboard();

  function startGame() {
    resetGameValues();
    gameState = "playing";
    overlayEl.classList.add("hidden");
    gameOverPanel.classList.add("hidden");
  }

  function gameOver() {
    gameState = "gameover";
    const finalScore = Math.floor(distance);
    finalScoreEl.textContent = String(finalScore);
    saveBestScore(finalScore);
    gameOverPanel.classList.remove("hidden");
    playerNameInput.value = "";
    playerNameInput.focus();
  }

  function update(dt) {
    if (gameState !== "playing") {
      return;
    }

    // Difficulty scaling
    difficultyTimer += dt;
    const difficultyFactor = 1 + difficultyTimer * 0.08; // ramps up gradually

    const scrollSpeed = 170 * difficultyFactor; // world moves up

    // Update distance (score)
    distance += scrollSpeed * dt * 0.1;
    const scoreInt = Math.floor(distance);
    scoreValueEl.textContent = String(scoreInt);

    // Surfer movement (keyboard + pointer)
    let intendedDirection = 0;

    if (keys.left) intendedDirection -= 1;
    if (keys.right) intendedDirection += 1;
    if (!keys.left && !keys.right) {
      intendedDirection = pointerDirection;
    }

    surfer.vx = intendedDirection * SURFER_SPEED;
    surfer.x += surfer.vx * dt;

    // Constrain surfer horizontally
    const margin = 30;
    if (surfer.x < margin) surfer.x = margin;
    if (surfer.x > width - margin) surfer.x = width - margin;

    // Obstacle spawning
    spawnTimer += dt;
    const minInterval = 0.35;
    const effectiveInterval = Math.max(minInterval, spawnInterval / difficultyFactor);

    if (spawnTimer >= effectiveInterval) {
      spawnTimer = 0;
      spawnObstacle();
    }

    // Move obstacles & check collision
    const toRemove = [];
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      o.y -= scrollSpeed * dt;

      // Collision check (circle-circle)
      const dx = o.x - surfer.x;
      const dy = o.y - surfer.y;
      const rSum = o.radius + surfer.radius;
      if (dx * dx + dy * dy < rSum * rSum) {
        gameOver();
        break;
      }

      if (o.y + o.radius < -40) {
        toRemove.push(i);
      }
    }

    for (let i = toRemove.length - 1; i >= 0; i--) {
      obstacles.splice(toRemove[i], 1);
    }
  }

  function spawnObstacle() {
    const laneMargin = 40;
    const x = laneMargin + Math.random() * (width - laneMargin * 2);
    const y = height + 40;

    const types = ["rock", "buoy", "mine"];
    const type = types[Math.floor(Math.random() * types.length)];

    let radius;
    switch (type) {
      case "rock":
        radius = 24 + Math.random() * 10;
        break;
      case "buoy":
        radius = 16 + Math.random() * 6;
        break;
      case "mine":
        radius = 20 + Math.random() * 4;
        break;
      default:
        radius = 20;
    }

    obstacles.push({
      x,
      y,
      radius,
      type
    });
  }

  function drawBackground(time) {
    // Deep ocean gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#001935");
    gradient.addColorStop(0.5, "#003f7d");
    gradient.addColorStop(1, "#001427");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Vertical glowing "blue wave" column
    const centerX = width * 0.5;
    const waveWidth = Math.max(width * 0.35, 240);
    const half = waveWidth / 2;

    const waveGradient = ctx.createLinearGradient(centerX - half, 0, centerX + half, 0);
    waveGradient.addColorStop(0, "rgba(0, 120, 255, 0.1)");
    waveGradient.addColorStop(0.5, "rgba(0, 190, 255, 0.5)");
    waveGradient.addColorStop(1, "rgba(0, 120, 255, 0.1)");

    ctx.fillStyle = waveGradient;
    ctx.beginPath();

    // Slight horizontal wobble to feel alive
    const wobble = Math.sin(time * 0.0006) * (width * 0.03);

    ctx.moveTo(centerX - half + wobble, 0);
    ctx.lineTo(centerX + half + wobble, 0);
    ctx.lineTo(centerX + half - wobble, height);
    ctx.lineTo(centerX - half - wobble, height);
    ctx.closePath();
    ctx.fill();

    // Foam lines
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 3;

    const foamCount = 6;
    for (let i = 0; i < foamCount; i++) {
      const offset = (i / foamCount) * height;
      ctx.beginPath();
      for (let y = 0; y <= height; y += 26) {
        const t = (y + offset + time * 0.08) * 0.02 + i;
        const amp = waveWidth * 0.18;
        const x = centerX + Math.sin(t) * amp * 0.5;
        if (y === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "rgba(239, 255, 255, 0.7)";
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSurfer() {
    const { x, y, radius } = surfer;

    // Board
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.15); // small tilt
    ctx.beginPath();
    const boardLen = radius * 2.1;
    const boardWidth = radius * 0.9;
    ctx.moveTo(-boardLen / 2, 0);
    ctx.quadraticCurveTo(-boardLen / 4, -boardWidth, 0, -boardWidth);
    ctx.quadraticCurveTo(boardLen / 4, -boardWidth, boardLen / 2, 0);
    ctx.quadraticCurveTo(boardLen / 4, boardWidth, 0, boardWidth);
    ctx.quadraticCurveTo(-boardLen / 4, boardWidth, -boardLen / 2, 0);
    ctx.closePath();
    const boardGradient = ctx.createLinearGradient(-boardLen / 2, 0, boardLen / 2, 0);
    boardGradient.addColorStop(0, "#00f2ff");
    boardGradient.addColorStop(1, "#0076ff");
    ctx.fillStyle = boardGradient;
    ctx.fill();

    // Rider
    ctx.beginPath();
    ctx.arc(0, -radius * 0.9, radius * 0.6, 0, Math.PI * 2);
    ctx.fillStyle = "#ffe6c7";
    ctx.fill();

    ctx.restore();

    // Little wake trail
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(x - radius * 0.8, y + radius * 0.2);
    ctx.quadraticCurveTo(
      x - radius * 1.8,
      y + radius * 1.4,
      x - radius * 0.2,
      y + radius * 2.2
    );
    ctx.strokeStyle = "rgba(230, 250, 255, 0.9)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  function drawObstacles() {
    obstacles.forEach((o) => {
      ctx.save();
      ctx.translate(o.x, o.y);

      switch (o.type) {
        case "rock":
          drawRock(o.radius);
          break;
        case "buoy":
          drawBuoy(o.radius);
          break;
        case "mine":
          drawMine(o.radius);
          break;
        default:
          drawRock(o.radius);
      }

      ctx.restore();
    });
  }

  function drawRock(r) {
    ctx.beginPath();
    ctx.moveTo(-r * 0.9, r * 0.2);
    ctx.lineTo(-r * 0.6, -r * 0.5);
    ctx.lineTo(0, -r * 0.9);
    ctx.lineTo(r * 0.6, -r * 0.4);
    ctx.lineTo(r * 0.9, r * 0.2);
    ctx.quadraticCurveTo(0, r * 0.6, -r * 0.9, r * 0.2);
    ctx.closePath();
    const g = ctx.createLinearGradient(-r, -r, r, r);
    g.addColorStop(0, "#173042");
    g.addColorStop(1, "#0b1722");
    ctx.fillStyle = g;
    ctx.fill();
  }

  function drawBuoy(r) {
    // Base float
    ctx.beginPath();
    ctx.arc(0, 0, r, Math.PI * 0.1, Math.PI * 0.9);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    ctx.fillStyle = "rgba(220, 240, 255, 0.7)";
    ctx.fill();

    // Mast
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.1);
    ctx.lineTo(0, -r * 1.5);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Top light
    ctx.beginPath();
    ctx.arc(0, -r * 1.7, r * 0.25, 0, Math.PI * 2);
    ctx.fillStyle = "#ffd74d";
    ctx.fill();
  }

  function drawMine(r) {
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
    ctx.fillStyle = "#162034";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#5472b8";
    ctx.stroke();

    // Spikes
    const spikes = 7;
    for (let i = 0; i < spikes; i++) {
      const angle = (i / spikes) * Math.PI * 2;
      const inner = r * 0.7;
      const outer = r * 1.0;
      const x1 = Math.cos(angle) * inner;
      const y1 = Math.sin(angle) * inner;
      const x2 = Math.cos(angle) * outer;
      const y2 = Math.sin(angle) * outer;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }

  function draw(time) {
    drawBackground(time);
    drawObstacles();
    drawSurfer();
  }

  function loop(timestamp) {
    const dt = Math.min((timestamp - lastTimestamp) / 1000, 0.03);
    lastTimestamp = timestamp;

    update(dt);
    draw(timestamp);

    requestAnimationFrame(loop);
  }

  // Input handling

  const keys = {
    left: false,
    right: false
  };

  function handleKeyDown(e) {
    if (e.code === "ArrowLeft" || e.code === "KeyA") {
      keys.left = true;
      e.preventDefault();
    } else if (e.code === "ArrowRight" || e.code === "KeyD") {
      keys.right = true;
      e.preventDefault();
    } else if (e.code === "Space") {
      // Space to start or restart
      if (gameState !== "playing") {
        startGame();
        e.preventDefault();
      }
    }
  }

  function handleKeyUp(e) {
    if (e.code === "ArrowLeft" || e.code === "KeyA") {
      keys.left = false;
      e.preventDefault();
    } else if (e.code === "ArrowRight" || e.code === "KeyD") {
      keys.right = false;
      e.preventDefault();
    }
  }

  document.addEventListener("keydown", handleKeyDown);
  document.addEventListener("keyup", handleKeyUp);

  // Pointer / touch for mobile

  function pointerDown(ev) {
    if (gameState !== "playing") {
      startGame();
    }
    const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
    pointerDirection = clientX < width / 2 ? -1 : 1;
  }

  function pointerUp() {
    pointerDirection = 0;
  }

  canvas.addEventListener("mousedown", pointerDown);
  canvas.addEventListener("mouseup", pointerUp);
  canvas.addEventListener("mouseleave", pointerUp);

  canvas.addEventListener("touchstart", pointerDown, { passive: true });
  canvas.addEventListener("touchend", pointerUp, { passive: true });
  canvas.addEventListener("touchcancel", pointerUp, { passive: true });

  // UI buttons

  startButton.addEventListener("click", () => {
    if (gameState !== "playing") {
      startGame();
    }
  });

  saveScoreButton.addEventListener("click", () => {
    if (gameState !== "gameover") return;
    const name = playerNameInput.value.trim() || "Surfer";
    const finalScore = Math.floor(distance);
    addScore(name, finalScore);
    gameOverPanel.classList.add("hidden");
  });

  skipSaveButton.addEventListener("click", () => {
    if (gameState !== "gameover") return;
    gameOverPanel.classList.add("hidden");
  });

  // Initial menu text tweaks (optional flavor)
  overlayTitle.textContent = "Tidal Drop";
  overlaySubtitle.innerHTML =
    'Ride a vertical blue wave through floating hazards.<br />' +
    'Use <strong>← →</strong> or <strong>A / D</strong> to steer. ' +
    'Tap left / right on mobile.';

  // Kick off loop
  requestAnimationFrame(loop);
})();