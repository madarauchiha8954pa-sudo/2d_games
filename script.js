const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Internal logical resolution
const W = 800;
const H = 600;
canvas.width = W;
canvas.height = H;

// UI Elements
const scoreEl = document.getElementById('score-val');
const highEl = document.getElementById('high-val');
const levelEl = document.getElementById('level-val');
const livesEl = document.getElementById('lives-val');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlaySubtitle = document.getElementById('overlay-subtitle');
const startBtn = document.getElementById('start-btn');
const muteBtn = document.getElementById('mute-btn');
const pauseBtn = document.getElementById('pause-btn');

// --- Web Audio Synthesizer (Zero External Files) ---
class SoundFX {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }
  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
  }
  play(freq, type = 'sine', duration = 0.1, vol = 0.15, slide = 0) {
    if (this.muted) return;
    this.init();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    if (slide) {
      osc.frequency.exponentialRampToValueAtTime(slide, this.ctx.currentTime + duration);
    }
    gain.gain.setValueAtTime(vol, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }
  paddle() { this.play(320, 'triangle', 0.08, 0.2, 480); }
  wall()   { this.play(220, 'sine', 0.06, 0.12); }
  brick(combo) { this.play(380 + combo * 35, 'sine', 0.1, 0.16, 520 + combo * 35); }
  laser()  { this.play(880, 'sawtooth', 0.09, 0.1, 240); }
  power()  { this.play(500, 'sine', 0.25, 0.2, 950); }
  lose()   { this.play(240, 'sawtooth', 0.35, 0.2, 70); }
  win()    { this.play(440, 'triangle', 0.4, 0.2, 880); }
}
const sfx = new SoundFX();

// --- Game State ---
let score = 0;
let highScore = Number(localStorage.getItem('neonBreakerHigh')) || 0;
let level = 1;
let lives = 3;
let combo = 0;
let gameState = 'MENU'; // MENU, PLAYING, PAUSED, GAMEOVER
let shakeTime = 0;

highEl.textContent = highScore;

// --- Entities ---
const paddle = {
  w: 120,
  baseW: 120,
  h: 14,
  x: W / 2 - 60,
  y: H - 36,
  speed: 9,
  wideTimer: 0,
  laserTimer: 0,
  laserCooldown: 0
};

let balls = [];
let bricks = [];
let particles = [];
let powerUps = [];
let lasers = [];

const BRICK_COLORS = [
  { fill: '#f43f5e', glow: 'rgba(244, 63, 94, 0.6)' },
  { fill: '#f97316', glow: 'rgba(249, 115, 22, 0.6)' },
  { fill: '#facc15', glow: 'rgba(250, 204, 21, 0.6)' },
  { fill: '#4ade80', glow: 'rgba(74, 222, 128, 0.6)' },
  { fill: '#38bdf8', glow: 'rgba(56, 189, 248, 0.6)' },
  { fill: '#c084fc', glow: 'rgba(192, 132, 252, 0.6)' }
];

// --- Input Tracking ---
const keys = { left: false, right: false };

window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = true;
  if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = true;
  if (e.key === ' ') {
    e.preventDefault();
    if (gameState === 'PLAYING') handleAction();
  }
  if (e.key === 'p' || e.key === 'P') togglePause();
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = false;
  if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = false;
});

function movePaddleToClientX(clientX) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = W / rect.width;
  const targetX = (clientX - rect.left) * scaleX - paddle.w / 2;
  paddle.x = Math.max(8, Math.min(W - paddle.w - 8, targetX));
}

canvas.addEventListener('mousemove', (e) => {
  if (gameState === 'PLAYING') movePaddleToClientX(e.clientX);
});

canvas.addEventListener('touchmove', (e) => {
  if (gameState === 'PLAYING' && e.touches.length > 0) {
    e.preventDefault();
    movePaddleToClientX(e.touches[0].clientX);
  }
}, { passive: false });

canvas.addEventListener('mousedown', () => {
  if (gameState === 'PLAYING') handleAction();
});

canvas.addEventListener('touchstart', (e) => {
  if (gameState === 'PLAYING') {
    if (e.touches.length > 0) movePaddleToClientX(e.touches[0].clientX);
    handleAction();
  }
});

