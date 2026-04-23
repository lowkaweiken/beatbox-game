export const DISPLAY_THRESHOLD = 0.75;

export const CLASS_LABELS = ['Background', 'Hihat', 'Kick', 'Snare'];

export const CLASS_MAP = {
  'Background': { symbol: '···', name: 'Background' },
  'Hihat':      { symbol: 't',   name: 'Hi-Hat' },
  'Kick':       { symbol: 'B',   name: 'Kick Drum' },
  'Snare':      { symbol: 'K',   name: 'Snare' },
};

// Preprocessing constants — must match train.ipynb exactly
export const SR = 44100;
export const N_FFT = 1024;
export const HOP = 256;
export const N_MELS = 64;
export const N_SAMPLES = Math.round(SR * 0.2);            // 8820 — 200ms
export const N_FRAMES  = 1 + Math.floor(N_SAMPLES / HOP); // 35
export const DB_FLOOR  = -50.0;

// Hann window for STFT, precomputed
export const HANN_WIN = (() => {
  const w = new Float32Array(N_FFT);
  for (let i = 0; i < N_FFT; i++)
    w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (N_FFT - 1)));
  return w;
})();

// Mel filterbank (librosa-compatible: htk=False, norm='slaney'), precomputed
export const MEL_FB = (() => {
  const fSp = 200 / 3, minLogHz = 1000;
  const minLogMel = minLogHz / fSp;
  const logStep = Math.log(6.4) / 27;
  const hzToMel = f => f >= minLogHz ? minLogMel + Math.log(f / minLogHz) / logStep : f / fSp;
  const melToHz = m => m >= minLogMel ? minLogHz * Math.exp(logStep * (m - minLogMel)) : m * fSp;

  const melMin = hzToMel(0), melMax = hzToMel(SR / 2);
  const nPts = N_MELS + 2;
  const hzPts = new Float32Array(nPts);
  for (let i = 0; i < nPts; i++)
    hzPts[i] = melToHz(melMin + (melMax - melMin) * i / (nPts - 1));

  const nBins = N_FFT / 2 + 1;
  const fb = new Float32Array(N_MELS * nBins);
  for (let m = 0; m < N_MELS; m++) {
    const lo = hzPts[m], mid = hzPts[m + 1], hi = hzPts[m + 2];
    const norm = 2 / (hi - lo);
    for (let k = 0; k < nBins; k++) {
      const f = k * SR / N_FFT;
      let w = 0;
      if (f >= lo && f <= mid)       w = (f - lo) / (mid - lo);
      else if (f > mid && f <= hi)   w = (hi - f) / (hi - mid);
      fb[m * nBins + k] = norm * w;
    }
  }
  return fb;
})();

// Calibration constants for per-user personalization
export const CALIBRATION_CLASSES = ['Kick', 'Hihat', 'Snare', 'Background'];
export const CALIBRATION_SAMPLES_PER_CLASS = 10;
export const CALIBRATION_SOFT_FLOOR = 5;
export const CALIBRATION_TEMPERATURE = 0.1;
export const EMBEDDING_DIM = 64;
