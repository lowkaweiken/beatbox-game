# Per-User Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic CNN softmax classifier with a per-user nearest-centroid system so the game works accurately for any player on any device.

**Architecture:** The existing CNN becomes a frozen feature extractor. During a ~60s first-launch calibration, the user records 10 samples of each sound class; their 64-dim penultimate-layer embeddings are averaged into per-class centroids and saved to IndexedDB. At runtime, `classify()` computes an embedding for each onset, scores it against the user's centroids via cosine similarity + softmax, and returns the same 4-element score array the rest of the code already consumes — no changes needed downstream.

**Tech Stack:** TF.js 4.22 (already loaded), IndexedDB, vanilla ES modules, no bundler.

---

## File Map

| Path | Action | Responsibility |
|------|--------|----------------|
| `js/config.js` | Modify | Add calibration constants |
| `js/state.js` | Modify | Add `embeddingModel`, `centroids`, `calibrating` fields |
| `js/storage.js` | Create | IndexedDB wrapper (save/load/clear centroids) |
| `js/embedding.js` | Create | Build embedding model, compute embedding, classify by centroids |
| `js/model.js` | Modify | Update `classify()` to branch on `state.centroids` |
| `audio_processor.js` | Modify | Add `collect_raw` mode for background recording |
| `js/audio.js` | Modify | Route onset to calibration; add `startCalibrationFlow`, `recordBackground`; build embedding model on init |
| `js/calibration.js` | Create | Calibration state machine: sample capture, centroid compute, save |
| `index.html` | Modify | Add `id="home-view"` to wrapper; add `#calibration-view` with class cards; add CALIBRATE and RECALIBRATE buttons; add home gating hint |
| `css/calibration.css` | Create | Styles for calibration view |
| `js/main.js` | Modify | Wire all calibration button handlers; add `updateHomeCalibrationState()` |

---

## Task 1: Add calibration constants to `js/config.js` and fields to `js/state.js`

**Files:**
- Modify: `js/config.js`
- Modify: `js/state.js`

- [ ] **Step 1: Add constants to `js/config.js`**

Append to the bottom of the file:

```js
export const CALIBRATION_CLASSES = ['Kick', 'Hihat', 'Snare', 'Background'];
export const CALIBRATION_SAMPLES_PER_CLASS = 10;
export const CALIBRATION_SOFT_FLOOR = 5;
export const CALIBRATION_TEMPERATURE = 0.1;
export const EMBEDDING_DIM = 64;
```

- [ ] **Step 2: Add fields to `js/state.js`**

Replace the entire file with:

```js
export const state = {
  model: null,
  embeddingModel: null,
  centroids: null,
  audioCtx: null,
  workletNode: null,
  classifying: false,
  isListening: false,
  isTesting: false,
  calibrating: false,
  animFrameId: null,
  barElements: [],
  lastDetection: { label: null, ts: 0, onsetTs: 0 },
  lastScore: 0,
  onsetDateNow: 0,
};
```

- [ ] **Step 3: Commit**

```bash
git add js/config.js js/state.js
git commit -m "feat(calibration): add calibration constants and state fields"
```

---

## Task 2: Create `js/storage.js` (IndexedDB wrapper)

**Files:**
- Create: `js/storage.js`

- [ ] **Step 1: Create the file**

```js
const DB_NAME = 'beatbox-calibration';
const DB_VERSION = 1;
const STORE = 'calibration';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => e.target.result.createObjectStore(STORE);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

export async function saveCentroids(centroids) {
  const data = {};
  for (const [cls, arr] of Object.entries(centroids)) data[cls] = Array.from(arr);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(data, 'centroids');
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}

export async function loadCentroids() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get('centroids');
    req.onsuccess = e => {
      const raw = e.target.result;
      if (!raw) { resolve(null); return; }
      const out = {};
      for (const [cls, arr] of Object.entries(raw)) out[cls] = new Float32Array(arr);
      resolve(out);
    };
    req.onerror = e => reject(e.target.error);
  });
}

export async function clearAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}
```

- [ ] **Step 2: Verify in browser console**

Start server: `python -m http.server 8000`

Open `http://localhost:8000`, open DevTools console, then run:

```js
import('/js/storage.js').then(async m => {
  const fakeC = { Kick: new Float32Array(64).fill(0.1), Hihat: new Float32Array(64).fill(0.2), Snare: new Float32Array(64).fill(0.3), Background: new Float32Array(64).fill(0.05) };
  await m.saveCentroids(fakeC);
  const loaded = await m.loadCentroids();
  console.log('Kick[0]:', loaded.Kick[0]);  // expect 0.1
  await m.clearAll();
  const empty = await m.loadCentroids();
  console.log('after clear:', empty);  // expect null
});
```

Expected output: `Kick[0]: 0.10000000149011612` then `after clear: null`

- [ ] **Step 3: Commit**

