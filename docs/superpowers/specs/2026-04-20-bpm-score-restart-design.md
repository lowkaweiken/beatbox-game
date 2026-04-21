# Design: BPM Control, Scoring Points, Total Score & Restart

**Date:** 2026-04-20  
**Status:** Approved

---

## Overview

Add three features to the existing scrolling sound-box game in `index.html`:

1. **BPM control** — +/− buttons in the left HUD adjust box scroll speed so boxes arrive at the judgment line at the correct musical tempo
2. **Point scoring** — each timing tier awards a fixed point value; a running total is tracked in `game.totalScore`
3. **Total Score display** — large centered number at the top of the game view
4. **Restart button** — resets score to 0 and reinitializes game state without reloading the model

---

## BPM Control

**Location:** Left HUD (`#hud`), below the existing latency `−/+` row.

**Formula:** `game.speed = game.spacing * BPM / 60`

At 80 BPM with spacing=280px: `speed = 280 * 80 / 60 ≈ 373 px/s`

| Parameter | Value |
|---|---|
| Default BPM | 80 |
| Step size | 5 BPM |
| Range | 40–200 BPM |

Changing BPM takes effect immediately (updates `game.speed` live). The latency compensation formula already uses `game.speed`, so it remains accurate after BPM changes.

**HTML addition** (inside `#hud`, below `#latency-ctrl`):
```html
<div id="bpm-ctrl">
  <button onclick="adjustBPM(-5)">−</button>
  <span id="bpm-display">80 BPM</span>
  <button onclick="adjustBPM(+5)">+</button>
</div>
```

**New globals:**
- `game.bpm = 80` — current BPM value

**New function:**
```js
function adjustBPM(delta) {
  game.bpm = Math.max(40, Math.min(200, game.bpm + delta));
  game.speed = game.spacing * game.bpm / 60;
  document.getElementById('bpm-display').textContent = game.bpm + ' BPM';
}
```

---

## Point Scoring

**Tier points** added to `SCORE_TIERS`:

| Tier | maxPx | Points |
|---|---|---|
| PERFECT! | 12 | 10 |
| EXCELLENT! | 30 | 8 |
| GREAT! | 55 | 6 |
| GOOD! | 80 | 4 |
| NOT BAD! | 110 | 2 |
| MISSED! | — | 0 |

**New global:** `game.totalScore = 0`

**`handleSoundInput` change:** After finding a matching tier, add `tier.points` to `game.totalScore` and call `updateScoreDisplay()`.

**MISSED handling:** When a box is marked missed, call `updateScoreDisplay()` — score does not change (no deduction), but display re-renders (verdict flash still shows "MISSED!").

---

## Total Score Display

**Location:** Centered horizontally at top of `#game-view`.

**HTML addition** (inside `#game-view`):
```html
<div id="score-display">
  <div id="score-label">SCORE</div>
  <div id="score-value">0</div>
</div>
```

**CSS:**
```css
#score-display {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  text-align: center;
  pointer-events: none;
}
#score-label {
  font-size: 0.6rem;
  letter-spacing: 0.3em;
  color: var(--muted);
  text-transform: uppercase;
}
#score-value {
  font-family: var(--font-display);
  font-size: 2rem;
  color: var(--accent);
  letter-spacing: 0.1em;
  line-height: 1;
}
```

**Update function:**
```js
function updateScoreDisplay() {
  document.getElementById('score-value').textContent = game.totalScore;
}
```

---

## Restart Button

**Location:** Top-right, alongside the existing `■ Stop` button.

**HTML:** Add a second button next to `#stop-btn`:
```html
<button id="restart-btn" onclick="restartGame()">▶ RESTART</button>
```

**Styling:** Same style as `#stop-btn` but uses `var(--accent)` color on hover.

**`restartGame()` function:**
```js
function restartGame() {
  game.totalScore = 0;
  updateScoreDisplay();
  initGame();  // clears boxes, resets patternIdx, lastTime, verdict
}
```

`initGame()` already resets boxes, patternIdx, lastTime, lastSoundTs, and verdict. Only `game.totalScore` needs explicit reset here. The recognizer keeps listening — no model reload.

---

## Files Changed

- `index.html` only — all changes are self-contained in the single-file app

## What Does NOT Change

- Latency compensation logic — unchanged, already uses `game.speed` dynamically
- SCORE_TIERS `maxPx` values — unchanged
- `PATTERN`, `CLASS_MAP`, model loading — unchanged
- Stop button behavior — unchanged
