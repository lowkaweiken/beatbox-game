# Lessons Learned — Beatbox CNN Classifier

Training went through four model collapses (25.5% → 29.7% → 39.8% → **99.2%**) before converging. Each collapse had a distinct root cause.

---

## 1. `ref=np.max` in `power_to_db` cancels all amplitude information

**Problem:** Using `librosa.power_to_db(mel, ref=np.max)` normalizes each sample to its own loudest bin. Every sample — Background silence included — ends up with the same brightness range. The model cannot learn loudness as a feature.

**Fix:** Use `ref=1.0` to preserve absolute loudness. Background stays dark; percussion stays bright.

```python
# Wrong
mel_db = librosa.power_to_db(mel, ref=np.max)

# Correct
mel_db = librosa.power_to_db(mel, ref=1.0)
```

---

## 2. dB floor must sit above ambient room noise

**Problem:** A floor of -80 dB made ambient room noise (~-60 dB) visible at brightness 0.25 ((-60+80)/80). Background class looked non-zero to the model.

**Fix:** Set floor to -50 dB. Room noise at -60 dB clips to 0 → Background spectrograms are visually and numerically black.

```python
DB_FLOOR = -50.0
mel_db = np.maximum(mel_db, DB_FLOOR)
return (mel_db - DB_FLOOR) / (-DB_FLOOR)  # maps [-50, 0] → [0, 1]
```

---

## 3. Peak normalization threshold must cover all percussion, not just loud hits

**Problem:** Threshold at 0.15 left some Hihat samples (peak ~0.12) unnormalized, creating amplitude inconsistency within the class.

**Fix:** Lower threshold to 0.05. Anything above 0.05 is a real percussion hit. Background peaks ~0.001 and stays unnormalized.

```python
peak = np.max(np.abs(audio))
if peak > 0.05:
    audio = audio / peak
```

---

## 4. Background auto-split captures accidental events

**Problem:** The 2-second background recording auto-splits into ~13 × 150ms chunks. Accidental taps, coughs, or rustling contaminate some chunks with onset events, making background samples look like percussion.

**Fix:** Reject any Background sample with peak > 0.02 before adding to the dataset.

```python
if cls == 'Background':
    if np.max(np.abs(audio_peek)) > 0.02:
        skipped_bg += 1
        continue
```

---

## 5. BatchNorm causes Background → dominant-class collapse

**Problem:** Background produces near-zero ReLU activations across all Conv layers. BatchNorm normalizes these relative to the batch mean/variance, artificially amplifying them and making silent input look like percussion. The model then defaults to whichever class has the highest bias.

**Fix:** Remove all BatchNorm layers. The model learns from raw activation magnitudes.

```python
# Removed: tf.keras.layers.BatchNormalization()
```

---

## 6. Recording technique must match in-game player behavior

**Problem:** First 60 Kick samples were recorded as vocalized "BUH" (with voice), which has vocal formants. Players will perform an unvocalized lip-pop with no formants. The model would train on the wrong distribution.

**Fix:** All Kick samples re-recorded as unvocalized lip-pops. Guide text updated. Verified spectrally that formant bands are absent.

**Class techniques that matter:**
| Class | Technique | Key distinction |
|---|---|---|
| Kick | Unvocalized "B" — lips pressed, air burst, NO voice | No vocal formants |
| Hihat | Pure outward "TS" — tongue tip + air, NO tongue click at onset | High-freq hiss only |
| Snare | Inward "K" — tongue click + inward breath | Broader spectrum than Hihat, click transient |
| Background | Complete silence | Peaks < 0.001 |

---

## 7. Diagnostic cells reveal data problems before training

Adding class-mean spectrogram plots (cell 4c) and brightest-Background plots (cell 4d) exposed all of the above issues visually before any training run. Running diagnostics first would have saved multiple training cycles.