```bash
git add js/storage.js
git commit -m "feat(calibration): add IndexedDB storage wrapper"
```

---

## Task 3: Create `js/embedding.js`

**Files:**
- Create: `js/embedding.js`

- [ ] **Step 1: Create the file**

```js
import { N_MELS, N_FRAMES, CALIBRATION_TEMPERATURE } from './config.js';
import { computeMelSpec } from './dsp.js';
import { state } from './state.js';

export function buildEmbeddingModel(net) {
  // net.layers[6] is the Dense(64) relu layer — penultimate, before the softmax Dense(4) at layers[8]
  return tf.model({ inputs: net.inputs, outputs: net.layers[6].output });
}

function l2Normalize(arr) {
  let norm = 0;
  for (let i = 0; i < arr.length; i++) norm += arr[i] * arr[i];
  norm = Math.sqrt(norm) || 1e-8;
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i] / norm;
  return out;
}

function cosineSim(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

function softmaxWithTemp(arr, temperature) {
  const scaled = arr.map(x => x / temperature);
  const max = Math.max(...scaled);
  const exps = scaled.map(x => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(x => x / sum);
}

export function computeEmbedding(audio) {
  const melSpec = computeMelSpec(audio);
  const input = tf.tensor4d(melSpec, [1, N_MELS, N_FRAMES, 1]);
  const embTensor = state.embeddingModel.predict(input);
  const raw = new Float32Array(embTensor.dataSync());
  input.dispose();
  embTensor.dispose();
  return l2Normalize(raw);
}

// centroids: { Background: Float32Array[64], Hihat: Float32Array[64], Kick: Float32Array[64], Snare: Float32Array[64] }
// Returns scores in CLASS_LABELS alphabetical order: [Background, Hihat, Kick, Snare]
export function classifyByCentroids(embedding, centroids) {
  const classes = ['Background', 'Hihat', 'Kick', 'Snare'];
  const sims = classes.map(cls => cosineSim(embedding, centroids[cls]));
  return softmaxWithTemp(sims, CALIBRATION_TEMPERATURE);
}
```

- [ ] **Step 2: Verify layer index assumption**

Open the browser console on `http://localhost:8000` and run:

```js
import('/js/model.js').then(async m => {
  const net = await m.loadModel();
  net.layers.forEach((l, i) => console.log(i, l.name, l.outputShape));
});
```

Expected output — layer 6 must be the Dense(64) layer:
```
0  conv2d   [null,64,35,32]
1  batch_normalization  [null,64,35,32]
2  max_pooling2d  [null,32,17,32]
3  conv2d_1  [null,32,17,64]
4  batch_normalization_1  [null,32,17,64]
5  global_average_pooling2d  [null,64]
6  dense  [null,64]        ← this one
7  dropout  [null,64]
8  dense_1  [null,4]
```

If layer 6 is not Dense(64), update the index in `buildEmbeddingModel`.

- [ ] **Step 3: Commit**

```bash
git add js/embedding.js
git commit -m "feat(calibration): add embedding extraction and centroid classifier"
```

---

## Task 4: Update `js/model.js` — branch `classify()` on centroids

**Files:**
- Modify: `js/model.js`

- [ ] **Step 1: Update imports and `classify()`**

Replace the entire file:

```js
import { N_MELS, N_FRAMES } from './config.js';
import { computeMelSpec } from './dsp.js';
import { state } from './state.js';
import { updateUI } from './ui.js';
import { computeEmbedding, classifyByCentroids } from './embedding.js';

export async function loadModel() {
  const SPECS = [
    [32], [32], [32], [32],
    [64], [64], [64], [64],
    [3,3,1,32], [32],
    [3,3,32,64], [64],
    [64,64], [64],
    [64,4], [4],
  ];

  const buf = await (await fetch('./new_model/group1-shard1of1.bin')).arrayBuffer();
  let off = 0;
  const raw = SPECS.map(shape => {
    const n = shape.reduce((a,b) => a*b, 1);
    const t = tf.tensor(new Float32Array(buf.slice(off, off + n*4)), shape, 'float32');
    off += n * 4;
    return t;
  });

  const net = tf.sequential({ layers: [
    tf.layers.conv2d({ inputShape: [N_MELS, N_FRAMES, 1], filters: 32, kernelSize: 3, padding: 'same', activation: 'relu', useBias: true }),
    tf.layers.batchNormalization({ axis: -1, momentum: 0.99, epsilon: 0.001 }),
    tf.layers.maxPooling2d({ poolSize: [2,2] }),
    tf.layers.conv2d({ filters: 64, kernelSize: 3, padding: 'same', activation: 'relu', useBias: true }),
    tf.layers.batchNormalization({ axis: -1, momentum: 0.99, epsilon: 0.001 }),
    tf.layers.globalAveragePooling2d({ dataFormat: 'channelsLast' }),
    tf.layers.dense({ units: 64, activation: 'relu' }),
    tf.layers.dropout({ rate: 0.5 }),
    tf.layers.dense({ units: 4, activation: 'softmax' }),
  ]});

  net.setWeights([
    raw[8], raw[9],
    raw[0], raw[1],
    raw[10], raw[11],
    raw[4], raw[5],
    raw[12], raw[13],
    raw[14], raw[15],
    raw[2], raw[3],
    raw[6], raw[7],
  ]);
  raw.forEach(t => t.dispose());

  const dummy = tf.zeros([1, N_MELS, N_FRAMES, 1]);
  const testOut = net.predict(dummy);
  console.log('[loadModel] model OK, shape:', testOut.shape);
  dummy.dispose(); testOut.dispose();

  return net;
}

export async function classify(audio, onsetTs) {
  if (!state.model || state.classifying) return;
  state.classifying = true;
  try {
    if (state.centroids) {
      const embedding = computeEmbedding(audio);
      const scores = classifyByCentroids(embedding, state.centroids);
      updateUI(scores, onsetTs);
    } else {
      const melSpec = computeMelSpec(audio);
      const tensor  = tf.tensor4d(melSpec, [1, N_MELS, N_FRAMES, 1]);
      const pred    = state.model.predict(tensor);
      const scores  = Array.from(await pred.data());
      tensor.dispose(); pred.dispose();
      updateUI(scores, onsetTs);
    }
  } catch (e) {
    console.error('classify error', e);
  } finally {
    state.classifying = false;
  }
}
```