// --- Setup & Spawning ---
function createBall(x, y, stuck = false) {
  const speed = 5.4 + Math.min(level * 0.35, 3);
  const angle = -Math.PI / 2 + (Math.random() * 0.6 - 0.3);
  return {
    x,
    y,
    r: 8,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    speed,
    stuck,
    trail: []
  };
}

function resetPaddleAndBall() {
  paddle.w = paddle.baseW;
  paddle.x = W / 2 - paddle.w / 2;
  paddle.wideTimer = 0;
  paddle.laserTimer = 0;
  balls = [createBall(W / 2, paddle.y - 10, true)];
  lasers = [];
  powerUps = [];
  combo = 0;
}

function buildLevel(lvl) {
  bricks = [];
  const rows = Math.min(4 + lvl, 8);
  const cols = 10;
  const pad = 8;
  const marginX = 34;
  const marginTop = 55;
  const brickW = (W - marginX * 2 - pad * (cols - 1)) / cols;
  const brickH = 22;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Pattern gaps on higher levels
      if (lvl > 1 && (r + c + lvl) % 7 === 0) continue;

      const maxHp = lvl >= 3 && r < 2 ? 2 : 1;
      const colorObj = BRICK_COLORS[r % BRICK_COLORS.length];
      bricks.push({
        x: marginX + c * (brickW + pad),
        y: marginTop + r * (brickH + pad),
        w: brickW,
        h: brickH,
        hp: maxHp,
        maxHp,
        color: colorObj.fill,
        glow: colorObj.glow
      });
    }
  }
}

function spawnParticles(x, y, color, count = 14) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const spd = 1.5 + Math.random() * 4;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd,
      size: 2 + Math.random() * 3,
      alpha: 1,
      color
    });
  }
}

function maybeSpawnPowerUp(x, y) {
  if (Math.random() > 0.22) return;
  const types = [
    { type: 'WIDE', label: 'W', color: '#38bdf8' },
    { type: 'MULTI', label: 'M', color: '#e879f9' },
    { type: 'LASER', label: 'L', color: '#facc15' },
    { type: 'LIFE', label: '+1', color: '#4ade80' }
  ];
  const pick = types[Math.floor(Math.random() * types.length)];
  powerUps.push({ x, y, w: 28, h: 16, vy: 2.8, ...pick });
}

function handleAction() {
  // Launch stuck balls
  let launched = false;
  balls.forEach((b) => {
    if (b.stuck) {
      b.stuck = false;
      launched = true;
    }
  });
  if (launched) {
    sfx.paddle();
    return;
  }

  // Fire lasers if active
  if (paddle.laserTimer > 0 && paddle.laserCooldown <= 0) {
    lasers.push({ x: paddle.x + 10, y: paddle.y - 8, w: 4, h: 14, vy: -10 });
    lasers.push({ x: paddle.x + paddle.w - 14, y: paddle.y - 8, w: 4, h: 14, vy: -10 });
    paddle.laserCooldown = 18;
    sfx.laser();
  }
}

function applyPowerUp(p) {
  sfx.power();
  addScore(50);
  if (p.type === 'WIDE') {
    paddle.wideTimer = 600;
    paddle.w = 175;
  } else if (p.type === 'LASER') {
    paddle.laserTimer = 600;
  } else if (p.type === 'LIFE') {
    lives = Math.min(lives + 1, 5);
    updateHUD();
  } else if (p.type === 'MULTI') {
    const active = balls[0] || createBall(paddle.x + paddle.w / 2, paddle.y - 12, false);
    balls.push(createBall(active.x, active.y, false));
    balls.push(createBall(active.x, active.y, false));
  }
}

function addScore(pts) {
  score += pts;
  if (score > highScore) {
    highScore = score;
    localStorage.setItem('neonBreakerHigh', highScore);
  }
  updateHUD();
}

function updateHUD() {
  scoreEl.textContent = score;
  highEl.textContent = highScore;
  levelEl.textContent = level;
  livesEl.textContent = lives;
}

