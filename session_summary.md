# Session Summary — Migration to Custom Pipeline

## Where We Left Off (from previous session)

Phase 0 complete: working single-file classifier (`index.html`) using TF Speech Commands. Full game mechanic built — boxes scroll right-to-left, judgment line scoring with latency compensation (default 400ms). Session summary for that work is preserved below under **Day 3**.

---

## This Session — Phase 1 & 2 of Custom Pipeline

### Goal
Replace Teachable Machine's 1-second rolling window with a custom onset detector + micro CNN for millisecond-level responsiveness at high BPM.

### What Was Built

#### `data_collector.html` (complete)
- Mobile-first, vanilla JS + Web Audio API
- Mandatory **Start Module** button to unblock iOS Safari audio context
- **Onset detector** (ScriptProcessor watching RMS threshold) auto-captures 150ms slices for Kick / Hihat / Snare
- **Background is different**: tap-to-capture mode (no onset needed). Records 2 seconds and auto-splits into ~13 × 150ms chunks per tap
- Sensitivity slider to tune onset threshold
- Live volume bar (green → red when threshold exceeded)
- **Play Last** and **Discard Last** buttons for reviewing/removing samples
- JSZip export → `beatbox_samples.zip` (folder structure: `Kick/`, `Hihat/`, `Snare/`, `Background/`)
- Web Share API on mobile (AirDrop/WhatsApp), falls back to download on desktop

#### `train.ipynb` (complete but needs fix — see below)
- Originally written for Google Colab; user is running locally in VS Code Jupyter
- **Cell 1**: `!pip install librosa tensorflowjs scikit-learn -q` — pip not on PATH in this kernel, needs `import sys; !{sys.executable} -m pip install ...`
- **Cell 2**: Uses `from google.colab import files` — must be removed for local use; samples are already in `samples/` folder locally
- **Cell 10**: Also uses `files.download()` — must be removed; output is already in `new_model/` locally
- Mel spectrogram params: `sr=44100, n_mels=64, n_fft=1024, hop_length=256` → input shape `(64, 26, 1)`
- Model: 3× Conv2D + BatchNorm + GlobalAvgPool + Dense(64) + Dropout(0.35) + Dense(4 softmax)
- Exports `new_model/model.json`, `weights.bin`, `metadata.json`

### Dataset Collected
- Kick: ~100 samples
- Hihat: ~100 samples
- Snare: ~100 samples
- Background: ~208 samples (via 2s auto-split)

### Environment
- Machine: Apple M1, Python 3.9.6 (arm64), VS Code with Jupyter extension
- Tried local TF install — hit M1 + numpy 2.x + tensorflowjs/tensorflow_decision_forests version conflicts. Abandoned local pip approach.
- VS Code Jupyter kernel is a separate Python environment — `pip` not on PATH, must use `sys.executable`

---

## Immediate Next Step — (completed in next session)

**Fix `train.ipynb` for local VS Code Jupyter** — two cells need updating:
1. Cell 1: use `sys.executable` for pip install
2. Cell 2: replace Colab upload with local path (samples already in `samples/`)
3. Cell 10: replace `files.download()` with a print statement (model already saved locally)

After notebook runs successfully → share validation accuracy + confusion matrix → proceed to **Phase 3** (wire new model into `index.html`, replace TF Speech Commands with custom AudioWorklet + TF.js inference).

---

## Mistakes Made — Do Not Repeat

### 1. Wrong initial game mechanic (Day 3)
First implementation had a ball moving left-to-right. Correct design was boxes scrolling right-to-left.
**Lesson:** Always confirm visual design before implementing. Ask for mockup/screenshot.

### 2. `pointer-events: none` blocked child buttons (Day 3)
`#hud` had `pointer-events: none`, silently disabling +/− buttons inside it.
**Lesson:** Interactive children inside `pointer-events: none` containers need `pointer-events: all`.

### 3. Colab-specific code in notebook (this session)
`from google.colab import files` and `files.download()` crash in local Jupyter.
**Lesson:** When writing notebooks intended for local use, never import `google.colab`. Use `sys.executable` for pip installs.

---

## Architecture — Current State

- **`index.html`**: game + classifier, loads model from `/my_model/`
- **`data_collector.html`**: standalone data collection tool
- **`train.ipynb`**: trains micro CNN, exports TF.js model to `new_model/`
- **`samples/`**: collected WAV files (Kick, Hihat, Snare, Background)
- **`my_model/`**: current Teachable Machine model (will be replaced by `new_model/` in Phase 3)