- [ ] **Step 2: Verify baseline still works**

Open `http://localhost:8000`, click TEST MIC, make some sounds. Confirm the detection box shows class names (Background / Kick / Hi-Hat / Snare) as before. No calibration yet — should use generic CNN path.

- [ ] **Step 3: Commit**

```bash
git add js/model.js
git commit -m "feat(calibration): branch classify() to use centroids when available"
```

---

## Task 5: Update `audio_processor.js` — add `collect_raw` mode

**Files:**
- Modify: `audio_processor.js`

- [ ] **Step 1: Replace the file**

```js
class BeatboxProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._collecting = false;
    this._collectBuf = [];
    this._collectTarget = Math.round(sampleRate * 0.2);
    this._cooldown = 0;
    this._cooldownAfter = Math.round(sampleRate * 0.4);
    this._emaRms = 0;
    this._ONSET_RATIO = 5;
    this._MIN_RMS = 0.008;
    this._rawCollecting = false;
    this._rawBuf = [];
    this._rawTarget = 0;
    this.port.onmessage = (e) => {
      if (e.data.type === 'set_cooldown') {
        this._cooldownAfter = Math.round(sampleRate * e.data.seconds);
      } else if (e.data.type === 'collect_raw') {
        this._rawCollecting = true;
        this._rawBuf = [];
        this._rawTarget = e.data.samples;
      }
    };
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;

    // Raw-collect mode: capture N samples regardless of onset, suppress onset detection
    if (this._rawCollecting) {
      for (let i = 0; i < ch.length; i++) this._rawBuf.push(ch[i]);
      if (this._rawBuf.length >= this._rawTarget) {
        const audio = new Float32Array(this._rawBuf.slice(0, this._rawTarget));
        this.port.postMessage({ type: 'raw_audio', audio }, [audio.buffer]);
        this._rawCollecting = false;
        this._rawBuf = [];
      }
      return true;
    }

    let rms = 0;
    for (let i = 0; i < ch.length; i++) rms += ch[i] * ch[i];
    rms = Math.sqrt(rms / ch.length);

    this._emaRms = 0.97 * this._emaRms + 0.03 * rms;

    if (this._collecting) {
      for (let i = 0; i < ch.length; i++) this._collectBuf.push(ch[i]);
      if (this._collectBuf.length >= this._collectTarget) {
        const audio = new Float32Array(this._collectBuf.slice(0, this._collectTarget));
        this.port.postMessage({ type: 'onset', audio }, [audio.buffer]);
        this._collectBuf = [];
        this._collecting = false;
        this._cooldown = this._cooldownAfter;
      }
    } else if (this._cooldown > 0) {
      this._cooldown -= ch.length;
    } else if (rms > this._emaRms * this._ONSET_RATIO && rms > this._MIN_RMS) {
      this.port.postMessage({ type: 'onset_start' });
      this._collecting = true;
      this._collectBuf = Array.from(ch);
    }

    return true;
  }
}

registerProcessor('beatbox-processor', BeatboxProcessor);
```

- [ ] **Step 2: Commit**

```bash
git add audio_processor.js
git commit -m "feat(calibration): add collect_raw mode to AudioWorklet for background recording"
```

---

## Task 6: Update `js/audio.js` — calibration routing, embedding model init, background recording

**Files:**
- Modify: `js/audio.js`

- [ ] **Step 1: Replace the file**