// --- Main Update Loop ---
function update() {
  if (gameState !== 'PLAYING') return;

  if (shakeTime > 0) shakeTime--;
  if (paddle.laserCooldown > 0) paddle.laserCooldown--;

  // Power-up timers
  if (paddle.wideTimer > 0) {
    paddle.wideTimer--;
    if (paddle.wideTimer === 0) paddle.w = paddle.baseW;
  }
  if (paddle.laserTimer > 0) paddle.laserTimer--;

  // Keyboard paddle movement
  if (keys.left) paddle.x = Math.max(8, paddle.x - paddle.speed);
  if (keys.right) paddle.x = Math.min(W - paddle.w - 8, paddle.x + paddle.speed);

  // Update Lasers
  for (let i = lasers.length - 1; i >= 0; i--) {
    const l = lasers[i];
    l.y += l.vy;
    if (l.y < 0) {
      lasers.splice(i, 1);
      continue;
    }
    for (let j = bricks.length - 1; j >= 0; j--) {
      const br = bricks[j];
      if (l.x < br.x + br.w && l.x + l.w > br.x && l.y < br.y + br.h && l.y + l.h > br.y) {
        lasers.splice(i, 1);
        damageBrick(j);
        break;
      }
    }
  }

  // Update Balls
  for (let i = balls.length - 1; i >= 0; i--) {
    const b = balls[i];

    if (b.stuck) {
      b.x = paddle.x + paddle.w / 2;
      b.y = paddle.y - b.r - 1;
      continue;
    }

    b.trail.push({ x: b.x, y: b.y });
    if (b.trail.length > 8) b.trail.shift();

    b.x += b.vx;
    b.y += b.vy;

    // Wall bounces
    if (b.x - b.r < 6) { b.x = 6 + b.r; b.vx *= -1; sfx.wall(); }
    if (b.x + b.r > W - 6) { b.x = W - 6 - b.r; b.vx *= -1; sfx.wall(); }
    if (b.y - b.r < 6) { b.y = 6 + b.r; b.vy *= -1; sfx.wall(); }

    // Paddle bounce
    if (
      b.vy > 0 &&
      b.y + b.r >= paddle.y &&
      b.y - b.r <= paddle.y + paddle.h &&
      b.x >= paddle.x - 4 &&
      b.x <= paddle.x + paddle.w + 4
    ) {
      const hitPos = (b.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
      const bounceAngle = hitPos * (Math.PI / 3); // Max 60 deg
      b.vx = Math.sin(bounceAngle) * b.speed;
      b.vy = -Math.cos(bounceAngle) * b.speed;
      b.y = paddle.y - b.r;
      combo = 0;
      sfx.paddle();
    }

    // Brick collisions
    for (let j = bricks.length - 1; j >= 0; j--) {
      const br = bricks[j];
      const closestX = Math.max(br.x, Math.min(b.x, br.x + br.w));
      const closestY = Math.max(br.y, Math.min(b.y, br.y + br.h));
      const dx = b.x - closestX;
      const dy = b.y - closestY;

      if (dx * dx + dy * dy < b.r * b.r) {
        if (Math.abs(dx) > Math.abs(dy)) b.vx *= -1;
        else b.vy *= -1;
        damageBrick(j);
        break;
      }
    }

    // Bottom out
    if (b.y - b.r > H) {
      balls.splice(i, 1);
    }
  }

  // Check lost life
  if (balls.length === 0) {
    lives--;
    shakeTime = 12;
    sfx.lose();
    updateHUD();
    if (lives <= 0) {
      endGame(false);
    } else {
      resetPaddleAndBall();
    }
  }

  // Update Power-Ups
  for (let i = powerUps.length - 1; i >= 0; i--) {
    const p = powerUps[i];
    p.y += p.vy;
    if (
      p.x + p.w / 2 >= paddle.x &&
      p.x - p.w / 2 <= paddle.x + paddle.w &&
      p.y + p.h / 2 >= paddle.y &&
      p.y - p.h / 2 <= paddle.y + paddle.h
    ) {
      applyPowerUp(p);
      powerUps.splice(i, 1);
    } else if (p.y > H + 20) {
      powerUps.splice(i, 1);
    }
  }

  // Update Particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const pt = particles[i];
    pt.x += pt.vx;
    pt.y += pt.vy;
    pt.alpha -= 0.025;
    if (pt.alpha <= 0) particles.splice(i, 1);
  }

  // Check Level Clear
  if (bricks.length === 0) {
    sfx.win();
    level++;
    addScore(250);
    buildLevel(level);
    resetPaddleAndBall();
    updateHUD();
  }
}

