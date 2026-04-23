import { CLASS_MAP } from './config.js';
import { state } from './state.js';

const PATTERN     = ['Kick', 'Hihat', 'Snare', 'Hihat'];
const SOUND_COLOR = { Kick: '#00ff9d', Hihat: '#ffe600', Snare: '#9b5de5' };
const SOUND_SYM   = { Kick: 'B', Hihat: 't', Snare: 'K' };

const SCORE_TIERS = [
  { label: 'PERFECT!',   maxPx: 12,  color: '#ffffff', points: 10 },
  { label: 'EXCELLENT!', maxPx: 30,  color: '#00ff9d', points: 8  },
  { label: 'GREAT!',     maxPx: 55,  color: '#ffe600', points: 6  },
  { label: 'GOOD!',      maxPx: 80,  color: '#ffe600', points: 4  },
  { label: 'NOT BAD!',   maxPx: 110, color: '#888899', points: 2  },
];
let MISS_THRESHOLD = 110;

function freshStats() {
  return { Kick: {hit:0, miss:0}, Hihat: {hit:0, miss:0}, Snare: {hit:0, miss:0} };
}

const game = {
  boxes: [],
  patternIdx: 0,
  bpm: 80,
  speed: 0,
  spacing: 280,
  totalScore: 0,
  judgeX: 0,
  trackY: 0,
  judgeY: 0,
  trackX: 0,
  vertical: false,
  boxSize: 70,
  cssW: 0,
  cssH: 0,
  rafId: null,
  lastTime: null,
  lastSoundTs: 0,
  verdict: null,
  latencyOffsetMs: 0,
  cooldownMs: 400,
  mode: 'infinite',
  phase: 'playing',
  gameDuration: 30,
  timeRemaining: 30,
  countdownVal: 3,
  stats: freshStats(),
};

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function spawnBox(pos) {
  const label = PATTERN[game.patternIdx % PATTERN.length];
  game.patternIdx = (game.patternIdx + 1) % PATTERN.length;
  if (game.vertical) {
    game.boxes.push({ label, x: game.trackX, y: pos, scored: false, missed: false });
  } else {
    game.boxes.push({ label, x: pos, y: game.trackY, scored: false, missed: false });
  }
}

function initGame() {
  const canvas = document.getElementById('game-canvas');
  const dpr  = window.devicePixelRatio || 1;
  const cssW = window.innerWidth;
  const cssH = window.innerHeight;
  canvas.width  = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.getContext('2d').scale(dpr, dpr);
  game.cssW = cssW;
  game.cssH = cssH;
  game.boxes = [];
  game.patternIdx = 0;
  game.lastTime   = null;
  game.lastSoundTs = 0;
  game.verdict    = null;
  game.totalScore = 0;

  const mobile = cssW < 600;
  game.vertical = mobile;

  if (game.vertical) {
    game.boxSize = 52;
    game.spacing = 170;
    game.speed   = game.spacing * game.bpm / 60;
    game.trackX  = Math.round(cssW / 2);
    game.judgeY  = Math.round(cssH * 0.65);
    for (let i = 0; i < 8; i++) spawnBox(-game.boxSize / 2 - i * game.spacing);
  } else {
    game.boxSize = 70;
    game.spacing = 240;
    game.speed   = game.spacing * game.bpm / 60;
    game.judgeX  = Math.round(cssW * 0.28);
    game.trackY  = Math.round(cssH * 0.5);
    for (let i = 0; i < 8; i++) spawnBox(cssW + game.boxSize / 2 + i * game.spacing);
  }
}