```js
import { SR, N_MELS, N_FRAMES } from './config.js';
import { state } from './state.js';
import { loadModel, classify } from './model.js';
import { buildEmbeddingModel } from './embedding.js';
import { loadCentroids } from './storage.js';
import { startWaveform, buildBars, flashOnset, setStatus } from './ui.js';
import { stopGame, enterTimedSetup, enterInfinitePlay } from './game.js';
import { captureSample, captureBackgroundChunks, startCalibration } from './calibration.js';

async function initAudioPipeline() {
  if (!state.model) {
    state.model = await loadModel();
    const dummy = tf.zeros([1, N_MELS, N_FRAMES, 1]);
    state.model.predict(dummy).dispose();
    dummy.dispose();
  }
  if (!state.embeddingModel) {
    state.embeddingModel = buildEmbeddingModel(state.model);
  }
  if (!state.centroids) {
    state.centroids = await loadCentroids();
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  state.audioCtx = new AudioContext({ sampleRate: SR });
  if (state.audioCtx.state === 'suspended') await state.audioCtx.resume();

  if (Math.abs(state.audioCtx.sampleRate - SR) > 100)
    console.warn(`AudioContext sample rate ${state.audioCtx.sampleRate} Hz — expected ${SR} Hz`);

  await state.audioCtx.audioWorklet.addModule('./audio_processor.js');

  const source   = state.audioCtx.createMediaStreamSource(stream);
  const analyser = state.audioCtx.createAnalyser();
  analyser.fftSize = 512;

  state.workletNode = new AudioWorkletNode(state.audioCtx, 'beatbox-processor', {
    numberOfInputs: 1, numberOfOutputs: 1,
    channelCount: 1, channelCountMode: 'explicit',
  });

  source.connect(analyser);
  source.connect(state.workletNode);
  state.workletNode.connect(state.audioCtx.destination);

  state.workletNode.port.onmessage = (e) => {
    if (e.data.type === 'onset_start') {
      state.onsetDateNow = Date.now();
      flashOnset();
    } else if (e.data.type === 'onset') {
      if (state.calibrating) {
        captureSample(e.data.audio);
      } else {
        classify(e.data.audio, state.onsetDateNow);
      }
    } else if (e.data.type === 'raw_audio') {
      captureBackgroundChunks(e.data.audio);
    }
  };

  startWaveform(analyser);
  buildBars();
}

export async function startMicTest() {
  if (state.isTesting) { stopMicTest(); return; }

  const btn = document.getElementById('btn-mic-test');
  btn.textContent = 'Loading…';
  btn.disabled = true;
  setStatus('loading', 'Loading model…');

  try {
    await initAudioPipeline();
    state.isTesting   = true;
    state.isListening = true;
    btn.textContent = '■ STOP TEST';
    btn.disabled = false;
    btn.classList.add('testing');
    setStatus('live', 'Mic active — make some noise!');
  } catch (err) {
    console.error(err);
    setStatus('error', 'Error: ' + err.message);
    btn.textContent = '▶ TEST MIC';
    btn.disabled = false;
  }
}

export function stopMicTest() {
  state.isTesting   = false;
  state.isListening = false;
  if (state.animFrameId) { cancelAnimationFrame(state.animFrameId); state.animFrameId = null; }
  if (state.workletNode) { state.workletNode.disconnect(); state.workletNode = null; }
  if (state.audioCtx)    { state.audioCtx.close(); state.audioCtx = null; }
  const btn = document.getElementById('btn-mic-test');
  btn.textContent = '▶ TEST MIC';
  btn.classList.remove('testing');
  document.getElementById('detected-symbol').textContent = '—';
  document.getElementById('detected-name').textContent = 'waiting for input…';
  document.getElementById('detection-box').className = 'detection-box';
  setStatus('idle', 'Model not loaded — press Start');
}

export async function startMode(selectedMode) {
  if (state.isTesting) {
    state.isTesting = false;
    if (state.animFrameId) { cancelAnimationFrame(state.animFrameId); state.animFrameId = null; }
    const btn = document.getElementById('btn-mic-test');
    btn.textContent = '▶ TEST MIC';
    btn.classList.remove('testing');
    setStatus('live', 'Live — make some noise!');
    if (selectedMode === 'timed') enterTimedSetup();
    else                          enterInfinitePlay();
    return;
  }

  setStatus('loading', 'Loading model…');
  const btnInf = document.getElementById('btn-infinite');
  const btnTmd = document.getElementById('btn-timed');
  btnInf.disabled = true;
  btnTmd.disabled = true;

  try {
    await initAudioPipeline();
    state.isListening = true;
    setStatus('live', 'Live — make some noise!');
    if (selectedMode === 'timed') enterTimedSetup();
    else                          enterInfinitePlay();
  } catch (err) {
    console.error(err);
    setStatus('error', 'Error: ' + err.message);
    btnInf.disabled = false;
    btnTmd.disabled = false;
  }
}

export async function startCalibrationFlow() {
  const calBtn = document.getElementById('btn-calibrate');
  calBtn.textContent = 'Loading…';
  calBtn.disabled = true;
  setStatus('loading', 'Loading model…');

  try {
    if (state.isTesting) {
      state.isTesting = false;
      if (state.animFrameId) { cancelAnimationFrame(state.animFrameId); state.animFrameId = null; }
      const micBtn = document.getElementById('btn-mic-test');
      micBtn.textContent = '▶ TEST MIC';
      micBtn.classList.remove('testing');
    } else {
      await initAudioPipeline();
    }
    state.isListening = true;
    state.calibrating = true;

    document.getElementById('home-view').style.display = 'none';
    document.getElementById('calibration-view').style.display = 'flex';

    startCalibration();
    setStatus('live', 'Calibrating…');
  } catch (err) {
    console.error(err);
    setStatus('error', 'Error: ' + err.message);
    calBtn.textContent = '⚙ CALIBRATE';
    calBtn.disabled = false;
  }
}

export function recordBackground() {
  const N2S = Math.round(SR * 2);
  state.workletNode.port.postMessage({ type: 'collect_raw', samples: N2S });
}

export function stopListening() {
  state.isListening = false;
  state.isTesting   = false;
  state.calibrating = false;
  if (state.animFrameId) { cancelAnimationFrame(state.animFrameId); state.animFrameId = null; }
  if (state.workletNode) { state.workletNode.disconnect(); state.workletNode = null; }
  if (state.audioCtx)    { state.audioCtx.close(); state.audioCtx = null; }
  document.getElementById('param-modal').style.display = 'none';
  document.getElementById('report-overlay').style.display = 'none';
  stopGame();
  setStatus('idle', 'Stopped — choose a mode to start again');
  document.getElementById('detected-symbol').textContent = '—';
  document.getElementById('detected-name').textContent = 'waiting for input…';
  document.getElementById('detection-box').className = 'detection-box';
  document.getElementById('btn-infinite').disabled = false;
  document.getElementById('btn-timed').disabled = false;
  const micBtn = document.getElementById('btn-mic-test');
  if (micBtn) { micBtn.textContent = '▶ TEST MIC'; micBtn.classList.remove('testing'); }
}
```