function damageBrick(index) {
  const br = bricks[index];
  br.hp--;
  combo++;
  sfx.brick(combo);
  spawnParticles(br.x + br.w / 2, br.y + br.h / 2, br.color, br.hp <= 0 ? 16 : 6);

  if (br.hp <= 0) {
    addScore(10 * Math.min(combo, 8));
    maybeSpawnPowerUp(br.x + br.w / 2, br.y + br.h / 2);
    bricks.splice(index, 1);
    shakeTime = 4;
  } else {
    br.color = '#94a3b8'; // Damaged armor tint
  }
}

// --- Render Loop ---
function draw() {
  ctx.save();
  ctx.clearRect(0, 0, W, H);

  // Subtle screen shake
  if (shakeTime > 0) {
    const mag = shakeTime * 0.5;
    ctx.translate((Math.random() - 0.5) * mag, (Math.random() - 0.5) * mag);
  }

  // Subtle Grid Background
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.04)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // Draw Bricks
  bricks.forEach((br) => {
    ctx.save();
    ctx.fillStyle = br.color;
    ctx.shadowColor = br.glow;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.roundRect(br.x, br.y, br.w, br.h, 5);
    ctx.fill();

    // Armor border for 2-HP bricks
    if (br.hp > 1) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  });

  // Draw Paddle
  ctx.save();
  ctx.fillStyle = paddle.laserTimer > 0 ? '#facc15' : '#38bdf8';
  ctx.shadowColor = paddle.laserTimer > 0 ? '#facc15' : '#38bdf8';
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.roundRect(paddle.x, paddle.y, paddle.w, paddle.h, 7);
  ctx.fill();

  // Laser turrets indicator
  if (paddle.laserTimer > 0) {
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(paddle.x + 8, paddle.y - 5, 6, 5);
    ctx.fillRect(paddle.x + paddle.w - 14, paddle.y - 5, 6, 5);
  }
  ctx.restore();

  // Draw Lasers
  ctx.save();
  ctx.fillStyle = '#facc15';
  ctx.shadowColor = '#facc15';
  ctx.shadowBlur = 10;
  lasers.forEach((l) => ctx.fillRect(l.x, l.y, l.w, l.h));
  ctx.restore();

  // Draw Power-Ups
  powerUps.forEach((p) => {
    ctx.save();
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.roundRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h, 6);
    ctx.fill();

    ctx.fillStyle = '#05070e';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.label, p.x, p.y + 1);
    ctx.restore();
  });

  // Draw Balls & Trails
  balls.forEach((b) => {
    b.trail.forEach((t, idx) => {
      const ratio = (idx + 1) / b.trail.length;
      ctx.beginPath();
      ctx.arc(t.x, t.y, b.r * ratio * 0.8, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(232, 121, 249, ${ratio * 0.3})`;
      ctx.fill();
    });

    ctx.save();
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#e879f9';
    ctx.shadowBlur = 14;
    ctx.fill();
    ctx.restore();
  });

  // Draw Particles
  particles.forEach((pt) => {
    ctx.save();
    ctx.globalAlpha = pt.alpha;
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x, pt.y, pt.size, pt.size);
    ctx.restore();
  });

  ctx.restore();
}

function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

// --- Game Flow Controls ---
function startGame() {
  sfx.init();
  score = 0;
  level = 1;
  lives = 3;
  updateHUD();
  buildLevel(level);
  resetPaddleAndBall();
  gameState = 'PLAYING';
  overlay.classList.remove('active');
}

function endGame() {
  gameState = 'GAMEOVER';
  overlayTitle.textContent = 'SYSTEM OFFLINE';
  overlaySubtitle.textContent = `Final Score: ${score}  •  High Score: ${highScore}`;
  startBtn.textContent = 'PLAY AGAIN';
  overlay.classList.add('active');
}

function togglePause() {
  if (gameState === 'PLAYING') {
    gameState = 'PAUSED';
    overlayTitle.textContent = 'PAUSED';
    overlaySubtitle.textContent = 'Take a breather.';
    startBtn.textContent = 'RESUME';
    overlay.classList.add('active');
  } else if (gameState === 'PAUSED') {
    gameState = 'PLAYING';
    overlay.classList.remove('active');
  }
}

startBtn.addEventListener('click', () => {
  if (gameState === 'PAUSED') togglePause();
  else startGame();
});

pauseBtn.addEventListener('click', togglePause);

muteBtn.addEventListener('click', () => {
  sfx.muted = !sfx.muted;
  muteBtn.textContent = sfx.muted ? '🔇' : '🔊';
});

// Start render loop
buildLevel(1);
resetPaddleAndBall();
loop();