function handleSoundInput(soundLabel, onsetTs) {
  const elapsedMs  = Date.now() - (onsetTs || Date.now());
  const latencyPx  = ((elapsedMs + game.latencyOffsetMs) / 1000) * game.speed;
  let closest = null, minDist = Infinity;
  for (const box of game.boxes) {
    if (box.scored || box.missed) continue;
    let d;
    if (game.vertical) {
      const compensatedY = box.y - latencyPx;
      d = Math.abs(compensatedY - game.judgeY);
    } else {
      const compensatedX = box.x + latencyPx;
      d = Math.abs(compensatedX - game.judgeX);
    }
    if (d < minDist) { minDist = d; closest = box; }
  }
  if (!closest || minDist > MISS_THRESHOLD) return;
  if (closest.label !== soundLabel) return;
  const tier = SCORE_TIERS.find(t => minDist <= t.maxPx);
  if (tier) {
    closest.scored = true;
    game.totalScore += tier.points;
    if (game.stats[closest.label]) game.stats[closest.label].hit++;
    updateScoreDisplay();
    game.verdict = { text: tier.label, color: tier.color, expiresAt: Date.now() + 750 };
  }
}

function drawGame(canvas) {
  const ctx = canvas.getContext('2d');
  const W = game.cssW, H = game.cssH;
  const bs = game.boxSize;
  ctx.clearRect(0, 0, W, H);

  if (game.vertical) {
    // Vertical (mobile): boxes flow top → bottom
    ctx.strokeStyle = 'rgba(100,140,255,0.35)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 10]);
    ctx.beginPath();
    ctx.moveTo(game.trackX, 0);
    ctx.lineTo(game.trackX, H);
    ctx.stroke();
    ctx.setLineDash([]);

    const hbW = bs * 1.8;
    ctx.fillStyle = 'rgba(255,60,110,0.08)';
    ctx.fillRect(game.trackX - hbW / 2, game.judgeY - MISS_THRESHOLD, hbW, MISS_THRESHOLD * 2);
    ctx.strokeStyle = 'rgba(255,60,110,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.strokeRect(game.trackX - hbW / 2, game.judgeY - MISS_THRESHOLD, hbW, MISS_THRESHOLD * 2);
    ctx.setLineDash([]);

    ctx.strokeStyle = '#ff3c6e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, game.judgeY);
    ctx.lineTo(W, game.judgeY);
    ctx.stroke();

    for (const box of game.boxes) {
      const col = SOUND_COLOR[box.label] || '#ffffff';
      const sym = SOUND_SYM[box.label]   || box.label;
      ctx.globalAlpha = (box.scored || box.missed) ? 0.18 : 1;
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.strokeRect(game.trackX - bs / 2, box.y - bs / 2, bs, bs);
      ctx.fillStyle = col;
      ctx.font = `bold ${Math.round(bs * 0.55)}px 'Share Tech Mono', monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sym, game.trackX, box.y);
      ctx.globalAlpha = 1;
    }

    if (game.verdict && Date.now() < game.verdict.expiresAt) {
      const t = (game.verdict.expiresAt - Date.now()) / 750;
      ctx.globalAlpha = Math.min(1, t * 4);
      ctx.fillStyle = game.verdict.color;
      const verdictSize = clamp(Math.round(W * 0.09), 18, 30);
      ctx.font = `bold ${verdictSize}px 'Black Ops One', cursive`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(game.verdict.text, W / 2, game.judgeY - bs * 0.9);
      ctx.globalAlpha = 1;
    }

  } else {
    // Horizontal (desktop): boxes flow right → left
    ctx.strokeStyle = 'rgba(100,140,255,0.35)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 10]);
    ctx.beginPath();
    ctx.moveTo(0, game.trackY);
    ctx.lineTo(W, game.trackY);
    ctx.stroke();
    ctx.setLineDash([]);

    const hbH = bs * 1.2;
    ctx.fillStyle = 'rgba(255,60,110,0.08)';
    ctx.fillRect(game.judgeX - MISS_THRESHOLD, game.trackY - hbH / 2, MISS_THRESHOLD * 2, hbH);
    ctx.strokeStyle = 'rgba(255,60,110,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.strokeRect(game.judgeX - MISS_THRESHOLD, game.trackY - hbH / 2, MISS_THRESHOLD * 2, hbH);
    ctx.setLineDash([]);

    ctx.strokeStyle = '#ff3c6e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(game.judgeX, game.trackY - H * 0.4);
    ctx.lineTo(game.judgeX, game.trackY + H * 0.4);
    ctx.stroke();

    for (const box of game.boxes) {
      const col = SOUND_COLOR[box.label] || '#ffffff';
      const sym = SOUND_SYM[box.label]   || box.label;
      ctx.globalAlpha = (box.scored || box.missed) ? 0.18 : 1;
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.strokeRect(box.x - bs / 2, game.trackY - bs / 2, bs, bs);
      ctx.fillStyle = col;
      ctx.font = `bold ${Math.round(bs * 0.55)}px 'Share Tech Mono', monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sym, box.x, game.trackY);
      ctx.globalAlpha = 1;
    }

    if (game.verdict && Date.now() < game.verdict.expiresAt) {
      const t = (game.verdict.expiresAt - Date.now()) / 750;
      ctx.globalAlpha = Math.min(1, t * 4);
      ctx.fillStyle = game.verdict.color;
      const verdictSize = clamp(Math.round(H * 0.06), 28, 60);
      ctx.font = `bold ${verdictSize}px 'Black Ops One', cursive`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(game.verdict.text, game.judgeX, game.trackY - bs * 0.75);
      ctx.globalAlpha = 1;
    }
  }

  // Timer (top-right)
  if (game.mode === 'timed' && game.phase === 'timed-playing') {
    const secs = Math.ceil(game.timeRemaining);
    ctx.fillStyle = secs <= 5 ? '#ff3c6e' : '#ffffff';
    ctx.font = `bold ${clamp(Math.round(H * 0.055), 24, 52)}px 'Share Tech Mono', monospace`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(secs + 's', W - 24, 20);
    ctx.textBaseline = 'alphabetic';
  }

  // Countdown overlay
  if (game.mode === 'timed' && game.phase === 'countdown') {
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, 0, W, H);
    const label = game.countdownVal === 0 ? 'GO!' : String(game.countdownVal);
    ctx.fillStyle = game.countdownVal === 0 ? '#00ff9d' : '#ffffff';
    ctx.font = `bold ${clamp(Math.round(H * 0.28), 80, 220)}px 'Share Tech Mono', monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, W / 2, H / 2);
    ctx.textBaseline = 'alphabetic';
  }
}

function setEl(id, val) { const e = document.getElementById(id); if (e) e.textContent = val; }

export function adjustLatency(delta) {
  game.latencyOffsetMs = Math.max(0, Math.min(800, game.latencyOffsetMs + delta));
  setEl('latency-display', game.latencyOffsetMs + 'ms');
  setEl('modal-latency-display', game.latencyOffsetMs + 'ms');
}

export function adjustBPM(delta) {
  game.bpm = Math.max(40, Math.min(200, game.bpm + delta));
  game.speed = game.spacing * game.bpm / 60;
  setEl('bpm-display', game.bpm + ' BPM');
  setEl('modal-bpm-display', game.bpm + ' BPM');
}

export function adjustCooldown(delta) {
  game.cooldownMs = Math.max(50, Math.min(800, game.cooldownMs + delta));
  setEl('cooldown-display', game.cooldownMs + 'ms');
  setEl('modal-cooldown-display', game.cooldownMs + 'ms');
  if (state.workletNode) state.workletNode.port.postMessage({ type: 'set_cooldown', seconds: game.cooldownMs / 1000 });
}

export function adjustHitbox(delta) {
  MISS_THRESHOLD = Math.max(40, Math.min(300, MISS_THRESHOLD + delta));
  const ratio = MISS_THRESHOLD / 110;
  SCORE_TIERS[0].maxPx = Math.round(30  * ratio);
  SCORE_TIERS[1].maxPx = Math.round(55  * ratio);
  SCORE_TIERS[2].maxPx = Math.round(80  * ratio);
  SCORE_TIERS[3].maxPx = Math.round(110 * ratio);
  setEl('hitbox-display', MISS_THRESHOLD + 'px');
  setEl('modal-hitbox-display', MISS_THRESHOLD + 'px');
}

export function syncParamModal() {
  setEl('modal-bpm-display', game.bpm + ' BPM');
  setEl('modal-latency-display', game.latencyOffsetMs + 'ms');
  setEl('modal-hitbox-display', MISS_THRESHOLD + 'px');
  setEl('modal-cooldown-display', game.cooldownMs + 'ms');
}

function updateScoreDisplay() {
  document.getElementById('score-value').textContent = game.totalScore;
}

function updateHUD() {
  const age   = Date.now() - state.lastDetection.ts;
  const fresh = state.lastDetection.label && age < 600;
  document.getElementById('hud-symbol').textContent = fresh
    ? (CLASS_MAP[state.lastDetection.label]?.symbol ?? '—') : '—';
  document.getElementById('hud-label').textContent = fresh
    ? `${CLASS_MAP[state.lastDetection.label]?.name ?? state.lastDetection.label} · ${state.lastScore}%`
    : 'listening…';
}

function gameLoop(ts) {
  if (!state.isListening) return;
  game.rafId = requestAnimationFrame(gameLoop);

  if (game.lastTime === null) game.lastTime = ts;
  const dt = Math.min((ts - game.lastTime) / 1000, 0.1);
  game.lastTime = ts;

  const canvas = document.getElementById('game-canvas');
  const active = game.mode === 'infinite' || game.phase === 'timed-playing';

  if (active) {
    if (game.mode === 'timed') {
      game.timeRemaining = Math.max(0, game.timeRemaining - dt);
      if (game.timeRemaining === 0) { endGame(); return; }
    }

    const latencyPx = (game.latencyOffsetMs / 1000) * game.speed;
    if (game.vertical) {
      for (const box of game.boxes) box.y += game.speed * dt;
    } else {
      for (const box of game.boxes) box.x -= game.speed * dt;
    }

    if (state.lastDetection.ts > game.lastSoundTs) {
      game.lastSoundTs = state.lastDetection.ts;
      handleSoundInput(state.lastDetection.label, state.lastDetection.onsetTs);
    }

    if (game.vertical) {
      for (const box of game.boxes) {
        if (!box.scored && !box.missed && box.y > game.judgeY + MISS_THRESHOLD + latencyPx) {
          box.missed = true;
          if (game.stats[box.label]) game.stats[box.label].miss++;
          game.verdict = { text: 'MISSED!', color: '#ff3c6e', expiresAt: Date.now() + 750 };
        }
      }
      while (game.boxes.length && game.boxes[0].y > game.cssH + game.boxSize * 2) game.boxes.shift();
    } else {
      for (const box of game.boxes) {
        if (!box.scored && !box.missed && box.x < game.judgeX - MISS_THRESHOLD - latencyPx) {
          box.missed = true;
          if (game.stats[box.label]) game.stats[box.label].miss++;
          game.verdict = { text: 'MISSED!', color: '#ff3c6e', expiresAt: Date.now() + 750 };
        }
      }
      while (game.boxes.length && game.boxes[0].x < -game.boxSize * 2) game.boxes.shift();
    }

    if (game.mode === 'infinite' || game.timeRemaining > 0) {
      if (game.vertical) {
        const topmost = game.boxes.length ? game.boxes[game.boxes.length - 1].y : 0;
        if (topmost > -game.boxSize / 2) spawnBox(topmost - game.spacing);
      } else {
        const rightmost = game.boxes.length ? game.boxes[game.boxes.length - 1].x : 0;
        if (rightmost < game.cssW + game.boxSize / 2) spawnBox(rightmost + game.spacing);
      }
    }
  }

  drawGame(canvas);
  updateHUD();
}

export function startGame() {
  initGame();
  document.getElementById('game-view').style.display = 'block';
  document.querySelector('.wrapper').style.display = 'none';
  game.rafId = requestAnimationFrame(gameLoop);
}

export function stopGame() {
  if (game.rafId) { cancelAnimationFrame(game.rafId); game.rafId = null; }
  document.getElementById('game-view').style.display = 'none';
  document.querySelector('.wrapper').style.display = 'flex';
}

export function restartGame() {
  if (game.rafId) { cancelAnimationFrame(game.rafId); game.rafId = null; }
  document.getElementById('report-overlay').style.display = 'none';
  state.lastDetection = { label: null, ts: 0, onsetTs: 0 };
  state.lastScore = 0;

  if (game.mode === 'timed') {
    game.stats = freshStats();
    game.totalScore = 0;
    updateScoreDisplay();
    game.phase = 'setup';
    initGame();
    syncParamModal();
    document.getElementById('param-modal').style.display = 'flex';
    game.rafId = requestAnimationFrame(gameLoop);
  } else {
    initGame();
    updateScoreDisplay();
    game.rafId = requestAnimationFrame(gameLoop);
  }
}

export function startTimedGame() {
  document.getElementById('param-modal').style.display = 'none';
  game.stats = freshStats();
  game.totalScore = 0;
  updateScoreDisplay();
  state.lastDetection = { label: null, ts: 0, onsetTs: 0 };
  state.lastScore = 0;
  initGame();
  if (game.rafId) { cancelAnimationFrame(game.rafId); game.rafId = null; }
  game.rafId = requestAnimationFrame(gameLoop);
  startCountdown();
}

export function startCountdown() {
  game.phase = 'countdown';
  game.countdownVal = 3;
  game.boxes = [];
  game.lastTime = null;
  const tick = () => {
    game.countdownVal--;
    if (game.countdownVal < 0) {
      game.phase = 'timed-playing';
      game.timeRemaining = game.gameDuration;
      game.lastTime = null;
      game.boxes = [];
      game.patternIdx = 0;
      if (game.vertical) {
        for (let i = 0; i < 8; i++) spawnBox(-game.boxSize / 2 - i * game.spacing);
      } else {
        for (let i = 0; i < 8; i++) spawnBox(game.cssW + game.boxSize / 2 + i * game.spacing);
      }
    } else {
      setTimeout(tick, 1000);
    }
  };
  setTimeout(tick, 1000);
}

export function endGame() {
  game.phase = 'ended';
  if (game.rafId) { cancelAnimationFrame(game.rafId); game.rafId = null; }
  showReport();
}

function showReport() {
  const labels = ['Kick', 'Hihat', 'Snare'];
  const rows = labels.map(l => {
    const s = game.stats[l];
    const total = s.hit + s.miss;
    const pct = total > 0 ? Math.round(s.hit / total * 100) : '—';
    return `<tr>
      <td><span style="color:${SOUND_COLOR[l]}">${SOUND_SYM[l]}</span> ${l.toUpperCase()}</td>
      <td style="color:#00ff9d">${s.hit}</td>
      <td style="color:#ff3c6e">${s.miss}</td>
      <td>${pct}${typeof pct === 'number' ? '%' : ''}</td>
    </tr>`;
  }).join('');

  document.getElementById('report-score-line').innerHTML =
    `SCORE &nbsp;<span style="color:var(--accent);font-size:1.4rem">${game.totalScore}</span>`;

  document.getElementById('report-table').innerHTML = `
    <tr><th>SOUND</th><th>HITS</th><th>MISSES</th><th>ACC</th></tr>
    ${rows}`;

  document.getElementById('report-params-line').innerHTML =
    `BPM: ${game.bpm}<br>` +
    `HITBOX: ${MISS_THRESHOLD}px &nbsp;·&nbsp; COOLDOWN: ${game.cooldownMs}ms &nbsp;·&nbsp; LATENCY: ${game.latencyOffsetMs}ms`;

  document.getElementById('report-overlay').style.display = 'flex';
}

export function playAgain() {
  document.getElementById('report-overlay').style.display = 'none';
  game.stats = freshStats();
  game.totalScore = 0;
  updateScoreDisplay();
  game.phase = 'setup';
  initGame();
  syncParamModal();
  document.getElementById('param-modal').style.display = 'flex';
  if (!game.rafId) game.rafId = requestAnimationFrame(gameLoop);
}

// Exposed for audio.js: sets up for timed mode before game starts
export function enterTimedSetup() {
  game.mode  = 'timed';
  game.phase = 'setup';
  startGame();
  syncParamModal();
  document.getElementById('param-modal').style.display = 'flex';
}

// Exposed for audio.js: starts infinite play
export function enterInfinitePlay() {
  game.phase = 'playing';
  startGame();
}