- [ ] **Step 2: Commit**

```bash
git add js/audio.js
git commit -m "feat(calibration): route onset/raw_audio messages, add startCalibrationFlow, recordBackground"
```

---

## Task 7: Create `js/calibration.js`

**Files:**
- Create: `js/calibration.js`

- [ ] **Step 1: Create the file**

```js
import { CALIBRATION_CLASSES, CALIBRATION_SAMPLES_PER_CLASS, CALIBRATION_SOFT_FLOOR, N_SAMPLES } from './config.js';
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

    const mean = new Float32Array(64);
    for (const emb of samples) {
      for (let i = 0; i < 64; i++) mean[i] += emb[i];
    }
    for (let i = 0; i < 64; i++) mean[i] /= samples.length;

    let norm = 0;
    for (let i = 0; i < 64; i++) norm += mean[i] * mean[i];
    norm = Math.sqrt(norm) || 1e-8;
    for (let i = 0; i < 64; i++) mean[i] /= norm;

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

  // Show advance button if current class has ≥ SOFT_FLOOR samples (and not last class)
  const isLastClass = calState.currentClassIdx === CALIBRATION_CLASSES.length - 1;
  const advanceBtn = document.getElementById('cal-advance-btn');
  if (advanceBtn) {
    const currentCount = getSampleCount(currentCls);
    advanceBtn.style.display = (!isLastClass && currentCount >= CALIBRATION_SOFT_FLOOR) ? 'inline-block' : 'none';
  }

  // Show Done button when all classes have ≥ SOFT_FLOOR samples
  const allReady = CALIBRATION_CLASSES.every(cls => getSampleCount(cls) >= CALIBRATION_SOFT_FLOOR);
  const doneBtn = document.getElementById('cal-done-btn');
  if (doneBtn) doneBtn.style.display = allReady ? 'inline-block' : 'none';
}
```

- [ ] **Step 2: Commit**

```bash
git add js/calibration.js
git commit -m "feat(calibration): add calibration state machine"
```

---

## Task 8: Update `index.html` — add calibration view and home gating

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add `id="home-view"` to the `.wrapper` div**

Find the line:
```html
  <div class="wrapper">
```

Replace with:
```html
  <div class="wrapper" id="home-view">
```

- [ ] **Step 2: Add the calibration view before `.wrapper`**

Insert this block immediately before `<div class="wrapper" id="home-view">`:

