import { N_FFT, N_SAMPLES, N_FRAMES, N_MELS, HOP, SR, DB_FLOOR, HANN_WIN, MEL_FB } from './config.js';

// Cooley-Tukey radix-2 FFT, in-place
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang  = -2 * Math.PI / len;
    const wbRe = Math.cos(ang), wbIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wRe = 1, wIm = 0;
      for (let k = 0; k < half; k++) {
        const uRe = re[i + k], uIm = im[i + k];
        const tRe = wRe * re[i + k + half] - wIm * im[i + k + half];
        const tIm = wRe * im[i + k + half] + wIm * re[i + k + half];
        re[i + k]        = uRe + tRe;  im[i + k]        = uIm + tIm;
        re[i + k + half] = uRe - tRe;  im[i + k + half] = uIm - tIm;
        const nwRe = wRe * wbRe - wIm * wbIm;
        wIm = wRe * wbIm + wIm * wbRe;  wRe = nwRe;
      }
    }
  }
}

// Matches train.ipynb wav_to_mel exactly.
// Returns Float32Array of length N_MELS * N_FRAMES, reshape to [1, 64, 35, 1] for model input.
export function computeMelSpec(audio) {
  // 1. Truncate / zero-pad to N_SAMPLES
  const sig = new Float32Array(N_SAMPLES);
  sig.set(audio.subarray(0, N_SAMPLES));

  // 2. Peak-normalize loud sounds (matches training: only if peak > 0.05)
  let peak = 0;
  for (let i = 0; i < sig.length; i++) if (Math.abs(sig[i]) > peak) peak = Math.abs(sig[i]);
  if (peak > 0.05) for (let i = 0; i < sig.length; i++) sig[i] /= peak;

  // 3. Reflect-pad by n_fft/2 = 512 on each side (librosa center=True default)
  const padLen = N_FFT >> 1;
  const padded = new Float32Array(N_SAMPLES + 2 * padLen);
  padded.set(sig, padLen);
  for (let i = 0; i < padLen; i++) {
    padded[padLen - 1 - i]         = sig[i + 1];
    padded[padLen + N_SAMPLES + i] = sig[N_SAMPLES - 2 - i];
  }

  // 4. STFT → power spectrum per frame
  const nBins = N_FFT / 2 + 1;
  const powerFrames = new Array(N_FRAMES);
  const re = new Float32Array(N_FFT), im = new Float32Array(N_FFT);
  for (let f = 0; f < N_FRAMES; f++) {
    const start = f * HOP;
    for (let i = 0; i < N_FFT; i++) { re[i] = padded[start + i] * HANN_WIN[i]; im[i] = 0; }
    fft(re, im);
    const pwr = new Float32Array(nBins);
    for (let k = 0; k < nBins; k++) pwr[k] = re[k] * re[k] + im[k] * im[k];
    powerFrames[f] = pwr;
  }

  // 5. Apply mel filterbank, convert to dB (ref=1.0), clip & normalize → [0,1]
  const out = new Float32Array(N_MELS * N_FRAMES);
  for (let m = 0; m < N_MELS; m++) {
    const fbOff = m * nBins;
    for (let f = 0; f < N_FRAMES; f++) {
      let mel = 0;
      for (let k = 0; k < nBins; k++) mel += MEL_FB[fbOff + k] * powerFrames[f][k];
      const db = Math.max(10 * Math.log10(Math.max(mel, 1e-10)), DB_FLOOR);
      out[m * N_FRAMES + f] = (db - DB_FLOOR) / (-DB_FLOOR);
    }
  }
  return out;
}
