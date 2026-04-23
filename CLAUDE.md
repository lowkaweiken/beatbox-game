# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Browser-based beatbox rhythm game + real-time sound classifier. A custom micro-CNN (TensorFlow.js) recognizes four percussion sounds — Kick, Hi-Hat, Snare, Background — and drives a rhythm game where boxes scroll across a judgment line. Two modes: INFINITE (practice) and TIMED (30-second run with score report).

## Running the App

No build system — serve statically and open in a browser:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

HTTPS is required for mic access, so on a phone use GitHub Pages (not `http://` localhost).

## Project Structure

```
beatbox-game/
├── index.html             # ~165 lines — HTML only, loads CSS + modules
├── audio_processor.js     # AudioWorklet — onset detector (runs in worklet thread)
├── css/                   # 5 files split by concern
│   ├── base.css           # vars, reset, body, wrapper, header, .flash
│   ├── home.css           # home-page UI (visualizer, detection, bars, mode buttons)
│   ├── game.css           # game view, canvas, HUD, score, verdict
│   ├── modals.css         # param modal + end-of-game report modal
│   └── responsive.css     # @media queries (max-height, mobile max-width: 599px)
├── js/                    # 8 ES modules (no bundler — native ESM via <script type="module">)
│   ├── config.js          # constants: CLASS_LABELS, CLASS_MAP, SR, N_FFT, HOP, N_MELS, HANN_WIN, MEL_FB
│   ├── state.js           # shared mutable state object (model, audioCtx, isListening, lastDetection, …)
│   ├── dsp.js             # FFT (Cooley-Tukey radix-2) + mel spectrogram (computeMelSpec)
│   ├── model.js           # manual layer construction + binary weight loader + classify()
│   ├── ui.js              # home-page DOM updates: waveform, bars, updateUI, flashOnset, setStatus
│   ├── game.js            # game state, spawn/draw/loop, scoring, modal sync, adjust* helpers
│   ├── audio.js           # mic pipeline + worklet wiring: startMicTest, startMode, stopListening
│   └── main.js            # entry — wires button click handlers to module functions
├── new_model/             # trained CNN (TF.js format)
│   ├── group1-shard1of1.bin    # 92 KB binary weights
│   ├── metadata.json
│   └── model.json              # Keras 3 serialization — not parseable by tf.loadLayersModel directly
├── tools/
│   ├── data_collector.html     # standalone sample collection tool
│   └── train.ipynb             # training notebook (Librosa + TF/Keras → TF.js export)
└── docs/
    ├── session_summary.md      # session-by-session progress
    └── lessons_learned.md      # training pitfalls + UI/CSS gotchas
```

## Module Dependency Graph

```
main.js
 ├→ audio.js   → config, state, model, ui, game
 └→ game.js    → config, state

audio.js (worklet message handler)
 └→ classify (model.js)
     └→ updateUI (ui.js) — writes state.lastDetection
         ↑
         gameLoop (game.js) reads state.lastDetection
```

TF.js is loaded as a global from CDN (`window.tf`), not imported — modules reference `tf` directly.

## Model

Custom micro-CNN at `new_model/`:
- **Input**: 64×35×1 mel spectrogram (from 200ms audio at 44.1 kHz, n_fft=1024, hop=256)
- **Architecture**: Conv2D(32) → BN → MaxPool → Conv2D(64) → BN → GlobalAvgPool → Dense(64) → Dropout(0.5) → Dense(4, softmax)
- **Output classes** (alphabetical order): `['Background', 'Hihat', 'Kick', 'Snare']`
- **Loader quirk**: [js/model.js](js/model.js) builds the Keras layer stack manually and loads only `group1-shard1of1.bin` weights — this sidesteps `tf.loadLayersModel`, which can't parse the Keras 3 serialization format in `model.json`.

To swap the model, match the architecture in [js/model.js:loadModel](js/model.js) and the preprocessing constants in [js/config.js](js/config.js). Check [docs/lessons_learned.md](docs/lessons_learned.md) for training gotchas (BatchNorm collapse, dB floor choice, peak-normalization threshold).

## Real-Time Audio Pipeline

1. `audio.js:initAudioPipeline()` — called by both `startMicTest()` and `startMode()`:
   - Loads model (once), gets mic stream, creates `AudioContext`, registers `audio_processor.js` worklet, wires waveform canvas.
2. `audio_processor.js` runs in the worklet thread:
   - Tracks background RMS via slow EMA (0.03 blend factor).
   - Fires `onset_start` message when RMS spikes 5× above EMA (absolute floor 0.008).
   - Collects 200ms of samples, sends `onset` message with audio buffer.
   - Cooldown dead-zone after each hit (default 400ms, adjustable).
3. Worklet message handler in `audio.js`:
   - `onset_start` → flash overlay + record timestamp
   - `onset` → `classify(audio, onsetTs)` from `model.js`
4. `model.js:classify` → mel spectrogram → model inference → `updateUI(scores, onsetTs)` (ui.js).
5. `ui.js:updateUI` writes `state.lastDetection`; `game.js:gameLoop` reads it on the next frame and calls `handleSoundInput()` for scoring.

## Game State Machine

- `game.mode`: `'infinite' | 'timed'`
- `game.phase`: `'setup' | 'countdown' | 'timed-playing' | 'playing' | 'ended'`
- `state.isListening`, `state.isTesting` — pipeline-level flags

Desktop (≥600px viewport): boxes flow right → left, judgment line at 28% from left.
Mobile (<600px viewport): boxes flow top → bottom, horizontal judgment line at 65% height.
Mode is decided in `game.js:initGame()` by reading `window.innerWidth`.

## Adding/Changing Code

- **New UI text on home page**: edit [index.html](index.html) + [css/home.css](css/home.css).
- **New adjustable param**: add to `game` object in [js/game.js](js/game.js), add `adjust*()` function, add button with `data-action`/`data-delta` in [index.html](index.html), wire in [js/main.js](js/main.js) `ADJUST` map.
- **Tweak detection sensitivity**: edit `_ONSET_RATIO` or `_MIN_RMS` in [audio_processor.js](audio_processor.js).
- **New scoring tier**: edit `SCORE_TIERS` in [js/game.js](js/game.js).