```html
  <!-- CALIBRATION VIEW -->
  <div id="calibration-view" style="display:none">
    <div class="cal-header">
      <h1>CALIBRATE</h1>
      <div class="cal-subtitle">Teach the game your sounds · ~60 seconds</div>
    </div>

    <div class="cal-prompt-card">
      <div class="cal-prompt-label">Now recording:</div>
      <div class="cal-current-class" id="cal-current-class">Kick</div>
      <div class="cal-technique-hint" id="cal-technique-hint">Unvocalized "B" — press lips, burst air, NO voice</div>
    </div>

    <div class="cal-cards-grid">
      <div class="cal-card" id="cal-card-kick">
        <div class="cal-card-symbol">B</div>
        <div class="cal-card-name">Kick</div>
        <div class="cal-card-count" id="cal-count-kick">0 / 10</div>
      </div>
      <div class="cal-card" id="cal-card-hihat">
        <div class="cal-card-symbol">t</div>
        <div class="cal-card-name">Hi-Hat</div>
        <div class="cal-card-count" id="cal-count-hihat">0 / 10</div>
      </div>
      <div class="cal-card" id="cal-card-snare">
        <div class="cal-card-symbol">K</div>
        <div class="cal-card-name">Snare</div>
        <div class="cal-card-count" id="cal-count-snare">0 / 10</div>
      </div>
      <div class="cal-card" id="cal-card-background">
        <div class="cal-card-symbol">···</div>
        <div class="cal-card-name">Background</div>
        <div class="cal-card-count" id="cal-count-background">0 / 10</div>
      </div>
    </div>

    <div class="cal-actions">
      <button id="cal-record-bg-btn" style="display:none">● RECORD 2s SILENCE</button>
      <button id="cal-advance-btn" style="display:none">NEXT →</button>
      <button id="cal-done-btn" style="display:none">✓ DONE — SAVE &amp; PLAY</button>
    </div>

    <div class="cal-footer-actions">
      <button id="cal-cancel-btn">✕ CANCEL</button>
    </div>
  </div>

```

- [ ] **Step 3: Add the CALIBRATE button and home gating to `.wrapper`**

Find this block in `index.html`:
```html
    <div class="mode-select">
      <button class="btn-mode btn-infinite" id="btn-infinite">
```

Insert above it:
```html
    <div id="cal-gate-hint" style="display:none">
      <span class="cal-gate-text">Calibrate first — takes ~60 seconds</span>
    </div>

    <button class="btn-calibrate" id="btn-calibrate">⚙ CALIBRATE YOUR SOUNDS</button>
    <button class="btn-recalibrate" id="btn-recalibrate" style="display:none">↺ RECALIBRATE</button>

```

- [ ] **Step 4: Add calibration CSS link in `<head>`**

Add after the last `<link rel="stylesheet">` line:
```html
  <link rel="stylesheet" href="css/calibration.css">
```

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(calibration): add calibration view DOM and home gating elements"
```

---

## Task 9: Create `css/calibration.css`

**Files:**
- Create: `css/calibration.css`

- [ ] **Step 1: Create the file**

```css
/* ── Calibration view wrapper ── */
#calibration-view {
  position: relative;
  z-index: 10;
  width: min(560px, 95vw);
  flex-direction: column;
  gap: 24px;
  margin: auto 0;
  padding: 36px 0;
}

/* ── Header ── */
.cal-header {
  text-align: center;
}

.cal-header h1 {
  font-family: var(--font-display);
  font-size: clamp(2rem, 7vw, 3.2rem);
  letter-spacing: 0.1em;
  color: var(--accent3);
  text-shadow: 0 0 20px rgba(255, 230, 0, 0.4);
  line-height: 1;
}

.cal-subtitle {
  font-size: 0.65rem;
  letter-spacing: 0.3em;
  color: var(--muted);
  margin-top: 6px;
  text-transform: uppercase;
}

/* ── Prompt card ── */
.cal-prompt-card {
  background: var(--surface);
  border: 1px solid #333355;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cal-prompt-label {
  font-size: 0.6rem;
  letter-spacing: 0.2em;
  color: var(--muted);
  text-transform: uppercase;
}

.cal-current-class {
  font-family: var(--font-display);
  font-size: 1.8rem;
  color: var(--accent3);
  letter-spacing: 0.1em;
}

.cal-technique-hint {
  font-size: 0.72rem;
  color: var(--text);
  letter-spacing: 0.06em;
  line-height: 1.5;
}

/* ── Class cards grid ── */
.cal-cards-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

.cal-card {
  background: var(--surface);
  border: 1px solid var(--border);
  padding: 14px 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  transition: border-color 0.15s;
}

.cal-card-symbol {
  font-family: var(--font-display);
  font-size: 1.4rem;
  color: var(--muted);
  transition: color 0.15s;
}

.cal-card-name {
  font-size: 0.6rem;
  letter-spacing: 0.15em;
  color: var(--muted);
  text-transform: uppercase;
}

.cal-card-count {
  font-size: 0.65rem;
  letter-spacing: 0.08em;
  color: var(--muted);
}

