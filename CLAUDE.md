# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a browser-based beatbox sound classifier (Phase 0) that uses a pre-trained TensorFlow.js model to recognize percussion sounds in real-time: Kick, Hi-Hat, Snare, and Background Noise.

## Running the App

There is no build system. Serve statically and open in a browser:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

The model must be served from the same origin — it loads from `/my_model/` relative to the server root.

## Architecture

**Single-file app**: all logic lives in [index.html](index.html) with embedded `<style>` and `<script>` blocks. No bundler, no npm.

**Dependencies** (CDN, not installed locally):
- TensorFlow.js 1.3.1 — tensor ops and inference
- TensorFlow Speech Commands 0.4.0 — BROWSER_FFT audio preprocessing + `recognizer.listen()` loop

**Data flow**:
1. User clicks Start → `toggleListen()` initializes the `speechCommands` recognizer from `/my_model/`
2. `recognizer.listen(callback, { probabilityThreshold })` fires on each audio window
3. Callback calls `updateUI(classLabels, scores)` → updates detection symbol, confidence bars, and waveform canvas

**Key globals**:
- `recognizer` — the TF Speech Commands model instance
- `CLASS_MAP` — maps model label strings to display symbols (`"Kick"→"B"`, `"Hihat"→"t"`, `"Snare"→"K"`)
- Detection threshold: `0.75` (hardcoded in `recognizer.listen` call)

## Model

Pre-trained CNN at [my_model/](my_model/):
- Input: 43×232×1 mel spectrogram
- Output: 4-class softmax — `["Background Noise", "Hihat", "Kick", "Snare"]`
- Weights: `weights.bin` (5.7 MB), topology: `model.json`, labels: `metadata.json`

To swap the model, replace these three files and update `CLASS_MAP` if class names change.