### Model output class order (both old and new)
`["Background", "Hihat", "Kick", "Snare"]` — alphabetical

---

---

## This Session — Phase 3 Game UI / UX

### Goals (all completed)
1. Timed mode boxes stream in from right when game starts (not spawn one-by-one)
2. Optimize for mobile view
3. Redesign home page: two buttons (INFINITE MODE, TIMED MODE)
4. Timed mode: parameter modal (BPM, latency, hitbox, cooldown) before game starts
5. "Play Again" → back to param modal with last settings
6. HOME button in report modal → returns to home screen
7. Working mic test on home page (waveform + detection before starting a game)
8. Pipeline reuse: if mic already testing, clicking a mode button skips re-init
9. Fix home page layout clipping on short-viewport screens

### Architecture Changes

**Home page** now has two mode buttons instead of a single Start button.
`startMode('infinite' | 'timed')` handles both paths.

**Mic test** (`isTesting` flag): home-page waveform + detection runs without starting a game.
- `startMicTest()` — loads model + mic, runs waveform loop on home page canvas
- `stopMicTest()` — tears down pipeline, resets UI
- `startMode()` detects `isTesting` and reuses the open pipeline instead of re-initializing

**Param modal** (`#param-modal`): HTML overlay inside game-view, shown before timed game starts.
- `syncParamModal()` writes current game settings into modal display spans before showing
- `startTimedGame()` hides modal and calls `initGame()` + `startCountdown()`
- `playAgain()` re-shows modal with synced settings
- `restartGame()` for timed mode also goes back to param modal

**Report overlay** gained a HOME button (`stopListening()`) alongside PLAY AGAIN.

**Top-right buttons**: RESTART + STOP (mode-switch button removed).

### Key Bug Fixes

| Bug | Root Cause | Fix |
|---|---|---|
| Boxes don't stream in at timed-playing start | `game.boxes = []` cleared on countdown, nothing pre-filled | Spawn 8 boxes from right edge at countdown→timed-playing transition |
| Home page content clipped at bottom | `overflow:hidden` + `justify-content:center` hides overflow | `overflow-y:auto` on body, `margin:auto 0` on `.wrapper` |
| Short viewport still overflows | Fixed padding/font sizes | `@media (max-height: 820px/650px)` progressive compaction |

### CSS Patterns Established
```css
/* Scrollable-but-centered layout */
body { overflow-x: hidden; overflow-y: auto; }
.wrapper { margin: auto 0; padding: 36px 0; }

/* Short-viewport compaction */
@media (max-height: 820px) { .wrapper { gap: 16px; padding: 24px 0; } }
@media (max-height: 650px) { .wrapper { gap: 10px; padding: 16px 0; } }
```

### State Machine (current)
- `game.mode`: `'infinite'` | `'timed'`
- `game.phase`: `'setup'` | `'countdown'` | `'timed-playing'` | `'playing'` | `'ended'`
- `isTesting`: `true` while home-page mic test is active

### Mistakes Made — Do Not Repeat
4. **Boxes empty at timed-playing start** — always pre-fill from right edge at phase transition, not just on spawn tick
5. **Second AudioContext on pipeline reuse** — check `isTesting` before re-initializing; reuse open context

---

## Day 3 Notes (preserved)

### Game mechanic
- Sound boxes scroll right-to-left on a horizontal dotted track
- Fixed red judgment line at ~28% from left edge
- Pattern loops: B → t → K → t
- Score tiers: PERFECT ±12px / EXCELLENT ±30px / GREAT ±55px / GOOD ±80px / NOT BAD ±110px / MISSED
- Latency compensation: `compensatedX = box.x + (latencyOffsetMs / 1000 * speed)`
- Default latency offset: 400ms, tunable via HUD +/− buttons (50ms steps, 0–800ms range)

### Tuning Reference
| Parameter | Location | Effect |
|---|---|---|
| `game.speed` | game object | Box scroll speed (px/s) |
| `game.spacing` | game object | Gap between boxes |
| `game.latencyOffsetMs` | game object / HUD | Classifier latency compensation |
| `DISPLAY_THRESHOLD` | CONFIG | Min confidence to register (default 0.75) |
| `SCORE_TIERS[*].maxPx` | game section | Hit window sizes per tier |