/* Active class card */
.cal-card.cal-card-active {
  border-color: var(--accent3);
}

.cal-card.cal-card-active .cal-card-symbol {
  color: var(--accent3);
  text-shadow: 0 0 12px rgba(255, 230, 0, 0.5);
}

.cal-card.cal-card-active .cal-card-name,
.cal-card.cal-card-active .cal-card-count {
  color: var(--text);
}

/* Partial progress (≥ SOFT_FLOOR) */
.cal-card.cal-card-partial {
  border-color: #4a4a00;
}

.cal-card.cal-card-partial .cal-card-symbol {
  color: #aaaa00;
}

/* Full (≥ SAMPLES_PER_CLASS) */
.cal-card.cal-card-full {
  border-color: var(--accent);
}

.cal-card.cal-card-full .cal-card-symbol {
  color: var(--accent);
  text-shadow: 0 0 12px rgba(0, 255, 157, 0.4);
}

.cal-card.cal-card-full .cal-card-name,
.cal-card.cal-card-full .cal-card-count {
  color: var(--accent);
}

/* ── Action buttons ── */
.cal-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.cal-footer-actions {
  display: flex;
  gap: 12px;
}

#cal-record-bg-btn {
  background: transparent;
  border: 2px solid var(--accent2);
  color: var(--accent2);
  font-family: var(--font-mono);
  font-size: 0.8rem;
  padding: 10px 20px;
  cursor: pointer;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

#cal-record-bg-btn:hover {
  background: var(--accent2);
  color: #000;
}

#cal-advance-btn {
  background: transparent;
  border: 1px solid var(--accent3);
  color: var(--accent3);
  font-family: var(--font-mono);
  font-size: 0.8rem;
  padding: 10px 20px;
  cursor: pointer;
  letter-spacing: 0.12em;
}

#cal-advance-btn:hover {
  background: var(--accent3);
  color: #000;
}

#cal-done-btn {
  background: transparent;
  border: 2px solid var(--accent);
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 0.85rem;
  padding: 12px 24px;
  cursor: pointer;
  letter-spacing: 0.15em;
  text-transform: uppercase;
}

#cal-done-btn:hover {
  background: var(--accent);
  color: #000;
}

#cal-cancel-btn {
  background: transparent;
  border: 1px solid var(--muted);
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 0.7rem;
  padding: 8px 16px;
  cursor: pointer;
  letter-spacing: 0.1em;
}

#cal-cancel-btn:hover {
  border-color: var(--text);
  color: var(--text);
}

/* ── Home page gating ── */
.btn-calibrate {
  width: 100%;
  background: transparent;
  border: 2px solid var(--accent3);
  color: var(--accent3);
  font-family: var(--font-mono);
  font-size: 0.85rem;
  padding: 18px;
  cursor: pointer;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  transition: background 0.15s, color 0.15s;
}

.btn-calibrate:hover {
  background: var(--accent3);
  color: #000;
}

.btn-recalibrate {
  background: transparent;
  border: 1px solid var(--muted);
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 0.65rem;
  padding: 6px 14px;
  cursor: pointer;
  letter-spacing: 0.12em;
  align-self: flex-start;
}

.btn-recalibrate:hover {
  border-color: var(--text);
  color: var(--text);
}

#cal-gate-hint {
  text-align: center;
}

.cal-gate-text {
  font-size: 0.6rem;
  letter-spacing: 0.2em;
  color: var(--accent2);
  text-transform: uppercase;
}

/* Disabled mode buttons when uncalibrated */
.btn-mode:disabled {
  opacity: 0.3;
  cursor: not-allowed;
  pointer-events: none;
}

/* ── Mobile: 2-col grid for small screens ── */
@media (max-width: 400px) {
  .cal-cards-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add css/calibration.css
git commit -m "feat(calibration): add calibration view styles"
```

---

## Task 10: Wire `js/main.js` — button handlers and home state management

**Files:**
- Modify: `js/main.js`

- [ ] **Step 1: Replace the file**

```js
import { startMode, startMicTest, stopListening, startCalibrationFlow, recordBackground } from './audio.js';
import { restartGame, startTimedGame, playAgain, adjustLatency, adjustBPM, adjustCooldown, adjustHitbox } from './game.js';
import { finishCalibration, recalibrate, advanceClass } from './calibration.js';
import { loadCentroids } from './storage.js';
import { state } from './state.js';

const ADJUST = {
  'adjust-latency':  adjustLatency,
  'adjust-bpm':      adjustBPM,
  'adjust-hitbox':   adjustHitbox,
  'adjust-cooldown': adjustCooldown,
};

document.addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const fn = ADJUST[btn.dataset.action];
  if (fn) fn(parseInt(btn.dataset.delta, 10));
});

