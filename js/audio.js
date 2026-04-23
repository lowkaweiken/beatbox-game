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
