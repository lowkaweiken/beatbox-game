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