document.getElementById('btn-mic-test').addEventListener('click', startMicTest);
document.getElementById('btn-infinite').addEventListener('click', () => startMode('infinite'));
document.getElementById('btn-timed').addEventListener('click', () => startMode('timed'));
document.getElementById('restart-btn').addEventListener('click', restartGame);
document.getElementById('stop-btn').addEventListener('click', stopListening);
document.getElementById('param-start-btn').addEventListener('click', startTimedGame);
document.getElementById('report-play-again').addEventListener('click', playAgain);
document.getElementById('report-home-btn').addEventListener('click', stopListening);

// Calibration buttons
document.getElementById('btn-calibrate').addEventListener('click', startCalibrationFlow);

document.getElementById('btn-recalibrate').addEventListener('click', async () => {
  await recalibrate();
  startCalibrationFlow();
});

document.getElementById('cal-record-bg-btn').addEventListener('click', recordBackground);

document.getElementById('cal-advance-btn').addEventListener('click', advanceClass);

document.getElementById('cal-done-btn').addEventListener('click', async () => {
  try {
    await finishCalibration();
    stopListening();
    exitCalibrationView(true);
  } catch (err) {
    console.error('[calibration] finishCalibration failed:', err);
    alert('Calibration failed: ' + err.message + '\nPlease record samples for all classes.');
  }
});

document.getElementById('cal-cancel-btn').addEventListener('click', () => {
  const wasCalibrated = !!state.centroids;
  stopListening();
  exitCalibrationView(wasCalibrated);
});

function exitCalibrationView(calibrated) {
  document.getElementById('calibration-view').style.display = 'none';
  document.getElementById('home-view').style.display = 'flex';
  updateHomeCalibrationState(calibrated);
}

function updateHomeCalibrationState(calibrated) {
  document.getElementById('btn-calibrate').style.display = calibrated ? 'none' : 'block';
  document.getElementById('btn-recalibrate').style.display = calibrated ? 'inline-block' : 'none';
  document.getElementById('cal-gate-hint').style.display = calibrated ? 'none' : 'block';
  document.getElementById('btn-infinite').disabled = !calibrated;
  document.getElementById('btn-timed').disabled = !calibrated;
  // Restore button text in case it was changed by startCalibrationFlow
  const calBtn = document.getElementById('btn-calibrate');
  calBtn.textContent = '⚙ CALIBRATE YOUR SOUNDS';
  calBtn.disabled = false;
}

// On load: check IndexedDB for existing calibration
loadCentroids().then(centroids => {
  updateHomeCalibrationState(!!centroids);
});
```

- [ ] **Step 2: Commit**

```bash
git add js/main.js
git commit -m "feat(calibration): wire all calibration button handlers and home state"
```

---

## Task 11: End-to-End Verification

- [ ] **Step 1: Start the dev server**

```bash
python -m http.server 8000
```

Open `http://localhost:8000` in Chrome.

- [ ] **Step 2: Fresh-user path**

Open an incognito window. Verify:
- CALIBRATE button is visible and yellow
- INFINITE and TIMED buttons are visually dimmed / disabled
- "Calibrate first" hint text is visible

- [ ] **Step 3: Run through calibration**

Click CALIBRATE. Grant mic permission. Verify:
- Calibration view shows, home view hidden
- First class (Kick) card is highlighted in yellow
- Technique hint shows "Unvocalized 'B'…"
- Make kick sounds: count in `cal-count-kick` increments on each onset
- Advance button appears after 5th sample; click NEXT
- Repeat for Hihat (5+ samples), Snare (5+ samples)
- Background class: tap RECORD 2s SILENCE and stay quiet
  - Check console: `[calibration] Background: N/10 chunks accepted` — N should be ≥ 5
- DONE button appears once all 4 classes have ≥ 5 samples
- Click DONE

- [ ] **Step 4: Verify IndexedDB**

In DevTools → Application → Storage → IndexedDB → `beatbox-calibration` → `calibration` → `current`

Expand the `centroids` key. Verify it contains `Background`, `Hihat`, `Kick`, `Snare`, each with 64 numeric values.

- [ ] **Step 5: Verify gameplay post-calibration**

Click INFINITE MODE. Make sounds. Confirm:
- Console shows no errors
- Detection box updates with correct class names
- Kick, Hihat, Snare are classified correctly for your voice

- [ ] **Step 6: Verify persistence**

Hard-refresh the page (Cmd+Shift+R). Verify:
- Home shows RECALIBRATE (small) not CALIBRATE (large)
- INFINITE and TIMED buttons are enabled
- Click INFINITE: classification still works without re-calibrating

- [ ] **Step 7: Verify recalibration**

Click ↺ RECALIBRATE. Verify calibration view opens. Click CANCEL. Verify home returns to calibrated state (old centroids preserved).

Click ↺ RECALIBRATE again. Complete a new calibration. Verify DONE saves and returns to home.

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit -m "feat: add per-user calibration with kNN embedding classifier"
```