**Recommended diagnostic sequence:**
1. Plot 2 random samples per class — check individual sample quality
2. Plot class-mean spectrograms — check inter-class separability
3. Print per-class RMS/peak stats — check amplitude consistency
4. Plot N brightest Background samples — check for event contamination

---

## Final working configuration

```python
SAMPLE_RATE = 44100
DURATION_MS = 200
N_MELS = 64
N_FFT = 1024
HOP_LENGTH = 256
DB_FLOOR = -50.0
PEAK_THRESHOLD = 0.05
BG_PEAK_REJECT = 0.02
```

Result: **99.2% validation accuracy** (127/128 correct) with 150 samples per class.

---

# Lessons Learned — Game UI / UX (index.html)

## 8. `justify-content: center` + `overflow: hidden` clips content on short viewports

**Problem:** `body { display:flex; justify-content:center; overflow:hidden }` centers the `.wrapper` vertically but makes content above the viewport fold unreachable — no scrollbar appears, and elements just disappear off-screen on short displays.

**Fix:** Remove `justify-content: center` from the flex container. Use `margin: auto 0` on the child (`.wrapper`) instead, and set `overflow-y: auto` on `body`. Content centers when space allows and scrolls from the top when it doesn't.

```css
body { overflow-x: hidden; overflow-y: auto; /* no justify-content: center */ }
.wrapper { margin: auto 0; padding: 36px 0; }
```

---

## 9. Use `@media (max-height)` queries to compact UI on short viewports

**Problem:** Fixed padding and font sizes look fine on tall screens but overflow short-viewport windows (laptops, landscape mobile).

**Fix:** Add progressive `max-height` breakpoints that reduce gaps, paddings, and font sizes:

```css
@media (max-height: 820px) { .wrapper { gap: 16px; padding: 24px 0; } /* ... */ }
@media (max-height: 650px) { .wrapper { gap: 10px; padding: 16px 0; } /* ... */ }
```

Pair with `clamp()` on font sizes for smooth scaling between breakpoints.

---

## 10. Pre-fill game boxes from the right when entering timed-playing phase

**Problem:** When countdown ends and `timed-playing` starts, `game.boxes` is empty — the screen is blank until boxes scroll in naturally. At 80 BPM this is a multi-second wait.

**Fix:** At the countdown→timed-playing transition, spawn 8 boxes starting from the right edge of the canvas:

```javascript
game.boxes = [];
for (let i = 0; i < 8; i++) {
  spawnBox(game.cssW + game.boxSize / 2 + i * game.spacing);
}
```

This fills the pipe so boxes immediately start crossing the judgment line.

---

## 11. Reuse existing audio pipeline when transitioning from mic test to game

**Problem:** If the user tested the mic on the home page, clicking "Start Game" would try to create a second `AudioContext` and load the model again — causing errors or silent failures.

**Fix:** Track mic test state with `isTesting`. In `startMode()`, detect `isTesting === true`, cancel only the home-page waveform `requestAnimationFrame`, and proceed directly to the game without reinitializing the audio pipeline:

```javascript
async function startMode(selectedMode) {
  game.mode = selectedMode;
  if (isTesting) {
    isTesting = false;
    if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
    // pipeline already live — skip mic/model init, go straight to game
    return;
  }
  // full init path ...
}
```

---

## 12. Param modal syncs to current game settings so "Play Again" restores last values

**Problem:** If the param modal always showed defaults, "Play Again" would reset the user's tuned BPM/latency/hitbox/cooldown settings.

**Fix:** Call `syncParamModal()` before showing the modal. This reads the live `game.*` values and writes them into the modal display spans:

```javascript
function syncParamModal() {
  setEl('modal-bpm-display', game.bpm + ' BPM');
  setEl('modal-latency-display', game.latencyOffsetMs + 'ms');
  setEl('modal-hitbox-display', MISS_THRESHOLD + 'px');
  setEl('modal-cooldown-display', game.cooldownMs + 'ms');
}
```
