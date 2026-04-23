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
