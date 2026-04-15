// =========================================================
//  Endless Runner – Subway Style
//  HTML5 Canvas, reiner Vanilla-JS, pseudo-3D Perspektive
// =========================================================

(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const W = canvas.width;   // 480
  const H = canvas.height;  // 800

  // ---------- Spielkonstanten ----------
  const LANES = 3;
  const LANE_X = [-1, 0, 1]; // linke, mittlere, rechte Spur
  const ROAD_WIDTH_NEAR = 420;
  const ROAD_WIDTH_FAR  = 80;
  const HORIZON_Y = H * 0.35;
  const FLOOR_Y   = H * 0.92;

  const GRAVITY       = 0.9;
  const JUMP_POWER    = 17;
  const SLIDE_TIME    = 38;     // Frames
  const LANE_SWITCH_SPEED = 0.18;

  const START_SPEED   = 8;
  const MAX_SPEED     = 22;
  const SPEED_RAMP    = 0.0015;

  const SPAWN_GAP_BASE = 70;    // Frames zwischen Spawns (near-Bereich)

  // ---------- Spielzustand ----------
  let state = "menu"; // menu | playing | dead
  let frame = 0;
  let speed = START_SPEED;
  let distance = 0;
  let score = 0;
  let coinsCollected = 0;
  let best = parseInt(localStorage.getItem("er_best") || "0", 10);

  const player = {
    lane: 1,           // 0=links, 1=mitte, 2=rechts
    laneFloat: 1,      // für smooth lane switch
    y: 0,              // Höhe über Boden (für Sprung)
    vy: 0,
    jumping: false,
    sliding: false,
    slideTimer: 0,
    hurtFlash: 0,
  };

  let obstacles = []; // { lane, z, type, hit }
  let coins = [];     // { lane, z, y }
  let particles = []; // { x, y, vx, vy, life, color, size }

  let spawnTimer = 0;
  let linePhase = 0;

  // ---------- Utility ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand  = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));

  // Perspektiv-Projektion: z=0 = nahe Kamera (unten), z=1 = Horizont (oben)
  function project(z, laneOffset, heightOffset = 0) {
    // nicht-linear für stärkere Tiefe
    const t = 1 - 1 / (1 + z * 3);           // t in [0,1)
    const y = FLOOR_Y - (FLOOR_Y - HORIZON_Y) * t;
    const roadW = ROAD_WIDTH_NEAR + (ROAD_WIDTH_FAR - ROAD_WIDTH_NEAR) * t;
    const laneW = roadW / LANES;
    const cx = W / 2 + laneOffset * laneW;
    const scale = 1 - t;
    return {
      x: cx,
      y: y - heightOffset * scale,
      scale,
    };
  }

  // ---------- Input ----------
  function moveLane(dir) {
    if (state !== "playing") return;
    player.lane = clamp(player.lane + dir, 0, LANES - 1);
  }

  function jump() {
    if (state !== "playing") return;
    if (!player.jumping && !player.sliding) {
      player.jumping = true;
      player.vy = JUMP_POWER;
    }
  }

  function slide() {
    if (state !== "playing") return;
    if (!player.sliding && !player.jumping) {
      player.sliding = true;
      player.slideTimer = SLIDE_TIME;
    }
  }

  window.addEventListener("keydown", (e) => {
    switch (e.code) {
      case "ArrowLeft":
      case "KeyA": moveLane(-1); break;
      case "ArrowRight":
      case "KeyD": moveLane(1); break;
      case "ArrowUp":
      case "KeyW":
      case "Space": jump(); e.preventDefault(); break;
      case "ArrowDown":
      case "KeyS": slide(); break;
      case "Enter":
        if (state === "menu") startGame();
        else if (state === "dead") startGame();
        break;
    }
  });

  // Touch / Swipe
  let touchStart = null;
  canvas.addEventListener("touchstart", (e) => {
    const t = e.changedTouches[0];
    touchStart = { x: t.clientX, y: t.clientY, time: Date.now() };
  }, { passive: true });

  canvas.addEventListener("touchend", (e) => {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    const MIN = 24;
    if (ax < MIN && ay < MIN) {
      // Tap = Sprung
      jump();
    } else if (ax > ay) {
      moveLane(dx > 0 ? 1 : -1);
    } else {
      if (dy < 0) jump();
      else slide();
    }
    touchStart = null;
  }, { passive: true });

  // ---------- DOM Screens ----------
  const scoreEl = document.getElementById("score");
  const coinsEl = document.getElementById("coins");
  const bestEl  = document.getElementById("best");
  const startScreen = document.getElementById("start-screen");
  const gameOverScreen = document.getElementById("game-over");
  const finalScore = document.getElementById("final-score");
  const finalCoins = document.getElementById("final-coins");
  const finalBest  = document.getElementById("final-best");

  document.getElementById("start-btn").addEventListener("click", startGame);
  document.getElementById("restart-btn").addEventListener("click", startGame);
  bestEl.textContent = best;

  function startGame() {
    state = "playing";
    frame = 0;
    speed = START_SPEED;
    distance = 0;
    score = 0;
    coinsCollected = 0;
    obstacles = [];
    coins = [];
    particles = [];
    spawnTimer = 30;
    player.lane = 1;
    player.laneFloat = 1;
    player.y = 0;
    player.vy = 0;
    player.jumping = false;
    player.sliding = false;
    player.slideTimer = 0;
    player.hurtFlash = 0;

    startScreen.classList.add("hidden");
    gameOverScreen.classList.add("hidden");
  }

  function gameOver() {
    state = "dead";
    if (score > best) {
      best = score;
      localStorage.setItem("er_best", best);
    }
    finalScore.textContent = score;
    finalCoins.textContent = coinsCollected;
    finalBest.textContent = best;
    bestEl.textContent = best;
    gameOverScreen.classList.remove("hidden");
    spawnExplosion(W / 2, FLOOR_Y - 60);
  }

  // ---------- Spawner ----------
  function spawnRow() {
    // Manche Reihen haben 1-2 Hindernisse, mindestens eine freie Spur
    const used = new Set();
    const numObstacles = Math.random() < 0.4 ? 2 : 1;
    for (let i = 0; i < numObstacles; i++) {
      const lane = randi(0, 2);
      if (used.has(lane)) continue;
      // nie alle 3 Spuren blockieren
      if (used.size >= 2) break;
      used.add(lane);

      const r = Math.random();
      let type;
      if (r < 0.4) type = "barrier";   // drüber springen
      else if (r < 0.7) type = "hurdle"; // drüber rutschen (hoch oben)
      else type = "block";             // seitlich ausweichen (groß)

      obstacles.push({ lane, z: 1.0, type, hit: false });
    }

    // Münzen in freien Spuren
    for (let lane = 0; lane < LANES; lane++) {
      if (used.has(lane)) continue;
      if (Math.random() < 0.55) {
        // Reihe aus 3-5 Münzen
        const cnt = randi(3, 5);
        for (let k = 0; k < cnt; k++) {
          coins.push({
            lane,
            z: 1.0 + k * 0.04,
            y: Math.random() < 0.15 ? 50 : 0, // manche in der Luft
            taken: false,
          });
        }
      }
    }
  }

  function spawnExplosion(x, y) {
    for (let i = 0; i < 30; i++) {
      particles.push({
        x, y,
        vx: rand(-6, 6),
        vy: rand(-8, 2),
        life: rand(30, 60),
        color: ["#ffd86b", "#ff6b6b", "#ff9a3c"][randi(0, 2)],
        size: rand(3, 6),
      });
    }
  }

  function spawnCoinSparkle(x, y) {
    for (let i = 0; i < 8; i++) {
      particles.push({
        x, y,
        vx: rand(-3, 3),
        vy: rand(-4, -1),
        life: rand(15, 25),
        color: "#ffd86b",
        size: rand(2, 4),
      });
    }
  }

  // ---------- Update ----------
  function update() {
    frame++;
    if (state !== "playing") {
      updateParticles();
      return;
    }

    // Speed ramp
    speed = Math.min(MAX_SPEED, START_SPEED + distance * SPEED_RAMP);
    distance += speed;
    score = Math.floor(distance / 10);

    // smooth lane switch
    player.laneFloat += (player.lane - player.laneFloat) * LANE_SWITCH_SPEED;

    // jump physics
    if (player.jumping) {
      player.y += player.vy;
      player.vy -= GRAVITY;
      if (player.y <= 0) {
        player.y = 0;
        player.vy = 0;
        player.jumping = false;
      }
    }

    // slide timer
    if (player.sliding) {
      player.slideTimer--;
      if (player.slideTimer <= 0) player.sliding = false;
    }

    if (player.hurtFlash > 0) player.hurtFlash--;

    // move obstacles (z -> 0)
    const zStep = speed * 0.0025;
    for (const o of obstacles) o.z -= zStep;
    for (const c of coins)     c.z -= zStep;

    // spawn new rows
    spawnTimer -= 1;
    const gap = Math.max(30, SPAWN_GAP_BASE - Math.floor(distance / 400));
    if (spawnTimer <= 0) {
      spawnRow();
      spawnTimer = gap + randi(-8, 8);
    }

    // remove off-screen
    obstacles = obstacles.filter((o) => o.z > -0.1);
    coins     = coins.filter((c) => c.z > -0.1 && !c.taken);

    // Kollisionen (am Spieler-Z ~ 0.05)
    checkCollisions();

    // Linien-Animation
    linePhase = (linePhase + speed) % 60;

    updateParticles();

    // HUD
    scoreEl.textContent = score;
    coinsEl.textContent = coinsCollected;
  }

  function updateParticles() {
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.3;
      p.life--;
    }
    particles = particles.filter((p) => p.life > 0);
  }

  function checkCollisions() {
    const playerLane = Math.round(player.laneFloat);
    const playerZ = 0.05;
    const Z_TOL = 0.08;

    for (const o of obstacles) {
      if (o.hit) continue;
      if (Math.abs(o.z - playerZ) > Z_TOL) continue;
      if (o.lane !== playerLane) continue;

      // Kollision je nach Typ
      if (o.type === "barrier") {
        // Tisch/Zaun: drüber springen
        if (player.y > 45) continue;
      } else if (o.type === "hurdle") {
        // hoher Balken: drunter rutschen
        if (player.sliding) continue;
      } else if (o.type === "block") {
        // großer Block: nicht drüber und nicht drunter
        // -> nur Spurwechsel hilft
      }

      o.hit = true;
      player.hurtFlash = 20;
      gameOver();
      return;
    }

    for (const c of coins) {
      if (c.taken) continue;
      if (Math.abs(c.z - playerZ) > Z_TOL) continue;
      if (c.lane !== playerLane) continue;
      // wenn Münze in der Luft, muss gesprungen sein
      if (c.y > 30 && player.y < 30) continue;
      c.taken = true;
      coinsCollected++;
      score += 5;
      const pr = project(c.z, LANE_X[c.lane], c.y + 30);
      spawnCoinSparkle(pr.x, pr.y);
    }
  }

  // ---------- Rendering ----------
  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, HORIZON_Y);
    g.addColorStop(0, "#1a2a6c");
    g.addColorStop(0.6, "#b24592");
    g.addColorStop(1, "#fd7e6b");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, HORIZON_Y);

    // Sonne
    ctx.fillStyle = "#ffe79a";
    ctx.beginPath();
    ctx.arc(W * 0.5, HORIZON_Y - 10, 34, 0, Math.PI * 2);
    ctx.fill();

    // Wolken
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    const t = frame * 0.3;
    for (let i = 0; i < 4; i++) {
      const x = ((i * 140 + t) % (W + 200)) - 100;
      const y = 40 + i * 28;
      ctx.beginPath();
      ctx.arc(x, y, 18, 0, Math.PI * 2);
      ctx.arc(x + 18, y + 4, 14, 0, Math.PI * 2);
      ctx.arc(x - 18, y + 4, 14, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawGround() {
    // grüner Boden
    const g = ctx.createLinearGradient(0, HORIZON_Y, 0, H);
    g.addColorStop(0, "#3a8a3a");
    g.addColorStop(1, "#1c5a1c");
    ctx.fillStyle = g;
    ctx.fillRect(0, HORIZON_Y, W, H - HORIZON_Y);

    // Straße als Polygon (Trapez)
    const pNearL = project(0, -1.5);
    const pNearR = project(0,  1.5);
    const pFarL  = project(1, -1.5);
    const pFarR  = project(1,  1.5);

    ctx.beginPath();
    ctx.moveTo(pNearL.x, pNearL.y);
    ctx.lineTo(pNearR.x, pNearR.y);
    ctx.lineTo(pFarR.x,  pFarR.y);
    ctx.lineTo(pFarL.x,  pFarL.y);
    ctx.closePath();
    const rg = ctx.createLinearGradient(0, HORIZON_Y, 0, FLOOR_Y);
    rg.addColorStop(0, "#4a4a55");
    rg.addColorStop(1, "#2a2a35");
    ctx.fillStyle = rg;
    ctx.fill();

    // Spurtrennlinien (Striche) mit Perspektive
    ctx.strokeStyle = "#ffd86b";
    for (let lane = 1; lane < LANES; lane++) {
      const laneEdge = -1.5 + lane;
      // Striche, verteilt in z
      for (let i = 0; i < 16; i++) {
        const zA = i / 16 + (linePhase / 60) / 16;
        const zB = zA + 0.025;
        if (zA > 1 || zB > 1) continue;
        const a = project(zA, laneEdge);
        const b = project(zB, laneEdge);
        ctx.lineWidth = (1 - zA) * 6;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    // Straßenränder
    ctx.strokeStyle = "#e8e8ee";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pNearL.x, pNearL.y);
    ctx.lineTo(pFarL.x,  pFarL.y);
    ctx.moveTo(pNearR.x, pNearR.y);
    ctx.lineTo(pFarR.x,  pFarR.y);
    ctx.stroke();

    // Seitenbäume (Parallax)
    drawTrees();
  }

  function drawTrees() {
    for (let i = 0; i < 14; i++) {
      const zRaw = ((i / 14) + (linePhase / 60) / 14 + 0.02);
      const z = zRaw % 1;
      for (const side of [-2.3, 2.3]) {
        const p = project(z, side);
        const s = (1 - z) * 60;
        if (s < 4) continue;
        // Stamm
        ctx.fillStyle = "#5a3a1a";
        ctx.fillRect(p.x - s * 0.08, p.y - s * 0.4, s * 0.16, s * 0.4);
        // Krone
        ctx.fillStyle = "#2a7a2a";
        ctx.beginPath();
        ctx.arc(p.x, p.y - s * 0.55, s * 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawObstacle(o) {
    const p = project(o.z, LANE_X[o.lane]);
    const s = p.scale;
    if (s <= 0) return;

    const lw = (ROAD_WIDTH_NEAR / LANES) * s * 0.75;

    if (o.type === "barrier") {
      // niedriger Zaun / Kiste -> drüber springen
      const h = 40 * s;
      ctx.fillStyle = "#c94a4a";
      ctx.fillRect(p.x - lw / 2, p.y - h, lw, h);
      ctx.fillStyle = "#7a2222";
      ctx.fillRect(p.x - lw / 2, p.y - 6 * s, lw, 6 * s);
      // Streifen
      ctx.fillStyle = "#fff";
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(p.x - lw / 2 + 4 * s, p.y - h + 8 * s + i * 12 * s, lw - 8 * s, 3 * s);
      }
    } else if (o.type === "hurdle") {
      // hoher Balken -> drunter rutschen
      const h = 130 * s;
      const barH = 18 * s;
      // Pfosten
      ctx.fillStyle = "#555";
      ctx.fillRect(p.x - lw / 2, p.y - h, 8 * s, h);
      ctx.fillRect(p.x + lw / 2 - 8 * s, p.y - h, 8 * s, h);
      // Balken
      ctx.fillStyle = "#ffd86b";
      ctx.fillRect(p.x - lw / 2, p.y - h, lw, barH);
      ctx.fillStyle = "#222";
      // Warnstreifen
      for (let i = 0; i < 6; i++) {
        ctx.fillRect(p.x - lw / 2 + i * (lw / 6), p.y - h + barH / 2 - 2 * s, lw / 12, 4 * s);
      }
    } else {
      // großer Block -> seitlich ausweichen
      const h = 110 * s;
      const grad = ctx.createLinearGradient(0, p.y - h, 0, p.y);
      grad.addColorStop(0, "#4a5bff");
      grad.addColorStop(1, "#1e2a8a");
      ctx.fillStyle = grad;
      ctx.fillRect(p.x - lw / 2, p.y - h, lw, h);
      ctx.strokeStyle = "#9fb3ff";
      ctx.lineWidth = 2 * s;
      ctx.strokeRect(p.x - lw / 2, p.y - h, lw, h);
      // Fenster
      ctx.fillStyle = "#9fd8ff";
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 2; c++) {
          ctx.fillRect(
            p.x - lw / 2 + 10 * s + c * (lw / 2),
            p.y - h + 15 * s + r * 30 * s,
            lw / 3,
            16 * s
          );
        }
      }
    }
  }

  function drawCoin(c) {
    const p = project(c.z, LANE_X[c.lane], c.y + 30);
    const s = p.scale;
    if (s <= 0) return;
    const r = 14 * s;
    // pulsierend
    const pulse = Math.sin(frame * 0.2 + c.z * 20) * 0.15 + 1;
    ctx.fillStyle = "#ffd86b";
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#b46a1a";
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 0.55 * pulse, 0, Math.PI * 2);
    ctx.fill();
    // Glow
    ctx.fillStyle = "rgba(255,216,107,0.25)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 1.8 * pulse, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPlayer() {
    const p = project(0.05, (player.laneFloat - 1), player.y + 20);
    const s = p.scale * 1.05;
    const w = 50 * s;
    const h = (player.sliding ? 50 : 90) * s;
    const x = p.x - w / 2;
    const y = p.y - h;

    // Schatten
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 4, w * 0.55, 7 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // Hurt-Flash
    if (player.hurtFlash > 0 && player.hurtFlash % 6 < 3) {
      ctx.globalAlpha = 0.4;
    }

    // Beine
    ctx.fillStyle = "#2a2a5a";
    if (player.sliding) {
      ctx.fillRect(x + 4, y + h - 14 * s, w - 8, 14 * s);
    } else {
      const legSwing = Math.sin(frame * 0.35) * 6 * s;
      ctx.fillRect(x + 6,      y + h - 28 * s + legSwing, 14 * s, 28 * s - legSwing);
      ctx.fillRect(x + w - 20, y + h - 28 * s - legSwing, 14 * s, 28 * s + legSwing);
    }

    // Körper (Kapuzenjacke)
    const bodyH = player.sliding ? h * 0.5 : h * 0.55;
    const bodyY = y + (player.sliding ? 0 : 18 * s);
    const bodyGrad = ctx.createLinearGradient(0, bodyY, 0, bodyY + bodyH);
    bodyGrad.addColorStop(0, "#ff6b6b");
    bodyGrad.addColorStop(1, "#b03030");
    ctx.fillStyle = bodyGrad;
    ctx.fillRect(x, bodyY, w, bodyH);

    // Rucksack
    ctx.fillStyle = "#ffd86b";
    ctx.fillRect(x + w * 0.25, bodyY + 4 * s, w * 0.5, bodyH * 0.6);

    // Arme (schwingend)
    if (!player.sliding) {
      const armSwing = Math.sin(frame * 0.35) * 8 * s;
      ctx.fillStyle = "#ff6b6b";
      ctx.fillRect(x - 6 * s, bodyY + 8 * s - armSwing, 10 * s, bodyH * 0.5);
      ctx.fillRect(x + w - 4 * s, bodyY + 8 * s + armSwing, 10 * s, bodyH * 0.5);
    }

    // Kopf
    if (!player.sliding) {
      ctx.fillStyle = "#f1c27d";
      ctx.beginPath();
      ctx.arc(p.x, y + 14 * s, 14 * s, 0, Math.PI * 2);
      ctx.fill();
      // Mütze
      ctx.fillStyle = "#2a2a5a";
      ctx.beginPath();
      ctx.arc(p.x, y + 10 * s, 15 * s, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(p.x - 15 * s, y + 8 * s, 30 * s, 4 * s);
      // Augen
      ctx.fillStyle = "#000";
      ctx.fillRect(p.x - 6 * s, y + 14 * s, 3 * s, 3 * s);
      ctx.fillRect(p.x + 3 * s, y + 14 * s, 3 * s, 3 * s);
    }

    ctx.globalAlpha = 1;
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life / 30, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    drawSky();
    drawGround();

    // Entfernungs-sortiert (weit -> nah)
    const drawables = [];
    for (const o of obstacles) drawables.push({ z: o.z, kind: "o", obj: o });
    for (const c of coins)     drawables.push({ z: c.z, kind: "c", obj: c });
    drawables.sort((a, b) => b.z - a.z);
    for (const d of drawables) {
      if (d.kind === "o") drawObstacle(d.obj);
      else drawCoin(d.obj);
    }

    drawPlayer();
    drawParticles();
  }

  // ---------- Main Loop ----------
  function loop() {
    update();
    render();
    requestAnimationFrame(loop);
  }

  loop();
})();
