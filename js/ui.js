import { CLASS_LABELS, CLASS_MAP, DISPLAY_THRESHOLD } from './config.js';
import { state } from './state.js';

export function startWaveform(analyser) {
  const canvas = document.getElementById('waveform-canvas');
  const ctx = canvas.getContext('2d');
  const buf = new Uint8Array(analyser.frequencyBinCount);
  function draw() {
    state.animFrameId = requestAnimationFrame(draw);
    analyser.getByteTimeDomainData(buf);
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(0,255,157,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const sliceW = W / buf.length;
    let x = 0;
    for (let i = 0; i < buf.length; i++) {
      const y = (buf[i] / 128.0) * H / 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      x += sliceW;
    }
    ctx.stroke();
  }
  draw();
}

export function buildBars() {
  const container = document.getElementById('bar-container');
  container.innerHTML = '';
  state.barElements = [];
  CLASS_LABELS.forEach(label => {
    const mapped = CLASS_MAP[label] || { symbol: label, name: label };
    const row = document.createElement('div');
    row.className = 'bar-row';
    row.innerHTML = `
      <div class="bar-class">${mapped.symbol} · ${mapped.name}</div>
      <div class="bar-track"><div class="bar-fill" id="fill-${label}"></div></div>
      <div class="bar-pct" id="pct-${label}">0%</div>`;
    container.appendChild(row);
    state.barElements.push(label);
  });
}

// Immediate onset flash — fires before classification completes
export function flashOnset() {
  const flash = document.getElementById('flash');
  flash.style.background = 'rgba(255,255,255,0.04)';
  flash.style.opacity = '1';
  setTimeout(() => { flash.style.opacity = '0'; }, 60);
}

export function updateUI(scores, onsetTs) {
  let topIdx = 0;
  for (let i = 1; i < scores.length; i++)
    if (scores[i] > scores[topIdx]) topIdx = i;

  const topLabel = CLASS_LABELS[topIdx];
  const topScore = scores[topIdx];
  const isBackground   = topLabel === 'Background';
  const aboveThreshold = topScore >= DISPLAY_THRESHOLD && !isBackground;

  const symbolEl = document.getElementById('detected-symbol');
  const nameEl   = document.getElementById('detected-name');
  const box      = document.getElementById('detection-box');
  symbolEl.className = 'detected-sound';
  box.className = 'detection-box';

  if (aboveThreshold) {
    state.lastDetection = { label: topLabel, ts: Date.now(), onsetTs };
    state.lastScore = Math.round(topScore * 100);
    const mapped = CLASS_MAP[topLabel] || { symbol: topLabel, name: topLabel };
    symbolEl.textContent = mapped.symbol;
    symbolEl.classList.add(`active-${topLabel}`);
    nameEl.textContent = `${mapped.name} · ${(topScore * 100).toFixed(0)}%`;
    box.classList.add(`hit-${topLabel}`);
    const colors = { Kick: 'rgba(0,255,157,0.07)', Hihat: 'rgba(255,230,0,0.07)', Snare: 'rgba(255,60,110,0.07)' };
    const flash = document.getElementById('flash');
    flash.style.background = colors[topLabel] || 'transparent';
    flash.style.opacity = '1';
    setTimeout(() => { flash.style.opacity = '0'; }, 80);
  } else {
    symbolEl.textContent = '—';
    nameEl.textContent = state.isListening ? 'listening…' : 'waiting for input…';
  }

  CLASS_LABELS.forEach((label, i) => {
    const fill = document.getElementById(`fill-${label}`);
    const pct  = document.getElementById(`pct-${label}`);
    if (!fill || !pct) return;
    const val = scores[i] * 100;
    fill.style.width = val.toFixed(1) + '%';
    pct.textContent  = val.toFixed(0) + '%';
    fill.className = 'bar-fill';
    pct.className  = 'bar-pct';
    if (i === topIdx && aboveThreshold) {
      fill.classList.add(`top-${label}`);
      pct.classList.add('top');
    }
  });
}

export function setStatus(stateStr, msg) {
  document.getElementById('status-dot').className = `status-dot ${stateStr}`;
  document.getElementById('status-text').textContent = msg;
}
