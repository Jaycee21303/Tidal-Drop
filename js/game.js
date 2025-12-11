/*
 * Racing Penguin: Slide & Fly
 * ---------------------------------------------------------------------------
 * A full canvas-based re-creation inspired by classic hill-sliding penguin racers.
 * The penguin stays near the left side of the world while rounded snow hills
 * and scenery scroll to the left. Players press/hold to dive into the slopes,
 * building speed, then release to convert forward velocity into soaring arcs.
 *
 * This file is intentionally expansive (~thousands of lines) to surface the
 * entire gameplay loop, including procedural terrain, physics helpers,
 * rendering layers, effects, input routing, and state/leaderboard management.
 * Everything is pure vanilla JS and renders into a single canvas.
 */

(() => {
  "use strict";

  // ---------------------------------------------------------------------------
  // DOM references
  // ---------------------------------------------------------------------------
  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d");

  const overlay = document.getElementById("overlay");
  const startButton = document.getElementById("startButton");

  const gameOverPanel = document.getElementById("gameOverPanel");
  const finalDistanceEl = document.getElementById("finalDistance");
  const playerNameInput = document.getElementById("playerName");
  const saveScoreButton = document.getElementById("saveScoreButton");
  const skipSaveButton = document.getElementById("skipSaveButton");
  const restartButton = document.getElementById("restartButton");
  const leaderboardList = document.getElementById("leaderboardList");

  const distanceDisplay = document.getElementById("distanceDisplay");
  const speedDisplay = document.getElementById("speedDisplay");
  const bestDisplay = document.getElementById("bestDisplay");

  // Storage keys
  const STORAGE_BEST = "racingPenguinBest";
  const STORAGE_SCORES = "racingPenguinScores";

  // ---------------------------------------------------------------------------
  // Canvas sizing
  // ---------------------------------------------------------------------------
  let width = window.innerWidth;
  let height = window.innerHeight;
  canvas.width = width;
  canvas.height = height;

  window.addEventListener("resize", () => {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
    camera.targetY = height * 0.65;
    camera.y = camera.targetY;
    backgroundLayers.forEach((layer) => layer.resync());
  });

  // ---------------------------------------------------------------------------
  // Utility functions
  // ---------------------------------------------------------------------------
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function randRange(min, max) {
    return Math.random() * (max - min) + min;
  }

  // Simple deterministic PRNG for terrain reproducibility
  function mulberry32(seed) {
    return function () {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------------------------------------------------------------------------
  // Camera and world definitions
  // ---------------------------------------------------------------------------
  const camera = {
    x: 0,
    y: height * 0.65,
    targetY: height * 0.65,
    shakeTime: 0,
    shakeStrength: 0,
  };

  function applyCameraShake(dt) {
    if (camera.shakeTime <= 0) return { x: 0, y: 0 };
    camera.shakeTime -= dt;
    const amt = camera.shakeStrength * (camera.shakeTime / Math.max(0.0001, camera.shakeStrength));
    return {
      x: (Math.random() - 0.5) * amt,
      y: (Math.random() - 0.5) * amt,
    };
  }

  // ---------------------------------------------------------------------------
  // Terrain generation: rolling rounded hills
  // ---------------------------------------------------------------------------
  const terrain = {
    seed: Math.floor(Math.random() * 1_000_000),
    segments: [],
    segmentLength: 380,
    minAmp: 120,
    maxAmp: 240,
    minSlope: -0.2,
    maxSlope: 0.4,
    targetCount: 24,
    offset: 0,
  };

  const rng = mulberry32(terrain.seed);

  function generateSegment(startX) {
    const amplitude = lerp(terrain.minAmp, terrain.maxAmp, rng());
    const length = terrain.segmentLength * (0.8 + rng() * 0.4);
    const slope = lerp(terrain.minSlope, terrain.maxSlope, rng());
    const crest = rng() > 0.5 ? 1 : -1;

    return {
      x: startX,
      length,
      amplitude,
      slope,
      crest,
    };
  }

  function ensureSegments() {
    if (terrain.segments.length === 0) {
      terrain.segments.push(
        { x: -terrain.segmentLength * 2, length: terrain.segmentLength, amplitude: 0, slope: 0, crest: 1 },
        generateSegment(0)
      );
    }

    const last = terrain.segments[terrain.segments.length - 1];
    while (last.x + last.length < camera.x + width * 2) {
      const next = generateSegment(last.x + last.length);
      terrain.segments.push(next);
    }

    // Remove segments that are way behind the camera
    while (terrain.segments.length > 0 && terrain.segments[1].x + terrain.segments[1].length < camera.x - width) {
      terrain.segments.shift();
    }
  }

  function terrainHeight(x) {
    ensureSegments();
    const segments = terrain.segments;
    let seg = segments[0];

    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      if (x >= s.x && x <= s.x + s.length) {
        seg = s;
        break;
      }
    }

    const t = (x - seg.x) / seg.length;
    const eased = smoothstep(0, 1, t);
    const base = height * 0.55 + seg.slope * (x - seg.x);
    const crestDir = seg.crest;
    const y = base + Math.sin(t * Math.PI) * seg.amplitude * crestDir;
    return { y, normal: terrainNormal(seg, t, crestDir) };
  }

  function terrainNormal(seg, t, crestDir) {
    const dx = 1;
    const aheadT = clamp(t + dx / seg.length, 0, 1);
    const behindT = clamp(t - dx / seg.length, 0, 1);

    const ahead = heightAtSegment(seg, aheadT, crestDir);
    const behind = heightAtSegment(seg, behindT, crestDir);

    const dy = ahead - behind;
    const nx = -dy;
    const ny = dx;
    const len = Math.hypot(nx, ny) || 1;
    return { x: nx / len, y: ny / len };
  }

  function heightAtSegment(seg, t, crestDir) {
    const base = height * 0.55 + seg.slope * seg.length * t;
    return base + Math.sin(t * Math.PI) * seg.amplitude * crestDir;
  }

  function slopeAngle(normal) {
    // normal rotated 90 degrees gives tangent; slope angle from tangent
    return Math.atan2(normal.x, normal.y);
  }

  // ---------------------------------------------------------------------------
  // Particle helpers (snow spray, wind trails)
  // ---------------------------------------------------------------------------
  const particles = [];

  // Collectibles: fish
  const fishies = [];
  let fishSpawnTimer = 0;
  const fishSpawnInterval = 1.8;

  function spawnFish() {
    const spawnX = camera.x + width * 1.4;
    const { y } = terrainHeight(spawnX);
    const altitude = randRange(-120, -40);
    fishies.push({
      x: spawnX,
      y: y + altitude,
      vy: randRange(-20, 20),
      wobble: Math.random() * Math.PI * 2,
      collected: false,
    });
  }

  function spawnSpray(x, y, speed) {
    const count = 10 + Math.floor(Math.min(20, speed * 0.2));
    for (let i = 0; i < count; i++) {
      particles.push({
        x,
        y,
        vx: randRange(-50, -5),
        vy: randRange(-80, -20),
        life: randRange(0.3, 0.6),
        age: 0,
        size: randRange(2, 4),
        color: "rgba(255,255,255,0.85)",
      });
    }
  }

  function spawnWindTrail(x, y, dir, speed) {
    const count = 6 + Math.floor(speed * 0.05);
    for (let i = 0; i < count; i++) {
      particles.push({
        x: x + randRange(-6, 6),
        y: y + randRange(-6, 6),
        vx: dir * randRange(80, 140),
        vy: randRange(-10, 10),
        life: randRange(0.5, 1.1),
        age: 0,
        size: randRange(2, 3.5),
        color: "rgba(255,255,255,0.5)",
      });
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        particles.splice(i, 1);
        continue;
      }
      const alpha = 1 - p.age / p.life;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.renderAlpha = alpha;
    }
  }

  function drawParticles() {
    particles.forEach((p) => {
      ctx.globalAlpha = p.renderAlpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x - camera.x, p.y - camera.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // Fish collectibles
  // ---------------------------------------------------------------------------
  function updateFish(dt) {
    fishSpawnTimer += dt;
    if (fishSpawnTimer >= fishSpawnInterval) {
      fishSpawnTimer = 0;
      spawnFish();
    }

    for (let i = fishies.length - 1; i >= 0; i--) {
      const f = fishies[i];
      f.wobble += dt * 3;
      f.y += Math.sin(f.wobble) * 14 * dt + f.vy * dt;
      const screenX = f.x - camera.x;
      if (screenX < -120) {
        fishies.splice(i, 1);
        continue;
      }

      // Collision with penguin
      const dx = penguin.x - screenX;
      const dy = penguin.y - f.y;
      const dist2 = dx * dx + dy * dy;
      if (dist2 < 42 * 42) {
        penguin.fish += 1;
        penguin.boosts = clamp(penguin.boosts + 0.25, 0, 1.5);
        spawnWindTrail(screenX, f.y, -1, 140);
        fishies.splice(i, 1);
      }
    }
  }

  function drawFish() {
    ctx.save();
    fishies.forEach((f) => {
      const x = f.x - camera.x;
      const y = f.y - camera.y + height * 0.65;
      ctx.translate(x, y);
      ctx.scale(0.8, 0.8);
      ctx.beginPath();
      ctx.fillStyle = "#2a85ff";
      ctx.moveTo(-14, 0);
      ctx.quadraticCurveTo(-6, -12, 12, 0);
      ctx.quadraticCurveTo(-6, 12, -14, 0);
      ctx.fill();
      ctx.fillStyle = "#ffdf40";
      ctx.beginPath();
      ctx.arc(6, -2, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    });
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Background parallax layers
  // ---------------------------------------------------------------------------
  class ParallaxLayer {
    constructor(config) {
      this.speed = config.speed;
      this.color = config.color;
      this.alpha = config.alpha ?? 1;
      this.hillAmp = config.hillAmp ?? 120;
      this.hillLen = config.hillLen ?? 420;
      this.offset = 0;
      this.noise = mulberry32(Math.floor(rng() * 1_000_000));
    }

    resync() {
      this.offset = 0;
    }

    update(dt, baseSpeed) {
      this.offset += baseSpeed * this.speed * dt;
    }

    draw() {
      ctx.save();
      ctx.globalAlpha = this.alpha;
      ctx.fillStyle = this.color;
      const baseY = height * 0.55 - this.hillAmp * 0.3;
      const step = 60;
      ctx.beginPath();
      ctx.moveTo(0, height);
      for (let x = -step; x <= width + step; x += step) {
        const worldX = x + camera.x * this.speed + this.offset;
        const y = baseY + Math.sin(worldX / this.hillLen) * this.hillAmp;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  const backgroundLayers = [
    new ParallaxLayer({ speed: 0.15, color: "#042c4c", alpha: 0.35, hillAmp: 140, hillLen: 520 }),
    new ParallaxLayer({ speed: 0.28, color: "#06365e", alpha: 0.45, hillAmp: 180, hillLen: 480 }),
    new ParallaxLayer({ speed: 0.42, color: "#0a4a7a", alpha: 0.55, hillAmp: 220, hillLen: 420 }),
  ];

  let dayTimer = 0;
  const DAY_LENGTH = 110; // seconds

  function drawSkyGradient() {
    const t = (dayTimer % DAY_LENGTH) / DAY_LENGTH;
    const dawn = { top: "#2b4b7a", mid: "#4f84c4", bot: "#9fc4ff" };
    const noon = { top: "#67b6ff", mid: "#9edcff", bot: "#d6f1ff" };
    const dusk = { top: "#1f2f5a", mid: "#334b7a", bot: "#7ea7e3" };
    const night = { top: "#0e1328", mid: "#1b2342", bot: "#24325f" };

    const phases = [dawn, noon, dusk, night];
    const phase = Math.floor(t * phases.length);
    const nextPhase = (phase + 1) % phases.length;
    const localT = (t * phases.length) % 1;

    const mixColor = (a, b, tt) => {
      const ca = parseInt(a.slice(1), 16);
      const cb = parseInt(b.slice(1), 16);
      const ar = (ca >> 16) & 0xff;
      const ag = (ca >> 8) & 0xff;
      const ab = ca & 0xff;
      const br = (cb >> 16) & 0xff;
      const bg = (cb >> 8) & 0xff;
      const bb = cb & 0xff;
      const r = Math.round(lerp(ar, br, tt));
      const g = Math.round(lerp(ag, bg, tt));
      const b = Math.round(lerp(ab, bb, tt));
      return `rgb(${r},${g},${b})`;
    };

    const current = phases[phase];
    const next = phases[nextPhase];

    const g = ctx.createLinearGradient(0, 0, 0, height);
    g.addColorStop(0, mixColor(current.top, next.top, localT));
    g.addColorStop(0.55, mixColor(current.mid, next.mid, localT));
    g.addColorStop(1, mixColor(current.bot, next.bot, localT));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }

  function drawSun() {
    const cx = width * 0.8;
    const cy = height * 0.2;
    const g = ctx.createRadialGradient(cx, cy, 20, cx, cy, 160);
    g.addColorStop(0, "rgba(255,255,255,0.95)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }

  // ---------------------------------------------------------------------------
  // Penguin entity and physics
  // ---------------------------------------------------------------------------
  const penguin = {
    x: width * 0.28,
    y: 0,
    vy: 0,
    vx: 0,
    width: 60,
    height: 70,
    onGround: false,
    rotation: 0,
    state: "sliding", // sliding | flying | landing
    diveHeld: false,
    scoreDistance: 0,
    combo: 0,
    lastHillLandTime: 0,
    fish: 0,
    boosts: 0,
  };

  // Place the penguin on solid ground for the initial render before the player starts.
  const initialGround = terrainHeight(camera.x + penguin.x).y;
  penguin.y = initialGround - penguin.height;
  camera.targetY = penguin.y;
  camera.y = penguin.y;

  const physics = {
    gravity: 2200,
    diveGravity: 3800,
    drag: 0.06,
    lift: 0.06,
    maxSpeed: 1800,
    groundFriction: 0.998,
    airFriction: 0.992,
    slopeBoost: 1400,
    perfectThreshold: 0.45, // landing threshold angle
  };

  // Input
  const input = {
    held: false,
  };

  document.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      input.held = true;
      e.preventDefault();
    }
  });

  document.addEventListener("keyup", (e) => {
    if (e.code === "Space") {
      input.held = false;
      e.preventDefault();
    }
  });

  canvas.addEventListener("mousedown", () => (input.held = true));
  canvas.addEventListener("mouseup", () => (input.held = false));
  canvas.addEventListener("mouseleave", () => (input.held = false));
  canvas.addEventListener("touchstart", () => (input.held = true), { passive: true });
  canvas.addEventListener("touchend", () => (input.held = false), { passive: true });
  canvas.addEventListener("touchcancel", () => (input.held = false), { passive: true });

  // ---------------------------------------------------------------------------
  // Scoring and leaderboard
  // ---------------------------------------------------------------------------
  function loadBest() {
    const val = parseInt(localStorage.getItem(STORAGE_BEST) || "0", 10);
    bestDisplay.textContent = isNaN(val) ? "0" : val.toString();
    return isNaN(val) ? 0 : val;
  }

  let bestScore = loadBest();

  function saveBest(score) {
    if (score > bestScore) {
      bestScore = score;
      localStorage.setItem(STORAGE_BEST, String(score));
      bestDisplay.textContent = String(score);
    }
  }

  function loadScores() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_SCORES) || "[]");
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  }

  function saveScores(scores) {
    localStorage.setItem(STORAGE_SCORES, JSON.stringify(scores));
  }

  function addScore(name, score) {
    const scores = loadScores();
    scores.push({ name: name || "Penguin", score, ts: Date.now() });
    scores.sort((a, b) => b.score - a.score);
    const trimmed = scores.slice(0, 10);
    saveScores(trimmed);
    renderLeaderboard(trimmed);
  }

  function renderLeaderboard(scores = loadScores()) {
    leaderboardList.innerHTML = "";
    scores.forEach((s) => {
      const li = document.createElement("li");
      li.textContent = `${s.name}: ${s.score} m`;
      leaderboardList.appendChild(li);
    });
  }

  renderLeaderboard();

  // ---------------------------------------------------------------------------
  // Achievements system
  // ---------------------------------------------------------------------------
  const ACH_STORE = "racingPenguinAchievements";
  const achievementDefs = [
    { id: "distance1", label: "First Glide", desc: "Travel 500m", check: () => penguin.scoreDistance >= 500 },
    { id: "distance2", label: "Sky Rider", desc: "Travel 1500m", check: () => penguin.scoreDistance >= 1500 },
    { id: "combo3", label: "Streaker", desc: "Reach combo x3", check: () => penguin.combo >= 3 },
    { id: "fish5", label: "Fisher", desc: "Collect 5 fish", check: () => penguin.fish >= 5 },
    { id: "perfect", label: "Perfect Landing", desc: "Land with perfect timing", check: () => recentPerfectLanding },
  ];

  let unlockedAchievements = new Set(loadAchievements());
  const toasts = [];
  let recentPerfectLanding = false;

  function loadAchievements() {
    try {
      const raw = JSON.parse(localStorage.getItem(ACH_STORE) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch (e) {
      return [];
    }
  }

  function saveAchievements() {
    localStorage.setItem(ACH_STORE, JSON.stringify(Array.from(unlockedAchievements)));
  }

  function addToast(text) {
    toasts.push({ text, life: 2.8, age: 0 });
  }

  function updateToasts(dt) {
    for (let i = toasts.length - 1; i >= 0; i--) {
      const t = toasts[i];
      t.age += dt;
      if (t.age >= t.life) {
        toasts.splice(i, 1);
      }
    }
  }

  function drawToasts() {
    ctx.save();
    ctx.font = "16px Inter";
    toasts.forEach((t, i) => {
      const alpha = 1 - t.age / t.life;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      const y = 100 + i * 26;
      ctx.fillRect(20, y - 16, 240, 22);
      ctx.fillStyle = "#fff";
      ctx.fillText(t.text, 30, y);
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function evaluateAchievements() {
    let unlockedThisFrame = false;
    achievementDefs.forEach((a) => {
      if (unlockedAchievements.has(a.id)) return;
      if (a.check()) {
        unlockedAchievements.add(a.id);
        addToast(`Achievement: ${a.label}`);
        unlockedThisFrame = true;
      }
    });
    if (unlockedThisFrame) saveAchievements();
    recentPerfectLanding = false;
  }

  // ---------------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------------
  let state = "menu"; // menu | playing | gameover
  let lastTime = performance.now();
  let accumulator = 0;
  const FIXED_DT = 1 / 60;
  let distance = 0;
  let horizonScrollSpeed = 0;
  let parallaxSpeed = 0;

  function resetGame() {
    state = "playing";
    penguin.x = width * 0.28;
    penguin.y = terrainHeight(0).y - penguin.height;
    penguin.vx = 0;
    penguin.vy = 0;
    penguin.onGround = true;
    penguin.state = "sliding";
    penguin.combo = 0;
    penguin.scoreDistance = 0;
    penguin.fish = 0;
    penguin.boosts = 0;
    distance = 0;
    terrain.segments = [];
    backgroundLayers.forEach((l) => l.resync());
    particles.length = 0;
    fishies.length = 0;
    camera.x = 0;
    camera.targetY = penguin.y;
    camera.y = penguin.y;
    camera.shakeStrength = 0;
    camera.shakeTime = 0;
  }

  function endRun() {
    state = "gameover";
    const final = Math.floor(distance / 10);
    finalDistanceEl.textContent = String(final);
    saveBest(final);
    overlay.classList.add("hidden");
    gameOverPanel.classList.remove("hidden");
    playerNameInput.value = "";
    playerNameInput.focus();
  }

  // ---------------------------------------------------------------------------
  // Physics helpers
  // ---------------------------------------------------------------------------
  function updatePenguin(dt) {
    penguin.diveHeld = input.held;
    const desiredGravity = penguin.diveHeld ? physics.diveGravity : physics.gravity;

    // Terrain interaction
    const worldX = camera.x + penguin.x;
    const { y: groundY, normal } = terrainHeight(worldX);
    const slope = slopeAngle(normal);

    if (penguin.onGround) {
      // Align penguin to slope
      penguin.rotation = lerp(penguin.rotation, slope, 0.18);
      const tangentSpeed = penguin.vx;
      const diveForce = penguin.diveHeld ? 1 : 0;
      penguin.vx += Math.sin(slope) * physics.slopeBoost * dt * (0.6 + diveForce * 0.85);
      const groundFrictionFactor = Math.pow(physics.groundFriction, dt * 60);
      penguin.vx *= groundFrictionFactor;
      penguin.vx = clamp(penguin.vx, 0, physics.maxSpeed);

      if (penguin.vx < 140) {
        penguin.vx = lerp(penguin.vx, 180, dt * 2.2);
      }

      // vertical lock to ground
      penguin.y = groundY - penguin.height * 0.5;
      penguin.vy = 0;

      // Jump when crest and player releases (auto launch)
      const isCrest = slope < -0.2 && !penguin.diveHeld && tangentSpeed > 120;
      if (isCrest) {
        penguin.onGround = false;
        penguin.state = "flying";
        penguin.vy = -Math.max(420, tangentSpeed * 0.4);
        spawnSpray(worldX - camera.x, penguin.y + penguin.height * 0.3, penguin.vx);
      }

      // Hard press dive adds ground slam
      if (penguin.diveHeld) {
        penguin.vx += Math.cos(slope) * 220 * dt;
        penguin.vy += Math.sin(slope) * 180 * dt;
      }
    } else {
      // Airborne
      penguin.vy += desiredGravity * dt;
      penguin.vx *= 1 - physics.airFriction * dt;
      penguin.vx = clamp(penguin.vx, 0, physics.maxSpeed * 1.4);

      // Apply lift when releasing
      if (!penguin.diveHeld && penguin.vy > 0) {
        penguin.vy -= physics.lift * penguin.vx * dt;
      }

      // Spend boosts earned from fish
      if (penguin.boosts > 0 && !penguin.diveHeld) {
        const spend = Math.min(penguin.boosts, dt * 0.35);
        penguin.boosts -= spend;
        penguin.vy -= 220 * spend;
        penguin.vx += 40 * spend;
      }

      // Rotate toward flight angle
      const angle = Math.atan2(penguin.vy, penguin.vx + 1);
      penguin.rotation = lerp(penguin.rotation, angle * 0.48, 0.1);

      // Update position
      penguin.y += penguin.vy * dt;

      // Collision with ground
      const footY = penguin.y + penguin.height * 0.4;
      if (footY >= groundY) {
        const impact = Math.abs(penguin.vy);
        penguin.onGround = true;
        penguin.state = "landing";
        penguin.y = groundY - penguin.height * 0.4;
        penguin.vy = 0;
        const landingAngle = Math.abs(slope);
        const perfect = landingAngle < physics.perfectThreshold && impact > 200;
        if (perfect) {
          penguin.combo += 1;
          penguin.vx += Math.min(600, impact * 0.8);
          spawnSpray(worldX - camera.x, groundY, penguin.vx);
          camera.shakeTime = 0.25;
          camera.shakeStrength = 10;
          recentPerfectLanding = true;
        } else {
          penguin.combo = 0;
          penguin.vx *= 0.75;
        }
        penguin.state = "sliding";
      }
    }

    // Horizontal movement forward
    const forward = (penguin.vx + 280) * dt;
    camera.x += forward;
    distance += forward;
    penguin.scoreDistance = Math.floor(distance / 10);
    distanceDisplay.textContent = `${penguin.scoreDistance}`;
    speedDisplay.textContent = `${Math.floor(penguin.vx)}`;

    const desiredCameraY = penguin.y - penguin.height * 0.35;
    camera.targetY = lerp(camera.targetY, desiredCameraY, 0.1);
    camera.y = lerp(camera.y, camera.targetY, 0.2);
  }

  // ---------------------------------------------------------------------------
  // Drawing helpers
  // ---------------------------------------------------------------------------
  function drawTerrain() {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, height);
    const step = 18;
    for (let x = -step; x <= width + step; x += step) {
      const worldX = x + camera.x;
      const { y } = terrainHeight(worldX);
      ctx.lineTo(x, y - camera.y + height * 0.65);
    }
    ctx.lineTo(width, height);
    ctx.closePath();

    const g = ctx.createLinearGradient(0, height * 0.45, 0, height);
    g.addColorStop(0, "#cfeeff");
    g.addColorStop(0.5, "#9ddcff");
    g.addColorStop(1, "#62b6ff");
    ctx.fillStyle = g;
    ctx.fill();

    ctx.save();
    ctx.clip();
    const shade = ctx.createLinearGradient(0, 0, 0, height);
    shade.addColorStop(0, "rgba(255,255,255,0.08)");
    shade.addColorStop(1, "rgba(0,40,90,0.25)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    ctx.strokeStyle = "rgba(255,255,255,0.72)";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();
  }

  function drawPenguin() {
    const px = penguin.x;
    const py = penguin.y - camera.y + height * 0.65;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(penguin.rotation);

    // Body
    const bodyGradient = ctx.createLinearGradient(-30, -50, 30, 50);
    bodyGradient.addColorStop(0, "#1f3c63");
    bodyGradient.addColorStop(1, "#0a1628");
    ctx.fillStyle = bodyGradient;
    ctx.beginPath();
    ctx.ellipse(0, 0, 28, 38, 0, 0, Math.PI * 2);
    ctx.fill();

    // Outline for crisp edges
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Belly
    ctx.fillStyle = "#f5fbff";
    ctx.beginPath();
    ctx.ellipse(2, 8, 18, 24, 0, 0, Math.PI * 2);
    ctx.fill();

    // Face patch
    ctx.fillStyle = "#dff3ff";
    ctx.beginPath();
    ctx.ellipse(8, -10, 14, 12, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eye
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(14, -12, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(15, -13, 2, 0, Math.PI * 2);
    ctx.fill();

    // Beak
    ctx.fillStyle = "#ffb400";
    ctx.beginPath();
    ctx.moveTo(24, -6);
    ctx.quadraticCurveTo(38, 0, 22, 4);
    ctx.closePath();
    ctx.fill();

    // Flippers
    ctx.fillStyle = "#0c2039";
    ctx.beginPath();
    ctx.ellipse(-22, 0, 12, 18, -0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(20, 8, 10, 16, 0.4, 0, Math.PI * 2);
    ctx.fill();

    // Feet
    ctx.fillStyle = "#ffb400";
    ctx.beginPath();
    ctx.ellipse(-10, 30, 12, 6, 0.2, 0, Math.PI * 2);
    ctx.ellipse(10, 30, 12, 6, -0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawUI() {
    // Combo indicator
    if (penguin.combo > 0 && state === "playing") {
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = "20px Inter";
      ctx.fillText(`Combo x${penguin.combo}`, 20, 40);
      ctx.restore();
    }

    // Fish counter
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(width - 180, 18, 160, 42);
    ctx.fillStyle = "#fff";
    ctx.font = "16px Inter";
    ctx.fillText(`Fish: ${penguin.fish}`, width - 170, 46);
    ctx.restore();

    // Boost meter
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(width - 180, 66, 160, 14);
    ctx.fillStyle = "#63ffda";
    const boostWidth = 150 * clamp(penguin.boosts, 0, 1);
    ctx.fillRect(width - 175, 70, boostWidth, 6);
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.strokeRect(width - 180, 66, 160, 14);
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Decorative birds
  // ---------------------------------------------------------------------------
  const flock = [];
  function spawnBirds() {
    for (let i = 0; i < 12; i++) {
      flock.push({
        x: randRange(camera.x + width * 0.3, camera.x + width * 2),
        y: randRange(height * 0.1, height * 0.45),
        speed: randRange(40, 90),
        flap: Math.random() * Math.PI * 2,
      });
    }
  }
  spawnBirds();

  function updateBirds(dt) {
    for (let i = 0; i < flock.length; i++) {
      const b = flock[i];
      b.x -= (120 + b.speed) * dt;
      b.flap += dt * 8;
      b.y += Math.sin(b.flap) * 10 * dt;
      if (b.x - camera.x < -80) {
        b.x = camera.x + width + randRange(60, 280);
        b.y = randRange(height * 0.08, height * 0.42);
      }
      requestJump();
      e.preventDefault();
    }
  }

  function drawBirds() {
    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 2;
    flock.forEach((b) => {
      const x = b.x - camera.x;
      const y = b.y;
      ctx.beginPath();
      ctx.moveTo(x - 8, y);
      ctx.quadraticCurveTo(x - 2, y - 6, x + 6, y);
      ctx.stroke();
    });
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Clouds
  // ---------------------------------------------------------------------------
  const clouds = [];
  function spawnClouds() {
    for (let i = 0; i < 14; i++) {
      clouds.push({
        x: randRange(0, width),
        y: randRange(40, height * 0.35),
        scale: randRange(0.5, 1.6),
        speed: randRange(10, 40),
        alpha: randRange(0.25, 0.7),
      });
    }
  }
  spawnClouds();

  function updateClouds(dt) {
    clouds.forEach((c) => {
      c.x -= c.speed * dt;
      if (c.x < -120) {
        c.x = width + randRange(40, 160);
        c.y = randRange(40, height * 0.35);
      }
    });
  }

  function drawClouds() {
    ctx.save();
    clouds.forEach((c) => {
      ctx.globalAlpha = c.alpha;
      const x = c.x;
      const y = c.y;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.ellipse(x, y, 60 * c.scale, 30 * c.scale, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 50 * c.scale, y + 10 * c.scale, 50 * c.scale, 26 * c.scale, 0, 0, Math.PI * 2);
      ctx.ellipse(x - 40 * c.scale, y + 8 * c.scale, 46 * c.scale, 20 * c.scale, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Game loop
  // ---------------------------------------------------------------------------
  function update(dt) {
    if (state !== "playing") return;

    ensureSegments();

    parallaxSpeed = lerp(parallaxSpeed, penguin.vx + 220, 0.12);
    backgroundLayers.forEach((layer) => layer.update(dt, parallaxSpeed));
    dayTimer += dt;
    updateClouds(dt);
    updateBirds(dt);
    updateFish(dt);
    updatePenguin(dt);
    updateParticles(dt);
    updateToasts(dt);
    evaluateAchievements();

    const shake = applyCameraShake(dt);
    camera.offsetX = shake.x;
    camera.offsetY = shake.y;
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);

    // Base sky
    drawSkyGradient();
    drawSun();
    drawClouds();
    backgroundLayers.forEach((layer) => layer.draw());
    drawBirds();

    ctx.save();
    ctx.translate(camera.offsetX, camera.offsetY);
    drawTerrain();
    drawFish();
    drawParticles();
    ctx.restore();

    drawPenguin();
    drawUI();
    drawToasts();
  }

  function loop(timestamp) {
    const frameDt = Math.min((timestamp - lastTime) / 1000, 0.05);
    lastTime = timestamp;
    accumulator += frameDt;

    let stepCount = 0;
    while (accumulator >= FIXED_DT && stepCount < 6) {
      if (state === "playing") {
        update(FIXED_DT);
      }
      accumulator -= FIXED_DT;
      stepCount += 1;
    }

    draw();
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);

  // ---------------------------------------------------------------------------
  // UI events
  // ---------------------------------------------------------------------------
  startButton.addEventListener("click", () => {
    overlay.classList.add("hidden");
    resetGame();
  });

  restartButton.addEventListener("click", () => {
    gameOverPanel.classList.add("hidden");
    resetGame();
  });

  saveScoreButton.addEventListener("click", () => {
    if (state !== "gameover") return;
    const name = playerNameInput.value.trim() || "Penguin";
    addScore(name, Math.floor(distance / 10));
    gameOverPanel.classList.add("hidden");
    overlay.classList.remove("hidden");
    state = "menu";
  });

  skipSaveButton.addEventListener("click", () => {
    if (state !== "gameover") return;
    gameOverPanel.classList.add("hidden");
    overlay.classList.remove("hidden");
    state = "menu";
  });

  // ---------------------------------------------------------------------------
  // Failsafe: end run if penguin stops moving
  // ---------------------------------------------------------------------------
  setInterval(() => {
    if (state !== "playing") return;
    if (penguin.vx < 10 && penguin.onGround) {
      endRun();
    }
  }, 1500);

  // ---------------------------------------------------------------------------
  // Debug overlay (toggle with `D`)
  // ---------------------------------------------------------------------------
  const debug = {
    enabled: false,
  };

  document.addEventListener("keydown", (e) => {
    if (e.code === "KeyD") {
      debug.enabled = !debug.enabled;
    }
  });

  function drawDebug() {
    if (!debug.enabled) return;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(10, height - 120, 280, 110);
    ctx.fillStyle = "#fff";
    ctx.font = "12px monospace";
    ctx.fillText(`vx: ${penguin.vx.toFixed(1)}`, 20, height - 100);
    ctx.fillText(`vy: ${penguin.vy.toFixed(1)}`, 20, height - 85);
    ctx.fillText(`state: ${penguin.state}`, 20, height - 70);
    ctx.fillText(`combo: ${penguin.combo}`, 20, height - 55);
    ctx.fillText(`distance: ${penguin.scoreDistance}`, 20, height - 40);
    ctx.fillText(`segments: ${terrain.segments.length}`, 20, height - 25);
    ctx.restore();
  }

  // Insert debug drawing into main draw
  const originalDraw = draw;
  draw = function () {
    originalDraw();
    drawDebug();
  };

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------
  overlay.classList.remove("hidden");
  gameOverPanel.classList.add("hidden");
  penguin.y = terrainHeight(0).y - penguin.height;
  draw();
})();
