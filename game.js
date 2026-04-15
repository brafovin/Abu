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

  const GRAVITY       = 0.75;
  const JUMP_POWER    = 16;
  const SLIDE_TIME    = 45;     // Frames
  const LANE_SWITCH_SPEED = 0.18;

  // Basis-Geschwindigkeit. Spiel startet IMMER langsam.
  // Wallet beeinflusst nur das spätere Tempo-Maximum.
  const BASE_START_SPEED = 3.5;
  const BASE_MAX_SPEED   = 11;
  const SPEED_RAMP       = 0.00045;

  // Wallet -> höheres Max-Tempo (aber Start bleibt gleich)
  const WALLET_MAX_DIVISOR = 120;
  const WALLET_MAX_CAP     = 10;

  // effektive Werte (werden in startGame() berechnet)
  let effStartSpeed = BASE_START_SPEED;
  let effMaxSpeed   = BASE_MAX_SPEED;

  const SPAWN_GAP_BASE = 95;    // Frames zwischen Spawns (near-Bereich)

  function computeSpeeds() {
    const maxBonus = Math.min(WALLET_MAX_CAP, wallet / WALLET_MAX_DIVISOR);
    effStartSpeed  = BASE_START_SPEED; // Start immer langsam
    effMaxSpeed    = BASE_MAX_SPEED + maxBonus;
  }

  // ---------- Spielzustand ----------
  let state = "menu"; // menu | playing | dead | shop
  let frame = 0;
  let speed = BASE_START_SPEED;
  let distance = 0;
  let score = 0;
  let coinsCollected = 0;
  let best = parseInt(localStorage.getItem("er_best") || "0", 10);
  let wallet = parseInt(localStorage.getItem("er_wallet") || "0", 10);

  // ---------- Skins ----------
  // Jeder Skin hat eine draw(ctx, x, y, w, h, s, frame, sliding) Funktion
  // die den Charakter in die übergebene Box rendert.
  const SKINS = [
    {
      id: "runner",
      name: "Street Runner",
      price: 0,
      colors: { body: "#ff6b6b", bodyDark: "#b03030", pants: "#2a2a5a", accent: "#ffd86b" },
      draw: drawSkinRunner,
    },
    {
      id: "ninja",
      name: "Schatten-Ninja",
      price: 80,
      colors: { body: "#1a1a22", bodyDark: "#000", pants: "#1a1a22", accent: "#e84a4a" },
      draw: drawSkinNinja,
    },
    {
      id: "astro",
      name: "Astronaut",
      price: 150,
      colors: { body: "#eeeef5", bodyDark: "#9aa0b8", pants: "#eeeef5", accent: "#ff9a3c" },
      draw: drawSkinAstronaut,
    },
    {
      id: "robot",
      name: "Mecha Bot",
      price: 300,
      colors: { body: "#aab4c4", bodyDark: "#454c60", pants: "#555c6f", accent: "#4affff" },
      draw: drawSkinRobot,
    },
    {
      id: "knight",
      name: "Ritter",
      price: 500,
      colors: { body: "#c4c9d6", bodyDark: "#6a6f80", pants: "#3a3d4a", accent: "#d94a4a" },
      draw: drawSkinKnight,
    },
    {
      id: "wizard",
      name: "Magier",
      price: 750,
      colors: { body: "#4a3aa8", bodyDark: "#241a5a", pants: "#241a5a", accent: "#ffd86b" },
      draw: drawSkinWizard,
    },
    {
      id: "cyber",
      name: "Cyber Punk",
      price: 1000,
      colors: { body: "#2a0a3a", bodyDark: "#0a0018", pants: "#18122a", accent: "#ff2ac5" },
      draw: drawSkinCyber,
    },
    {
      id: "pirate",
      name: "Pirat",
      price: 1300,
      colors: { body: "#6a1a1a", bodyDark: "#3a0a0a", pants: "#2a2a35", accent: "#ffd86b" },
      draw: drawSkinPirate,
    },
    {
      id: "samurai",
      name: "Samurai",
      price: 1700,
      colors: { body: "#1a1a33", bodyDark: "#06061a", pants: "#3a1010", accent: "#d94a4a" },
      draw: drawSkinSamurai,
    },
    {
      id: "jetpilot",
      name: "Jet-Pilot",
      price: 2200,
      colors: { body: "#b86a20", bodyDark: "#5a2a00", pants: "#3a2a1a", accent: "#4affe0" },
      draw: drawSkinJetPilot,
    },
  ];

  let ownedSkins = JSON.parse(localStorage.getItem("er_owned") || '["runner"]');
  if (!ownedSkins.includes("runner")) ownedSkins.push("runner");
  let selectedSkin = localStorage.getItem("er_selected") || "runner";
  if (!ownedSkins.includes(selectedSkin)) selectedSkin = "runner";

  function saveShop() {
    localStorage.setItem("er_wallet", wallet);
    localStorage.setItem("er_owned", JSON.stringify(ownedSkins));
    localStorage.setItem("er_selected", selectedSkin);
  }

  function getSkin(id) {
    return SKINS.find((s) => s.id === id) || SKINS[0];
  }

  const player = {
    lane: 1,           // 0=links, 1=mitte, 2=rechts
    laneFloat: 1,      // für smooth lane switch
    y: 0,              // Höhe über Boden (für Sprung)
    vy: 0,
    jumping: false,
    sliding: false,
    slideTimer: 0,
    hurtFlash: 0,
    jetpackTime: 0,    // >0 während Jetpack aktiv (Frames)
  };

  const JETPACK_DURATION = 300; // ca. 5 Sekunden bei 60fps
  const JETPACK_HEIGHT   = 180; // wie hoch der Spieler schwebt

  let obstacles = []; // { lane, z, type, hit }
  let coins = [];     // { lane, z, y }
  let powerups = [];  // { lane, z, type, taken }
  let particles = []; // { x, y, vx, vy, life, color, size }
  let sideTrains = []; // { side, z, length, color }
  let sideTrainTimer = 120;

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

  const walletAmountEl = document.getElementById("wallet-amount");
  const shopWalletEl   = document.getElementById("shop-wallet");
  const walletHudEl    = document.getElementById("wallet-hud-amount");
  const speedBarFill   = document.getElementById("speed-bar-fill");
  const startScreenEl  = startScreen;
  const shopScreen     = document.getElementById("shop-screen");
  const shopGrid       = document.getElementById("shop-grid");

  document.getElementById("start-btn").addEventListener("click", startGame);
  document.getElementById("restart-btn").addEventListener("click", startGame);
  document.getElementById("shop-btn").addEventListener("click", openShop);
  document.getElementById("gameover-shop-btn").addEventListener("click", openShop);
  document.getElementById("shop-back-btn").addEventListener("click", closeShop);
  bestEl.textContent = best;

  function updateWalletHud() {
    walletAmountEl.textContent = wallet;
    walletHudEl.textContent = wallet;
  }

  function updateSpeedHud() {
    // Fülle zwischen BASE_START_SPEED (leer) und BASE_MAX_SPEED + WALLET_MAX_CAP (voll)
    const maxPossible = BASE_MAX_SPEED + WALLET_MAX_CAP;
    const pct = Math.max(0, Math.min(100, (speed / maxPossible) * 100));
    speedBarFill.style.width = pct + "%";
  }

  updateWalletHud();
  computeSpeeds();
  speed = effStartSpeed;
  updateSpeedHud();

  // ---------- Shop ----------
  let shopCameFrom = "menu"; // "menu" | "dead"

  function openShop() {
    shopCameFrom = state === "dead" ? "dead" : "menu";
    state = "shop";
    startScreen.classList.add("hidden");
    gameOverScreen.classList.add("hidden");
    shopScreen.classList.remove("hidden");
    renderShop();
  }

  function closeShop() {
    shopScreen.classList.add("hidden");
    if (shopCameFrom === "dead") {
      state = "dead";
      gameOverScreen.classList.remove("hidden");
    } else {
      state = "menu";
      startScreen.classList.remove("hidden");
    }
    updateWalletHud();
    computeSpeeds();
    updateSpeedHud();
  }

  function renderShop() {
    shopWalletEl.textContent = wallet;
    shopGrid.innerHTML = "";

    for (const skin of SKINS) {
      const owned = ownedSkins.includes(skin.id);
      const selected = selectedSkin === skin.id;

      const card = document.createElement("div");
      card.className = "skin-card" + (owned ? " owned" : "") + (selected ? " selected" : "");

      const preview = document.createElement("canvas");
      preview.width = 80;
      preview.height = 110;
      card.appendChild(preview);
      drawSkinPreview(preview, skin);

      const name = document.createElement("div");
      name.className = "skin-name";
      name.textContent = skin.name;
      card.appendChild(name);

      if (!owned) {
        const price = document.createElement("div");
        price.className = "skin-price";
        price.innerHTML = '<span class="coin-icon"></span>' + skin.price;
        card.appendChild(price);
      }

      const btn = document.createElement("button");
      btn.className = "skin-btn";

      if (selected) {
        btn.textContent = "AKTIV";
        btn.classList.add("selected-btn");
        btn.disabled = true;
      } else if (owned) {
        btn.textContent = "WÄHLEN";
        btn.classList.add("owned-btn");
        btn.addEventListener("click", () => {
          selectedSkin = skin.id;
          saveShop();
          renderShop();
        });
      } else if (wallet >= skin.price) {
        btn.textContent = "KAUFEN";
        btn.addEventListener("click", () => {
          if (wallet >= skin.price) {
            wallet -= skin.price;
            ownedSkins.push(skin.id);
            selectedSkin = skin.id;
            saveShop();
            updateWalletHud();
            renderShop();
          }
        });
      } else {
        btn.textContent = "GESPERRT";
        btn.classList.add("locked");
        btn.disabled = true;
      }

      card.appendChild(btn);
      shopGrid.appendChild(card);
    }
  }

  function drawSkinPreview(cv, skin) {
    const c = cv.getContext("2d");
    c.clearRect(0, 0, cv.width, cv.height);
    // Boden-Schatten
    c.fillStyle = "rgba(0,0,0,0.4)";
    c.beginPath();
    c.ellipse(cv.width / 2, cv.height - 10, 25, 4, 0, 0, Math.PI * 2);
    c.fill();
    // Box für Skin
    const w = 46, h = 82;
    const x = (cv.width - w) / 2;
    const y = cv.height - h - 8;
    const s = 1;
    skin.draw(c, x, y, w, h, s, Math.floor(Date.now() / 30), false);
  }

  function startGame() {
    state = "playing";
    computeSpeeds();
    frame = 0;
    speed = effStartSpeed;
    distance = 0;
    score = 0;
    coinsCollected = 0;
    obstacles = [];
    coins = [];
    powerups = [];
    particles = [];
    sideTrains = [];
    sideTrainTimer = 120;
    spawnTimer = 30;
    player.lane = 1;
    player.laneFloat = 1;
    player.y = 0;
    player.vy = 0;
    player.jumping = false;
    player.sliding = false;
    player.slideTimer = 0;
    player.hurtFlash = 0;
    player.jetpackTime = 0;

    startScreen.classList.add("hidden");
    gameOverScreen.classList.add("hidden");
    shopScreen.classList.add("hidden");
  }

  function gameOver() {
    state = "dead";
    if (score > best) {
      best = score;
      localStorage.setItem("er_best", best);
    }
    wallet += coinsCollected;
    saveShop();
    updateWalletHud();
    finalScore.textContent = score;
    finalCoins.textContent = coinsCollected;
    finalBest.textContent = best;
    bestEl.textContent = best;
    const walletEl = document.getElementById("final-wallet");
    if (walletEl) walletEl.textContent = wallet;
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

    // Seltenes Jetpack-Powerup (~4% Chance pro Reihe)
    if (Math.random() < 0.04) {
      const freeLanes = [];
      for (let l = 0; l < LANES; l++) if (!used.has(l)) freeLanes.push(l);
      if (freeLanes.length > 0) {
        const lane = freeLanes[randi(0, freeLanes.length - 1)];
        powerups.push({ lane, z: 1.0, type: "jetpack", taken: false });
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
    speed = Math.min(effMaxSpeed, effStartSpeed + distance * SPEED_RAMP);
    distance += speed;
    score = Math.floor(distance / 10);
    updateSpeedHud();

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
    const zStep = speed * 0.0022;
    for (const o of obstacles) o.z -= zStep;
    for (const c of coins)     c.z -= zStep;
    for (const pu of powerups) pu.z -= zStep;
    for (const t of sideTrains) t.z -= zStep * 0.9;

    // Seitenzüge filtern und gelegentlich neue erzeugen
    sideTrains = sideTrains.filter((t) => t.z + t.length * 0.09 > -0.05);
    sideTrainTimer--;
    if (sideTrainTimer <= 0) {
      sideTrainTimer = randi(120, 280);
      const colorPool = [
        { top: "#d94a4a", bot: "#7a1818", accent: "#ffd86b" }, // rot
        { top: "#4a8aff", bot: "#1a3a8a", accent: "#ffd86b" }, // blau
        { top: "#4aa04a", bot: "#1a5a1a", accent: "#eeeeee" }, // grün
        { top: "#d0a830", bot: "#7a5a10", accent: "#222" },    // gelb
      ];
      sideTrains.push({
        side: Math.random() < 0.5 ? -1 : 1,
        z: 1.0,
        length: randi(2, 4),
        color: colorPool[randi(0, colorPool.length - 1)],
      });
    }

    // spawn new rows
    spawnTimer -= 1;
    const gap = Math.max(55, SPAWN_GAP_BASE - Math.floor(distance / 900));
    if (spawnTimer <= 0) {
      spawnRow();
      spawnTimer = gap + randi(-8, 8);
    }

    // remove off-screen
    obstacles = obstacles.filter((o) => o.z > -0.1);
    coins     = coins.filter((c) => c.z > -0.1 && !c.taken);
    powerups  = powerups.filter((pu) => pu.z > -0.1 && !pu.taken);

    // Jetpack Timer
    if (player.jetpackTime > 0) {
      player.jetpackTime--;
      // schwebe hoch, ignoriere Sprung/Slide
      player.y = JETPACK_HEIGHT;
      player.vy = 0;
      player.jumping = false;
      player.sliding = false;
      // Rauchfahne
      if (frame % 2 === 0) {
        const pp = project(0.05, (player.laneFloat - 1), player.y + 10);
        particles.push({
          x: pp.x + rand(-4, 4),
          y: pp.y + 10,
          vx: rand(-0.5, 0.5),
          vy: rand(1, 3),
          life: rand(20, 35),
          color: Math.random() < 0.5 ? "#ffd86b" : "#ff6b3c",
          size: rand(4, 7),
        });
      }
    }

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

    // Während Jetpack: unverwundbar, überfliegt alles
    const invincible = player.jetpackTime > 0;

    for (const o of obstacles) {
      if (o.hit) continue;
      if (invincible) continue;
      if (Math.abs(o.z - playerZ) > Z_TOL) continue;
      if (o.lane !== playerLane) continue;

      // Kollision je nach Typ
      if (o.type === "barrier") {
        // Tisch/Zaun: drüber springen
        if (player.y > 45) continue;
      } else if (o.type === "hurdle") {
        // niedriger Balken: drunter ducken/rutschen
        if (player.sliding) continue;
      } else if (o.type === "block") {
        // großer Block: nur Spurwechsel hilft
      }

      o.hit = true;
      player.hurtFlash = 20;
      gameOver();
      return;
    }

    for (const c of coins) {
      if (c.taken) continue;
      if (Math.abs(c.z - playerZ) > Z_TOL) continue;
      if (c.lane !== playerLane && !invincible) continue;
      // wenn Münze in der Luft, muss gesprungen sein (Jetpack kassiert alle)
      if (c.y > 30 && player.y < 30 && !invincible) continue;
      c.taken = true;
      coinsCollected++;
      score += 5;
      const pr = project(c.z, LANE_X[c.lane], c.y + 30);
      spawnCoinSparkle(pr.x, pr.y);
    }

    // Powerups einsammeln
    for (const pu of powerups) {
      if (pu.taken) continue;
      if (Math.abs(pu.z - playerZ) > Z_TOL) continue;
      if (pu.lane !== playerLane) continue;
      pu.taken = true;
      if (pu.type === "jetpack") {
        player.jetpackTime = JETPACK_DURATION;
        const pr = project(pu.z, LANE_X[pu.lane], 80);
        spawnExplosion(pr.x, pr.y);
      }
    }
  }

  // ---------- Rendering ----------
  function drawSky() {
    // Abendstimmung über der Stadt
    const g = ctx.createLinearGradient(0, 0, 0, HORIZON_Y);
    g.addColorStop(0, "#0a1040");
    g.addColorStop(0.5, "#3a2060");
    g.addColorStop(0.85, "#c04a5a");
    g.addColorStop(1, "#f5a848");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, HORIZON_Y);

    // Sterne
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    for (let i = 0; i < 24; i++) {
      const sx = (i * 97 + 31) % W;
      const sy = (i * 53) % (HORIZON_Y * 0.45);
      const twinkle = Math.sin(frame * 0.05 + i) * 0.5 + 0.5;
      ctx.globalAlpha = 0.3 + twinkle * 0.5;
      ctx.fillRect(sx, sy, 1.5, 1.5);
    }
    ctx.globalAlpha = 1;

    // Untergehende Sonne
    const sunY = HORIZON_Y - 18;
    ctx.fillStyle = "#ffdf8a";
    ctx.beginPath();
    ctx.arc(W * 0.7, sunY, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,223,138,0.25)";
    ctx.beginPath();
    ctx.arc(W * 0.7, sunY, 42, 0, Math.PI * 2);
    ctx.fill();

    // Wolken (dunkler, urban)
    ctx.fillStyle = "rgba(30,20,50,0.6)";
    const t = frame * 0.25;
    for (let i = 0; i < 4; i++) {
      const x = ((i * 140 + t) % (W + 200)) - 100;
      const y = 50 + i * 24;
      ctx.beginPath();
      ctx.arc(x, y, 18, 0, Math.PI * 2);
      ctx.arc(x + 18, y + 4, 14, 0, Math.PI * 2);
      ctx.arc(x - 18, y + 4, 14, 0, Math.PI * 2);
      ctx.fill();
    }

    // Stadt-Skyline am Horizont
    drawSkyline();
  }

  function drawSkyline() {
    // Hintere Skyline (dunkler, langsamer Parallax)
    const scroll = (linePhase * 0.3) % 60;
    const baseY = HORIZON_Y - 2;
    ctx.fillStyle = "#18122a";
    for (let i = -2; i < 12; i++) {
      const bx = i * 60 - scroll;
      const bh = 24 + ((i * 37) % 28);
      ctx.fillRect(bx, baseY - bh, 50, bh);
    }
    // Fenster-Lichter
    ctx.fillStyle = "rgba(255,216,107,0.6)";
    for (let i = -2; i < 12; i++) {
      const bx = i * 60 - scroll;
      const bh = 24 + ((i * 37) % 28);
      for (let r = 0; r < Math.floor(bh / 6); r++) {
        for (let k = 0; k < 4; k++) {
          if (((i * 13 + r * 7 + k * 3) % 5) === 0) {
            ctx.fillRect(bx + 6 + k * 11, baseY - bh + 4 + r * 6, 3, 2);
          }
        }
      }
    }

    // Vordere Skyline (etwas dunkler)
    const scroll2 = (linePhase * 0.55) % 90;
    ctx.fillStyle = "#0b0820";
    for (let i = -2; i < 10; i++) {
      const bx = i * 90 - scroll2;
      const bh = 38 + ((i * 53) % 22);
      ctx.fillRect(bx, baseY - bh, 72, bh);
      // Antennen
      if (i % 2 === 0) {
        ctx.fillRect(bx + 30, baseY - bh - 8, 2, 8);
      }
    }
  }

  function drawGround() {
    // Dunkler urbaner Untergrund (Bahnhofs-Area)
    const g = ctx.createLinearGradient(0, HORIZON_Y, 0, H);
    g.addColorStop(0, "#1a1a2a");
    g.addColorStop(1, "#0a0a15");
    ctx.fillStyle = g;
    ctx.fillRect(0, HORIZON_Y, W, H - HORIZON_Y);

    // Seiten-Schienen & Züge (hinter der Hauptstraße!)
    drawSideTrains();

    // Straße / Hauptgleis als Polygon
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
    rg.addColorStop(0, "#3a3a48");
    rg.addColorStop(1, "#1c1c28");
    ctx.fillStyle = rg;
    ctx.fill();

    // Spurtrennlinien (gestrichelte gelbe Linien)
    ctx.strokeStyle = "#ffd86b";
    for (let lane = 1; lane < LANES; lane++) {
      const laneEdge = -1.5 + lane;
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

    // Schienen-Schwellen quer über die Straße
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    for (let i = 0; i < 22; i++) {
      const zA = i / 22 + (linePhase / 60 / 22);
      if (zA > 1) continue;
      const mid = project(zA, 0);
      const left = project(zA, -1.4);
      const right = project(zA, 1.4);
      const thick = Math.max(1, (1 - zA) * 5);
      ctx.fillRect(left.x, mid.y - thick / 2, right.x - left.x, thick);
    }

    // Straßenränder (helle Bordsteine)
    ctx.strokeStyle = "#aab3d0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pNearL.x, pNearL.y);
    ctx.lineTo(pFarL.x,  pFarL.y);
    ctx.moveTo(pNearR.x, pNearR.y);
    ctx.lineTo(pFarR.x,  pFarR.y);
    ctx.stroke();

    // Seitengebäude (Parallax) — weit außen
    drawSideBuildings();
  }

  function drawSideTrains() {
    // Zwei zusätzliche Nebengleise (außerhalb der Spielstraße)
    for (const side of [-1, 1]) {
      // Gleis-Polygon
      const laneOuter = side * 2.2;
      const laneInner = side * 1.6;
      const pNearO = project(0, laneOuter);
      const pNearI = project(0, laneInner);
      const pFarO  = project(1, laneOuter);
      const pFarI  = project(1, laneInner);

      ctx.beginPath();
      ctx.moveTo(pNearI.x, pNearI.y);
      ctx.lineTo(pNearO.x, pNearO.y);
      ctx.lineTo(pFarO.x, pFarO.y);
      ctx.lineTo(pFarI.x, pFarI.y);
      ctx.closePath();
      ctx.fillStyle = "#2a2a38";
      ctx.fill();

      // Schwellen auf dem Nebengleis
      ctx.fillStyle = "#44444e";
      for (let i = 0; i < 18; i++) {
        const z = (i / 18 + (linePhase / 60 / 18)) % 1;
        const a = project(z, laneInner);
        const b = project(z, laneOuter);
        const thick = Math.max(1, (1 - z) * 4);
        ctx.fillRect(Math.min(a.x, b.x), a.y - thick / 2, Math.abs(b.x - a.x), thick);
      }

      // Schienenstrang
      ctx.strokeStyle = "#888";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pNearI.x, pNearI.y);
      ctx.lineTo(pFarI.x, pFarI.y);
      ctx.moveTo(pNearO.x, pNearO.y);
      ctx.lineTo(pFarO.x, pFarO.y);
      ctx.stroke();
    }

    // Seltene Züge, die auf den Nebengleisen entgegen kommen (oder parallel stehen)
    for (const train of sideTrains) {
      drawSideTrain(train);
    }
  }

  function drawSideTrain(train) {
    // train: { side: -1|1, z: 0..1, color: {...}, length: 1..3 }
    const lane = train.side * 1.9;
    // jeder Wagen zeichnen (von hinten nach vorn)
    for (let i = train.length - 1; i >= 0; i--) {
      const z = train.z + i * 0.09;
      if (z > 1 || z < -0.05) continue;
      const p = project(z, lane, 60);
      const s = p.scale;
      if (s <= 0.02) continue;
      const wagonW = 48 * s;
      const wagonH = 80 * s;
      const x = p.x - wagonW / 2;
      const y = p.y - wagonH;
      // Körper
      const g = ctx.createLinearGradient(x, y, x, y + wagonH);
      g.addColorStop(0, train.color.top);
      g.addColorStop(1, train.color.bot);
      ctx.fillStyle = g;
      ctx.fillRect(x, y, wagonW, wagonH);
      // Dach-Streifen
      ctx.fillStyle = train.color.accent;
      ctx.fillRect(x, y, wagonW, 6 * s);
      // Unterer Streifen
      ctx.fillRect(x, y + wagonH - 6 * s, wagonW, 4 * s);
      // Fenster (Reihe)
      ctx.fillStyle = "#9fd8ff";
      const winH = 14 * s;
      const winY = y + 14 * s;
      for (let k = 0; k < 3; k++) {
        ctx.fillRect(x + 4 * s + k * 14 * s, winY, 10 * s, winH);
      }
      // Fenster-Rahmen
      ctx.strokeStyle = "#1a1a2a";
      ctx.lineWidth = Math.max(1, s);
      for (let k = 0; k < 3; k++) {
        ctx.strokeRect(x + 4 * s + k * 14 * s, winY, 10 * s, winH);
      }
      // Türen-Trenner
      ctx.fillStyle = "#1a1a2a";
      ctx.fillRect(x + wagonW / 2 - 1, y + 6 * s, 2, wagonH - 12 * s);
      // Räder
      ctx.fillStyle = "#0a0a15";
      ctx.beginPath();
      ctx.arc(x + 10 * s, y + wagonH - 2 * s, 4 * s, 0, Math.PI * 2);
      ctx.arc(x + wagonW - 10 * s, y + wagonH - 2 * s, 4 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawSideBuildings() {
    // Gebäudereihe ganz außen, dichter als die alten Bäume
    for (let i = 0; i < 18; i++) {
      const zRaw = (i / 18) + (linePhase / 60) / 18 + 0.015;
      const z = zRaw % 1;
      for (const side of [-2.8, 2.8]) {
        const p = project(z, side);
        const s = (1 - z) * 85;
        if (s < 4) continue;
        const bw = s * 0.7;
        const bh = s * (0.9 + ((i * 13) % 5) * 0.12);
        const bx = p.x - bw / 2;
        const by = p.y - bh;
        // Gebäude
        const colors = [["#2a2a4a", "#0a0a1a"], ["#3a1a3a", "#150510"], ["#1a2a5a", "#050a20"]];
        const col = colors[i % colors.length];
        const g = ctx.createLinearGradient(0, by, 0, by + bh);
        g.addColorStop(0, col[0]);
        g.addColorStop(1, col[1]);
        ctx.fillStyle = g;
        ctx.fillRect(bx, by, bw, bh);
        // Fenster
        ctx.fillStyle = "rgba(255,216,107,0.7)";
        const winRows = Math.max(2, Math.floor(bh / (s * 0.1)));
        const winCols = Math.max(2, Math.floor(bw / (s * 0.15)));
        for (let r = 0; r < winRows; r++) {
          for (let k = 0; k < winCols; k++) {
            if (((i * 7 + r * 3 + k * 11) % 4) !== 0) continue;
            const ww = Math.max(1, s * 0.06);
            const wh = Math.max(1, s * 0.05);
            const wx = bx + (k + 0.5) * (bw / winCols) - ww / 2;
            const wy = by + (r + 0.3) * (bh / winRows);
            ctx.fillRect(wx, wy, ww, wh);
          }
        }
        // Kante
        ctx.strokeStyle = "rgba(255,255,255,0.08)";
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, by, bw, bh);
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
      // Niedriger Balken auf Kopfhöhe -> drunter DUCKEN / rutschen
      const postH = 78 * s;        // Pfostenhöhe (Balken sitzt auf Kopfhöhe)
      const barH  = 14 * s;
      // Pfosten
      ctx.fillStyle = "#777";
      ctx.fillRect(p.x - lw / 2,           p.y - postH, 8 * s, postH);
      ctx.fillRect(p.x + lw / 2 - 8 * s,   p.y - postH, 8 * s, postH);
      ctx.fillStyle = "#444";
      ctx.fillRect(p.x - lw / 2 - 2 * s,   p.y - 4 * s, 12 * s, 6 * s);
      ctx.fillRect(p.x + lw / 2 - 10 * s,  p.y - 4 * s, 12 * s, 6 * s);
      // Balken auf Kopfhöhe
      ctx.fillStyle = "#ffd86b";
      ctx.fillRect(p.x - lw / 2, p.y - postH, lw, barH);
      ctx.fillStyle = "#222";
      // Warnstreifen
      for (let i = 0; i < 6; i++) {
        ctx.fillRect(p.x - lw / 2 + i * (lw / 6), p.y - postH + barH / 2 - 2 * s, lw / 12, 4 * s);
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

  function drawPowerup(pu) {
    const p = project(pu.z, LANE_X[pu.lane], 80);
    const s = p.scale;
    if (s <= 0) return;

    if (pu.type === "jetpack") {
      // pulsierender Halo
      const pulse = Math.sin(frame * 0.15) * 0.2 + 1;
      ctx.fillStyle = "rgba(74,255,224,0.2)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 26 * s * pulse, 0, Math.PI * 2);
      ctx.fill();

      // Jetpack-Körper (zwei Tanks)
      const tw = 10 * s, th = 24 * s;
      ctx.fillStyle = "#d94a4a";
      ctx.fillRect(p.x - 12 * s, p.y - th / 2, tw, th);
      ctx.fillRect(p.x + 2 * s, p.y - th / 2, tw, th);
      // Streifen
      ctx.fillStyle = "#fff";
      ctx.fillRect(p.x - 12 * s, p.y - 4 * s, tw, 2 * s);
      ctx.fillRect(p.x + 2 * s, p.y - 4 * s, tw, 2 * s);
      // Rückenplatte
      ctx.fillStyle = "#888";
      ctx.fillRect(p.x - 4 * s, p.y - th / 2, 6 * s, th);
      // Flammen unten
      const flickr = Math.abs(Math.sin(frame * 0.4)) * 3 * s;
      ctx.fillStyle = "#ffd86b";
      ctx.beginPath();
      ctx.moveTo(p.x - 8 * s, p.y + th / 2);
      ctx.lineTo(p.x - 4 * s, p.y + th / 2 + 6 * s + flickr);
      ctx.lineTo(p.x, p.y + th / 2);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(p.x, p.y + th / 2);
      ctx.lineTo(p.x + 4 * s, p.y + th / 2 + 6 * s + flickr);
      ctx.lineTo(p.x + 8 * s, p.y + th / 2);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawPlayer() {
    const p = project(0.05, (player.laneFloat - 1), player.y + 20);
    const s = p.scale * 1.05;
    const w = 50 * s;
    const h = (player.sliding ? 60 : 90) * s;
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

    const skin = getSkin(selectedSkin);
    skin.draw(ctx, x, y, w, h, s, frame, player.sliding);

    // Jetpack am Rücken + Flammen wenn aktiv
    if (player.jetpackTime > 0) {
      // Jetpack-Tanks
      const tx = x - 8 * s;
      const ty = y + h * 0.25;
      const tw = 10 * s, th = 30 * s;
      ctx.fillStyle = "#d94a4a";
      ctx.fillRect(tx, ty, tw * 0.9, th);
      ctx.fillStyle = "#fff";
      ctx.fillRect(tx, ty + th * 0.4, tw * 0.9, 2 * s);
      ctx.fillStyle = "#d94a4a";
      ctx.fillRect(x + w - 2 * s, ty, tw * 0.9, th);
      ctx.fillStyle = "#fff";
      ctx.fillRect(x + w - 2 * s, ty + th * 0.4, tw * 0.9, 2 * s);
      // Flammen unter Tanks
      const flickr = Math.abs(Math.sin(frame * 0.5)) * 8 * s;
      const flameY = ty + th;
      // linke Flamme
      const g1 = ctx.createLinearGradient(0, flameY, 0, flameY + 14 * s + flickr);
      g1.addColorStop(0, "#fff0a0");
      g1.addColorStop(0.3, "#ffd86b");
      g1.addColorStop(1, "#ff3c00");
      ctx.fillStyle = g1;
      ctx.beginPath();
      ctx.moveTo(tx - 2 * s, flameY);
      ctx.lineTo(tx + tw * 0.5, flameY + 14 * s + flickr);
      ctx.lineTo(tx + tw + 1 * s, flameY);
      ctx.closePath();
      ctx.fill();
      // rechte Flamme
      ctx.fillStyle = g1;
      ctx.beginPath();
      ctx.moveTo(x + w - 3 * s, flameY);
      ctx.lineTo(x + w + tw * 0.3, flameY + 14 * s + flickr);
      ctx.lineTo(x + w + tw, flameY);
      ctx.closePath();
      ctx.fill();

      // Timer-Balken über dem Spieler
      const barW = w;
      const barH = 4 * s;
      const pct = player.jetpackTime / JETPACK_DURATION;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(x, y - 10 * s, barW, barH);
      ctx.fillStyle = "#4affe0";
      ctx.fillRect(x, y - 10 * s, barW * pct, barH);
    }

    ctx.globalAlpha = 1;
  }

  // ---------- Skin-Zeichnungen ----------
  // Alle nutzen dieselbe Grundstruktur: Beine, Körper, Arme, Kopf
  // Eigene Details pro Skin.

  function drawSkinBase(c, x, y, w, h, s, f, sliding, col) {
    // Beine (beim Ducken: kurze gebeugte Beine unten)
    c.fillStyle = col.pants;
    if (sliding) {
      c.fillRect(x + 6,        y + h - 14 * s, 14 * s, 14 * s);
      c.fillRect(x + w - 20,   y + h - 14 * s, 14 * s, 14 * s);
    } else {
      const legSwing = Math.sin(f * 0.35) * 6 * s;
      c.fillRect(x + 6,      y + h - 28 * s + legSwing, 14 * s, 28 * s - legSwing);
      c.fillRect(x + w - 20, y + h - 28 * s - legSwing, 14 * s, 28 * s + legSwing);
    }

    // Körper (beim Ducken: etwas nach vorn gebeugt, gestauchter Oberkörper)
    const bodyH = sliding ? 22 * s : h * 0.55;
    const bodyY = sliding ? (y + 18 * s) : (y + 18 * s);
    const bg = c.createLinearGradient(0, bodyY, 0, bodyY + bodyH);
    bg.addColorStop(0, col.body);
    bg.addColorStop(1, col.bodyDark);
    c.fillStyle = bg;
    c.fillRect(x, bodyY, w, bodyH);

    // Arme
    if (sliding) {
      // Arme nach vorn zum Ducken
      c.fillStyle = col.body;
      c.fillRect(x - 4 * s, bodyY + 4 * s, 9 * s, 12 * s);
      c.fillRect(x + w - 5 * s, bodyY + 4 * s, 9 * s, 12 * s);
    } else {
      const armSwing = Math.sin(f * 0.35) * 8 * s;
      c.fillStyle = col.body;
      c.fillRect(x - 6 * s, bodyY + 8 * s - armSwing, 10 * s, bodyH * 0.5);
      c.fillRect(x + w - 4 * s, bodyY + 8 * s + armSwing, 10 * s, bodyH * 0.5);
    }

    return { bodyH, bodyY };
  }

  // Hilfsfunktion: Kopf-Position
  function headPos(x, y, w, s, sliding) {
    return {
      cx: x + w / 2,
      cy: sliding ? (y + 10 * s) : (y + 14 * s),
      r:  sliding ? (11 * s)     : (14 * s),
    };
  }

  // --- Runner (Default) ---
  function drawSkinRunner(c, x, y, w, h, s, f, sliding) {
    const col = getSkin("runner").colors;
    const { bodyY } = drawSkinBase(c, x, y, w, h, s, f, sliding, col);

    // Rucksack
    c.fillStyle = col.accent;
    c.fillRect(x + w * 0.25, bodyY + 4 * s, w * 0.5, sliding ? 14 * s : h * 0.33);

    const { cx, cy, r } = headPos(x, y, w, s, sliding);
    // Haut
    c.fillStyle = "#f1c27d";
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fill();
    // Mütze
    c.fillStyle = col.pants;
    c.beginPath();
    c.arc(cx, cy - 4 * s, r + 1 * s, Math.PI, 0);
    c.fill();
    c.fillRect(cx - (r + 1) * s, cy - 6 * s, 2 * (r + 1) * s, 4 * s);
    // Augen
    c.fillStyle = "#000";
    c.fillRect(cx - 6 * s, cy, 3 * s, 3 * s);
    c.fillRect(cx + 3 * s, cy, 3 * s, 3 * s);
  }

  // --- Ninja ---
  function drawSkinNinja(c, x, y, w, h, s, f, sliding) {
    const col = getSkin("ninja").colors;
    const { bodyY } = drawSkinBase(c, x, y, w, h, s, f, sliding, col);

    // Gürtel
    c.fillStyle = col.accent;
    c.fillRect(x, bodyY + (sliding ? 10 * s : h * 0.22), w, 4 * s);

    const { cx, cy, r } = headPos(x, y, w, s, sliding);
    // Maske
    c.fillStyle = col.body;
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fill();
    // Stirnband
    c.fillStyle = col.accent;
    c.fillRect(cx - r, cy - 3 * s, 2 * r, 4 * s);
    // Stirnband-Ende flattert
    const flap = Math.sin(f * 0.3) * 3 * s;
    c.beginPath();
    c.moveTo(cx + r, cy - 2 * s);
    c.lineTo(cx + r + 10 * s, cy - 4 * s + flap);
    c.lineTo(cx + r + 10 * s, cy + 2 * s + flap);
    c.closePath();
    c.fill();
    // Augen
    c.fillStyle = "#fff";
    c.fillRect(cx - 8 * s, cy + 1 * s, 5 * s, 2 * s);
    c.fillRect(cx + 3 * s, cy + 1 * s, 5 * s, 2 * s);
  }

  // --- Astronaut ---
  function drawSkinAstronaut(c, x, y, w, h, s, f, sliding) {
    const col = getSkin("astro").colors;
    const { bodyY } = drawSkinBase(c, x, y, w, h, s, f, sliding, col);

    // Brust-Panel
    c.fillStyle = col.bodyDark;
    c.fillRect(x + w * 0.3, bodyY + 6 * s, w * 0.4, sliding ? 10 * s : h * 0.22);
    // Knöpfe
    c.fillStyle = col.accent;
    const btnY = sliding ? bodyY + 10 * s : bodyY + 14 * s;
    c.beginPath(); c.arc(x + w * 0.4, btnY, 2 * s, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(x + w * 0.5, btnY, 2 * s, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(x + w * 0.6, btnY, 2 * s, 0, Math.PI * 2); c.fill();

    const { cx, cy, r } = headPos(x, y, w, s, sliding);
    // Helm
    c.fillStyle = col.body;
    c.beginPath();
    c.arc(cx, cy, r + 3 * s, 0, Math.PI * 2);
    c.fill();
    // Visier
    const vg = c.createLinearGradient(cx - 12 * s, cy - 6 * s, cx + 12 * s, cy + 6 * s);
    vg.addColorStop(0, "#2a1a5a");
    vg.addColorStop(0.5, "#4a8aff");
    vg.addColorStop(1, "#ff9a3c");
    c.fillStyle = vg;
    c.beginPath();
    c.ellipse(cx, cy, r, r * 0.75, 0, 0, Math.PI * 2);
    c.fill();
    // Reflex
    c.fillStyle = "rgba(255,255,255,0.6)";
    c.beginPath();
    c.ellipse(cx - 5 * s, cy - 3 * s, 3 * s, 2 * s, 0, 0, Math.PI * 2);
    c.fill();
  }

  // --- Robot ---
  function drawSkinRobot(c, x, y, w, h, s, f, sliding) {
    const col = getSkin("robot").colors;
    const { bodyY, bodyH } = drawSkinBase(c, x, y, w, h, s, f, sliding, col);

    // Panel-Linien
    c.strokeStyle = col.bodyDark;
    c.lineWidth = 2 * s;
    c.strokeRect(x + 4, bodyY + 4 * s, w - 8, bodyH - 8 * s);
    // Reaktor-Kern (glühend)
    const glow = Math.sin(f * 0.15) * 0.3 + 0.7;
    c.fillStyle = col.accent;
    c.globalAlpha = glow;
    c.beginPath();
    c.arc(x + w / 2, bodyY + bodyH * 0.45, 5 * s, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;

    const { cx, cy, r } = headPos(x, y, w, s, sliding);
    const headW = (r + 2) * 2;
    const headH = r * 1.6;
    const hx = cx - headW / 2;
    const hy = cy - headH / 2;
    // Kopf (rechteckig)
    c.fillStyle = col.body;
    c.fillRect(hx, hy, headW, headH);
    c.strokeStyle = col.bodyDark;
    c.strokeRect(hx, hy, headW, headH);
    // Antenne
    c.fillStyle = col.bodyDark;
    c.fillRect(cx - 1 * s, hy - 6 * s, 2 * s, 6 * s);
    c.fillStyle = col.accent;
    c.beginPath();
    c.arc(cx, hy - 6 * s, 2 * s, 0, Math.PI * 2);
    c.fill();
    // LED-Augen
    c.fillStyle = col.accent;
    c.globalAlpha = glow;
    c.fillRect(cx - 9 * s, hy + headH * 0.4, 6 * s, 4 * s);
    c.fillRect(cx + 3 * s, hy + headH * 0.4, 6 * s, 4 * s);
    c.globalAlpha = 1;
  }

  // --- Knight ---
  function drawSkinKnight(c, x, y, w, h, s, f, sliding) {
    const col = getSkin("knight").colors;
    const { bodyY, bodyH } = drawSkinBase(c, x, y, w, h, s, f, sliding, col);

    // Rüstung-Glanz
    const ag = c.createLinearGradient(x, bodyY, x + w, bodyY);
    ag.addColorStop(0, "rgba(255,255,255,0.0)");
    ag.addColorStop(0.5, "rgba(255,255,255,0.35)");
    ag.addColorStop(1, "rgba(255,255,255,0.0)");
    c.fillStyle = ag;
    c.fillRect(x, bodyY, w, bodyH);
    // Wappen
    c.fillStyle = col.accent;
    const wcx = x + w / 2;
    const wcy = bodyY + (sliding ? 8 * s : 16 * s);
    c.beginPath();
    c.moveTo(wcx, wcy - 6 * s);
    c.lineTo(wcx + 7 * s, wcy);
    c.lineTo(wcx, wcy + 8 * s);
    c.lineTo(wcx - 7 * s, wcy);
    c.closePath();
    c.fill();

    const { cx, cy, r } = headPos(x, y, w, s, sliding);
    // Helm
    c.fillStyle = col.body;
    c.beginPath();
    c.arc(cx, cy, r + 1 * s, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = col.bodyDark;
    c.fillRect(cx - (r + 1) * s, cy, 2 * (r + 1) * s, r * 0.85);
    // Visierschlitz
    c.fillStyle = "#000";
    c.fillRect(cx - 9 * s, cy + 2 * s, 18 * s, 3 * s);
    // Federbusch (Plume)
    c.fillStyle = col.accent;
    const plumeWave = Math.sin(f * 0.25) * 2 * s;
    c.beginPath();
    c.moveTo(cx, cy - r);
    c.quadraticCurveTo(cx + 10 * s + plumeWave, cy - r - 10 * s, cx + 14 * s, cy - r + 2 * s);
    c.quadraticCurveTo(cx + 4 * s, cy - r - 2 * s, cx, cy - r + 4 * s);
    c.closePath();
    c.fill();
  }

  // --- Wizard ---
  function drawSkinWizard(c, x, y, w, h, s, f, sliding) {
    const col = getSkin("wizard").colors;
    const { bodyY, bodyH } = drawSkinBase(c, x, y, w, h, s, f, sliding, col);

    // Sterne auf der Robe
    c.fillStyle = col.accent;
    for (const star of [[0.25, 0.2], [0.65, 0.4], [0.4, 0.6]]) {
      const sx = x + w * star[0];
      const sy = bodyY + bodyH * star[1];
      drawStar(c, sx, sy, 3 * s);
    }

    const { cx, cy, r } = headPos(x, y, w, s, sliding);
    // Gesicht
    c.fillStyle = "#f1c27d";
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fill();
    // Bart
    c.fillStyle = "#eee";
    c.beginPath();
    c.moveTo(cx - 9 * s, cy + 2 * s);
    c.quadraticCurveTo(cx, cy + 14 * s, cx + 9 * s, cy + 2 * s);
    c.quadraticCurveTo(cx, cy + 8 * s, cx - 9 * s, cy + 2 * s);
    c.fill();
    // Augen
    c.fillStyle = "#000";
    c.fillRect(cx - 5 * s, cy - 1 * s, 2 * s, 2 * s);
    c.fillRect(cx + 3 * s, cy - 1 * s, 2 * s, 2 * s);
    // Spitzer Hut
    c.fillStyle = col.body;
    const hatBase = cy - r + 2 * s;
    c.beginPath();
    c.moveTo(cx - (r + 2) * s, hatBase);
    c.lineTo(cx + (r + 2) * s, hatBase);
    c.lineTo(cx + 2 * s, hatBase - (sliding ? 14 : 24) * s);
    c.closePath();
    c.fill();
    // Hutband
    c.fillStyle = col.accent;
    c.fillRect(cx - (r + 2) * s, hatBase - 1 * s, 2 * (r + 2) * s, 3 * s);
    // Stern am Hut
    drawStar(c, cx - 4 * s, hatBase - (sliding ? 7 : 12) * s, 3 * s);
  }

  function drawStar(c, cx, cy, r) {
    c.save();
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      const rr = i % 2 === 0 ? r : r * 0.4;
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr;
      if (i === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    }
    c.closePath();
    c.fill();
    c.restore();
  }

  // --- Cyber Punk ---
  function drawSkinCyber(c, x, y, w, h, s, f, sliding) {
    const col = getSkin("cyber").colors;
    const { bodyY, bodyH } = drawSkinBase(c, x, y, w, h, s, f, sliding, col);

    // Neon-Linien auf der Jacke
    const glow = Math.sin(f * 0.2) * 0.3 + 0.7;
    c.strokeStyle = col.accent;
    c.lineWidth = 2 * s;
    c.globalAlpha = glow;
    c.beginPath();
    c.moveTo(x + 4, bodyY + 6 * s);
    c.lineTo(x + w - 4, bodyY + 6 * s);
    c.moveTo(x + w / 2, bodyY + 6 * s);
    c.lineTo(x + w / 2, bodyY + bodyH - 4 * s);
    c.stroke();
    c.globalAlpha = 1;

    const { cx, cy, r } = headPos(x, y, w, s, sliding);
    // Gesicht
    c.fillStyle = "#d8bfa0";
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fill();
    // Mohawk (bunt)
    c.fillStyle = col.accent;
    c.beginPath();
    c.moveTo(cx - 2 * s, cy - r);
    c.lineTo(cx + 2 * s, cy - r - 10 * s);
    c.lineTo(cx + 6 * s, cy - r + 2 * s);
    c.closePath();
    c.fill();
    c.fillStyle = "#4affff";
    c.beginPath();
    c.moveTo(cx - 6 * s, cy - r + 1 * s);
    c.lineTo(cx - 2 * s, cy - r - 8 * s);
    c.lineTo(cx + 1 * s, cy - r);
    c.closePath();
    c.fill();
    // Cyber-Visor (leuchtende Brille)
    c.fillStyle = col.accent;
    c.globalAlpha = glow;
    c.fillRect(cx - 10 * s, cy - 1 * s, 20 * s, 4 * s);
    c.globalAlpha = 1;
    // Mund
    c.fillStyle = "#000";
    c.fillRect(cx - 3 * s, cy + 5 * s, 6 * s, 1 * s);
  }

  // --- Pirate ---
  function drawSkinPirate(c, x, y, w, h, s, f, sliding) {
    const col = getSkin("pirate").colors;
    const { bodyY, bodyH } = drawSkinBase(c, x, y, w, h, s, f, sliding, col);

    // Streifen (Seemanns-Hemd)
    c.fillStyle = "#eee";
    for (let i = 0; i < 4; i++) {
      c.fillRect(x, bodyY + 4 * s + i * 6 * s, w, 3 * s);
    }
    // Gürtel mit Schnalle
    c.fillStyle = "#3a1a00";
    c.fillRect(x, bodyY + bodyH - 6 * s, w, 5 * s);
    c.fillStyle = col.accent;
    c.fillRect(x + w / 2 - 3 * s, bodyY + bodyH - 6 * s, 6 * s, 5 * s);

    const { cx, cy, r } = headPos(x, y, w, s, sliding);
    // Gesicht
    c.fillStyle = "#e0b080";
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fill();
    // Bart
    c.fillStyle = "#2a1a0a";
    c.beginPath();
    c.moveTo(cx - 10 * s, cy + 3 * s);
    c.quadraticCurveTo(cx, cy + 14 * s, cx + 10 * s, cy + 3 * s);
    c.lineTo(cx + 8 * s, cy + 2 * s);
    c.lineTo(cx - 8 * s, cy + 2 * s);
    c.closePath();
    c.fill();
    // Augenklappe
    c.fillStyle = "#000";
    c.fillRect(cx + 2 * s, cy - 2 * s, 8 * s, 6 * s);
    c.strokeStyle = "#000";
    c.lineWidth = 1 * s;
    c.beginPath();
    c.moveTo(cx + 10 * s, cy - 2 * s);
    c.lineTo(cx + 12 * s, cy - 6 * s);
    c.moveTo(cx + 2 * s, cy + 4 * s);
    c.lineTo(cx, cy + 8 * s);
    c.stroke();
    // Auge links
    c.fillStyle = "#000";
    c.fillRect(cx - 6 * s, cy, 2 * s, 2 * s);
    // Bandana
    c.fillStyle = "#c94a4a";
    c.beginPath();
    c.moveTo(cx - (r + 2) * s, cy - r + 2 * s);
    c.lineTo(cx + (r + 2) * s, cy - r + 2 * s);
    c.lineTo(cx + (r + 1) * s, cy - 3 * s);
    c.lineTo(cx - (r + 1) * s, cy - 3 * s);
    c.closePath();
    c.fill();
    // Bandana-Punkte
    c.fillStyle = "#fff";
    c.beginPath(); c.arc(cx - 6 * s, cy - r + 5 * s, 1.5 * s, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(cx + 5 * s, cy - r + 7 * s, 1.5 * s, 0, Math.PI * 2); c.fill();
  }

  // --- Samurai ---
  function drawSkinSamurai(c, x, y, w, h, s, f, sliding) {
    const col = getSkin("samurai").colors;
    const { bodyY, bodyH } = drawSkinBase(c, x, y, w, h, s, f, sliding, col);

    // Schulterpanzer
    c.fillStyle = col.accent;
    c.fillRect(x - 2 * s, bodyY, 10 * s, 8 * s);
    c.fillRect(x + w - 8 * s, bodyY, 10 * s, 8 * s);
    // Kimono-Kragen
    c.fillStyle = "#eee";
    c.beginPath();
    c.moveTo(x + w / 2 - 8 * s, bodyY);
    c.lineTo(x + w / 2, bodyY + 10 * s);
    c.lineTo(x + w / 2 + 8 * s, bodyY);
    c.closePath();
    c.fill();
    // Obi-Gürtel
    c.fillStyle = col.accent;
    c.fillRect(x, bodyY + bodyH - 8 * s, w, 6 * s);
    c.fillStyle = "#000";
    c.fillRect(x, bodyY + bodyH - 9 * s, w, 1 * s);
    c.fillRect(x, bodyY + bodyH - 2 * s, w, 1 * s);

    const { cx, cy, r } = headPos(x, y, w, s, sliding);
    // Gesicht
    c.fillStyle = "#e8c098";
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fill();
    // Kabuto-Helm
    c.fillStyle = col.bodyDark;
    c.beginPath();
    c.arc(cx, cy - 3 * s, r + 2 * s, Math.PI, 0);
    c.fill();
    c.fillRect(cx - (r + 2) * s, cy - 3 * s, 2 * (r + 2) * s, 3 * s);
    // Helm-Horns (crescent)
    c.fillStyle = col.accent;
    c.beginPath();
    c.moveTo(cx - 4 * s, cy - r - 1 * s);
    c.quadraticCurveTo(cx, cy - r - 10 * s, cx + 4 * s, cy - r - 1 * s);
    c.quadraticCurveTo(cx, cy - r - 5 * s, cx - 4 * s, cy - r - 1 * s);
    c.fill();
    // Augen (schmal)
    c.fillStyle = "#000";
    c.fillRect(cx - 7 * s, cy + 1 * s, 4 * s, 1 * s);
    c.fillRect(cx + 3 * s, cy + 1 * s, 4 * s, 1 * s);
    // Schnurrbart
    c.fillRect(cx - 4 * s, cy + 5 * s, 8 * s, 1 * s);
  }

  // --- Jet Pilot (mit eingebautem Mini-Jetpack als Deko) ---
  function drawSkinJetPilot(c, x, y, w, h, s, f, sliding) {
    const col = getSkin("jetpilot").colors;
    const { bodyY, bodyH } = drawSkinBase(c, x, y, w, h, s, f, sliding, col);

    // Brust-Reißverschluss
    c.strokeStyle = col.bodyDark;
    c.lineWidth = 2 * s;
    c.beginPath();
    c.moveTo(x + w / 2, bodyY + 2 * s);
    c.lineTo(x + w / 2, bodyY + bodyH - 4 * s);
    c.stroke();
    // Brustpatch
    c.fillStyle = col.accent;
    c.fillRect(x + w - 14 * s, bodyY + 5 * s, 10 * s, 6 * s);
    c.fillStyle = "#000";
    c.fillRect(x + w - 13 * s, bodyY + 6 * s, 2 * s, 1 * s);
    c.fillRect(x + w - 10 * s, bodyY + 6 * s, 2 * s, 1 * s);
    c.fillRect(x + w - 7 * s, bodyY + 6 * s, 2 * s, 1 * s);
    c.fillRect(x + w - 13 * s, bodyY + 9 * s, 8 * s, 1 * s);

    const { cx, cy, r } = headPos(x, y, w, s, sliding);
    // Gesicht
    c.fillStyle = "#e0b090";
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fill();
    // Pilotenhelm (weiß)
    c.fillStyle = "#eeeef5";
    c.beginPath();
    c.arc(cx, cy - 2 * s, r + 2 * s, Math.PI, 0);
    c.fill();
    c.fillRect(cx - (r + 2) * s, cy - 2 * s, 2 * (r + 2) * s, 3 * s);
    // Visier / Fliegerbrille
    const vg = c.createLinearGradient(cx - r, cy, cx + r, cy);
    vg.addColorStop(0, "#0a2a4a");
    vg.addColorStop(0.5, col.accent);
    vg.addColorStop(1, "#0a2a4a");
    c.fillStyle = vg;
    c.fillRect(cx - (r + 1) * s, cy - 1 * s, 2 * (r + 1) * s, 6 * s);
    c.strokeStyle = "#000";
    c.lineWidth = 1 * s;
    c.strokeRect(cx - (r + 1) * s, cy - 1 * s, 2 * (r + 1) * s, 6 * s);
    // Sauerstoffmaske unten
    c.fillStyle = "#aaa";
    c.fillRect(cx - 5 * s, cy + 6 * s, 10 * s, 4 * s);
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
    for (const pu of powerups) drawables.push({ z: pu.z, kind: "p", obj: pu });
    drawables.sort((a, b) => b.z - a.z);
    for (const d of drawables) {
      if (d.kind === "o") drawObstacle(d.obj);
      else if (d.kind === "c") drawCoin(d.obj);
      else drawPowerup(d.obj);
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
