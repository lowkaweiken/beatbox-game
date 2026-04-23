import { CALIBRATION_CLASSES, CALIBRATION_SAMPLES_PER_CLASS, CALIBRATION_SOFT_FLOOR, N_SAMPLES, EMBEDDING_DIM } from './config.js';
import { state } from './state.js';
import { computeEmbedding } from './embedding.js';
import { saveCentroids, clearAll } from './storage.js';

const TECHNIQUE_HINTS = {
  'Kick':       'Unvocalized "B" — press lips, burst air, NO voice',
  'Hihat':      'Outward "TS" — tongue tip + air, NO click at onset',
  'Snare':      'Inward "K" — tongue click + inward breath',
  'Background': 'Complete silence — tap the button and stay quiet',
};

const calState = {
  currentClassIdx: 0,
  samplesByClass: {},
};

export function startCalibration() {
  calState.currentClassIdx = 0;
  calState.samplesByClass = {};
  updateCalibrationUI();
}

// Called from audio.js when an onset arrives during calibration
export function captureSample(audio) {
  const cls = CALIBRATION_CLASSES[calState.currentClassIdx];
  if (cls === 'Background') return;

  const embedding = computeEmbedding(audio);
  if (!calState.samplesByClass[cls]) calState.samplesByClass[cls] = [];
  calState.samplesByClass[cls].push(embedding);
  console.log(`[calibration] ${cls}: ${calState.samplesByClass[cls].length} samples`);
  updateCalibrationUI();
}

// Called from audio.js when a raw_audio message arrives (background recording)
export function captureBackgroundChunks(rawAudio) {
  const cls = 'Background';
  if (!calState.samplesByClass[cls]) calState.samplesByClass[cls] = [];

  const chunkSize = N_SAMPLES;  // 8820 = 200ms at 44100Hz
  const nChunks = Math.floor(rawAudio.length / chunkSize);
  let accepted = 0;

  for (let i = 0; i < nChunks; i++) {
    const chunk = rawAudio.slice(i * chunkSize, (i + 1) * chunkSize);
    const peak = chunk.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    if (peak > 0.02) {
      console.log(`[calibration] bg chunk ${i} rejected (peak ${peak.toFixed(3)})`);
      continue;
    }
    const embedding = computeEmbedding(chunk);
    calState.samplesByClass[cls].push(embedding);
    accepted++;
  }
  console.log(`[calibration] Background: ${accepted}/${nChunks} chunks accepted, total ${calState.samplesByClass[cls].length}`);
  updateCalibrationUI();
}

export function advanceClass() {
  calState.currentClassIdx = Math.min(calState.currentClassIdx + 1, CALIBRATION_CLASSES.length - 1);
  updateCalibrationUI();
}

export async function finishCalibration() {
  const centroids = {};
  for (const cls of CALIBRATION_CLASSES) {
    const samples = calState.samplesByClass[cls] || [];
    if (samples.length === 0) throw new Error(`No samples for class: ${cls}`);

    const mean = new Float32Array(EMBEDDING_DIM);
    for (const emb of samples) {
      for (let i = 0; i < EMBEDDING_DIM; i++) mean[i] += emb[i];
    }
    for (let i = 0; i < EMBEDDING_DIM; i++) mean[i] /= samples.length;

    let norm = 0;
    for (let i = 0; i < EMBEDDING_DIM; i++) norm += mean[i] * mean[i];
    norm = Math.sqrt(norm) || 1e-8;
    for (let i = 0; i < EMBEDDING_DIM; i++) mean[i] /= norm;

    centroids[cls] = mean;
  }

  await saveCentroids(centroids);
  state.centroids = centroids;
  state.calibrating = false;
  console.log('[calibration] done — centroids saved');
}

export async function recalibrate() {
  calState.currentClassIdx = 0;
  calState.samplesByClass = {};
}

export function getSampleCount(cls) {
  return (calState.samplesByClass[cls] || []).length;
}

export function discardLastSample() {
  const cls = CALIBRATION_CLASSES[calState.currentClassIdx];
  if (cls === 'Background') return;
  const arr = calState.samplesByClass[cls];
  if (arr && arr.length > 0) {
    arr.pop();
    console.log(`[calibration] ${cls}: discarded last sample, ${arr.length} remain`);
    updateCalibrationUI();
  }
}

function updateCalibrationUI() {
  const currentCls = CALIBRATION_CLASSES[calState.currentClassIdx];

  // Update current-class prompt
  const promptEl = document.getElementById('cal-current-class');
  if (promptEl) promptEl.textContent = currentCls;
  const hintEl = document.getElementById('cal-technique-hint');
  if (hintEl) hintEl.textContent = TECHNIQUE_HINTS[currentCls];

  // Update each class card
  for (const cls of CALIBRATION_CLASSES) {
    const count = getSampleCount(cls);
    const id = cls.toLowerCase();

    const countEl = document.getElementById(`cal-count-${id}`);
    if (countEl) countEl.textContent = `${count} / ${CALIBRATION_SAMPLES_PER_CLASS}`;

    const card = document.getElementById(`cal-card-${id}`);
    if (card) {
      card.classList.toggle('cal-card-active', cls === currentCls);
      card.classList.toggle('cal-card-full', count >= CALIBRATION_SAMPLES_PER_CLASS);
      card.classList.toggle('cal-card-partial', count >= CALIBRATION_SOFT_FLOOR && count < CALIBRATION_SAMPLES_PER_CLASS);
    }
  }

  // Show Background record button only when Background is active
  const bgBtn = document.getElementById('cal-record-bg-btn');
  if (bgBtn) bgBtn.style.display = currentCls === 'Background' ? 'inline-block' : 'none';

  // Show discard button when current class has >= 1 sample (not Background)
  const discardBtn = document.getElementById('cal-discard-btn');
  if (discardBtn) {
    const hasAnySamples = currentCls !== 'Background' && getSampleCount(currentCls) > 0;
    discardBtn.style.display = hasAnySamples ? 'inline-block' : 'none';
  }

  // Show advance button if current class has >= SOFT_FLOOR samples (and not last class)
  const isLastClass = calState.currentClassIdx === CALIBRATION_CLASSES.length - 1;
  const advanceBtn = document.getElementById('cal-advance-btn');
  if (advanceBtn) {
    const currentCount = getSampleCount(currentCls);
    advanceBtn.style.display = (!isLastClass && currentCount >= CALIBRATION_SOFT_FLOOR) ? 'inline-block' : 'none';
  }

  // Show Done button when all classes have >= SOFT_FLOOR samples
  const allReady = CALIBRATION_CLASSES.every(cls => getSampleCount(cls) >= CALIBRATION_SOFT_FLOOR);
  const doneBtn = document.getElementById('cal-done-btn');
  if (doneBtn) doneBtn.style.display = allReady ? 'inline-block' : 'none';
}
