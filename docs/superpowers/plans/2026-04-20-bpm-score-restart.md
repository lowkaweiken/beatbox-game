# BPM Control, Scoring & Restart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add BPM-driven scroll speed control, point-based scoring with a total score display, and a restart button to the beatbox game.

**Architecture:** All changes are self-contained in `index.html`. BPM sets `game.speed` via `spacing * BPM / 60`. A `game.totalScore` accumulates points from `SCORE_TIERS[*].points`. Score display and BPM control are new HTML elements wired into existing game functions.

**Tech Stack:** Vanilla JS, HTML/CSS — no build step. Serve with `python -m http.server 8000`.

---

## File Map

| File | Changes |
|---|---|
| `index.html` | All changes — CSS additions, HTML additions inside `#game-view` and `#hud`, JS modifications to `game` object, `SCORE_TIERS`, `initGame`, `handleSoundInput`, new functions `adjustBPM`, `updateScoreDisplay`, `restartGame` |

---

### Task 1: Drive `game.speed` from BPM

**Files:**
- Modify: `index.html` — `game` object and `initGame()`

- [ ] **Step 1: Update the `game` object** — replace the hardcoded `speed` with a `bpm` field and derive speed from it.

  Find this in `index.html` (around line 757):
  ```js
  const game = {
    boxes: [],
    patternIdx: 0,
    speed: 200,      // px/s — boxes scroll left at this speed
    spacing: 280,    // px between box centres
  ```
  Replace with:
  ```js
  const game = {
    boxes: [],
    patternIdx: 0,
    bpm: 80,
    speed: 373,      // px/s — derived from bpm: spacing * bpm / 60
    spacing: 280,    // px between box centres
  ```

- [ ] **Step 2: Re-derive speed in `initGame`** so that restarting always uses the current BPM.

  Find this in `initGame()`:
  ```js
  function initGame() {
    const canvas = document.getElementById('game-canvas');
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    game.judgeX = Math.round(canvas.width * 0.28);
    game.trackY = Math.round(canvas.height * 0.5);
    game.boxes = [];
    game.patternIdx = 0;
    game.lastTime   = null;
    game.lastSoundTs = 0;
    game.verdict    = null;
  ```
  Replace with:
  ```js
  function initGame() {
    const canvas = document.getElementById('game-canvas');
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    game.judgeX = Math.round(canvas.width * 0.28);
    game.trackY = Math.round(canvas.height * 0.5);
    game.speed  = game.spacing * game.bpm / 60;
    game.boxes = [];
    game.patternIdx = 0;
    game.lastTime   = null;
    game.lastSoundTs = 0;
    game.verdict    = null;
  ```

- [ ] **Step 3: Verify in browser** — start the server (`python -m http.server 8000`), open `http://localhost:8000`, click Start. Boxes should scroll noticeably faster than before (373 px/s vs old 200 px/s). No errors in console.

- [ ] **Step 4: Commit**
  ```bash
  git add index.html
  git commit -m "feat: derive game.speed from BPM (default 80 BPM)"
  ```

---

### Task 2: BPM Control UI

**Files:**
- Modify: `index.html` — CSS, HTML inside `#hud`, new `adjustBPM` function

- [ ] **Step 1: Add CSS for `#bpm-ctrl`** — same style as the existing `#latency-ctrl`.

  Find this in the `<style>` block:
  ```css
  #latency-ctrl button:hover { border-color: var(--accent); color: var(--accent); }
  ```
  Replace with:
  ```css
  #latency-ctrl button:hover { border-color: var(--accent); color: var(--accent); }

    #bpm-ctrl {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
      pointer-events: all;
    }

    #bpm-ctrl button {
      background: transparent;
      border: 1px solid var(--muted);
      color: var(--muted);
      font-family: var(--font-mono);
      font-size: 0.7rem;
      width: 22px;
      height: 22px;
      cursor: pointer;
      border-radius: 2px;
      line-height: 1;
    }

    #bpm-ctrl button:hover { border-color: var(--accent); color: var(--accent); }
  ```

- [ ] **Step 2: Add BPM control HTML** inside `#hud`, below `#latency-ctrl`.

  Find this in `#hud`:
  ```html
      <div id="latency-ctrl">
        <button onclick="adjustLatency(-50)">−</button>
        <span id="latency-display">400ms</span>
        <button onclick="adjustLatency(+50)">+</button>
      </div>
    </div>
  ```
  Replace with:
  ```html
      <div id="latency-ctrl">
        <button onclick="adjustLatency(-50)">−</button>
        <span id="latency-display">400ms</span>
        <button onclick="adjustLatency(+50)">+</button>
      </div>
      <div id="bpm-ctrl">
        <button onclick="adjustBPM(-5)">−</button>
        <span id="bpm-display">80 BPM</span>
        <button onclick="adjustBPM(+5)">+</button>
      </div>
    </div>
  ```

- [ ] **Step 3: Add `adjustBPM` function** — place it directly after the `adjustLatency` function.

  Find:
  ```js
    function adjustLatency(delta) {
      game.latencyOffsetMs = Math.max(0, Math.min(800, game.latencyOffsetMs + delta));
      document.getElementById('latency-display').textContent = game.latencyOffsetMs + 'ms';
    }
  ```
  Replace with:
  ```js
    function adjustLatency(delta) {
      game.latencyOffsetMs = Math.max(0, Math.min(800, game.latencyOffsetMs + delta));
      document.getElementById('latency-display').textContent = game.latencyOffsetMs + 'ms';
    }

    function adjustBPM(delta) {
      game.bpm = Math.max(40, Math.min(200, game.bpm + delta));
      game.speed = game.spacing * game.bpm / 60;
      document.getElementById('bpm-display').textContent = game.bpm + ' BPM';
    }
  ```

- [ ] **Step 4: Verify in browser** — start the game, click the BPM `+` and `−` buttons in the HUD. Boxes should visibly speed up / slow down. The BPM display should update (80 BPM → 85 BPM → etc). Both `−` and `+` buttons must be clickable (pointer-events must work).

- [ ] **Step 5: Commit**
  ```bash
  git add index.html
  git commit -m "feat: add BPM control to game HUD"
  ```

---

### Task 3: Total Score Display

**Files:**
- Modify: `index.html` — CSS, HTML inside `#game-view`, `game` object, `initGame`, new `updateScoreDisplay` function

- [ ] **Step 1: Add CSS for `#score-display`**.

  Find this in the `<style>` block:
  ```css
    #verdict.show-fail {
      opacity: 1;
      color: var(--accent2);
      text-shadow: 0 0 40px rgba(255,60,110,0.7);
    }
  ```
  Replace with:
  ```css
    #verdict.show-fail {
      opacity: 1;
      color: var(--accent2);
      text-shadow: 0 0 40px rgba(255,60,110,0.7);
    }

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

- [ ] **Step 2: Add `#score-display` HTML** inside `#game-view`, after the canvas.

  Find:
  ```html
    <div id="game-view">
      <canvas id="game-canvas"></canvas>
      <div id="hud">
  ```
  Replace with:
  ```html
    <div id="game-view">
      <canvas id="game-canvas"></canvas>
      <div id="score-display">
        <div id="score-label">SCORE</div>
        <div id="score-value">0</div>
      </div>
      <div id="hud">
  ```

- [ ] **Step 3: Add `totalScore` to the `game` object**.

  Find (the line you edited in Task 1):
  ```js
    bpm: 80,
    speed: 373,      // px/s — derived from bpm: spacing * bpm / 60
    spacing: 280,    // px between box centres
  ```
  Replace with:
  ```js
    bpm: 80,
    speed: 373,      // px/s — derived from bpm: spacing * bpm / 60
    spacing: 280,    // px between box centres
    totalScore: 0,
  ```

- [ ] **Step 4: Reset `totalScore` in `initGame`**.

  Find (inside `initGame`, the block you edited in Task 1):
  ```js
    game.speed  = game.spacing * game.bpm / 60;
    game.boxes = [];
    game.patternIdx = 0;
    game.lastTime   = null;
    game.lastSoundTs = 0;
    game.verdict    = null;
  ```
  Replace with:
  ```js
    game.speed  = game.spacing * game.bpm / 60;
    game.boxes = [];
    game.patternIdx = 0;
    game.lastTime   = null;
    game.lastSoundTs = 0;
    game.verdict    = null;
    game.totalScore = 0;
  ```

- [ ] **Step 5: Add `updateScoreDisplay` function** — place it after `adjustBPM`.

  Find:
  ```js
    function adjustBPM(delta) {
      game.bpm = Math.max(40, Math.min(200, game.bpm + delta));
      game.speed = game.spacing * game.bpm / 60;
      document.getElementById('bpm-display').textContent = game.bpm + ' BPM';
    }
  ```
  Replace with:
  ```js
    function adjustBPM(delta) {
      game.bpm = Math.max(40, Math.min(200, game.bpm + delta));
      game.speed = game.spacing * game.bpm / 60;
      document.getElementById('bpm-display').textContent = game.bpm + ' BPM';
    }

    function updateScoreDisplay() {
      document.getElementById('score-value').textContent = game.totalScore;
    }
  ```

- [ ] **Step 6: Verify in browser** — start the game. "SCORE" label and "0" should appear centered at the top of the game screen. It should not overlap the HUD (left) or Stop button (right).

- [ ] **Step 7: Commit**
  ```bash
  git add index.html
  git commit -m "feat: add total score display centered at top of game view"
  ```

---

### Task 4: Point Values and Live Scoring

**Files:**
- Modify: `index.html` — `SCORE_TIERS` array, `handleSoundInput` function

- [ ] **Step 1: Add `points` to `SCORE_TIERS`**.

  Find:
  ```js
    const SCORE_TIERS = [
      { label: 'PERFECT!',   maxPx: 12,  color: '#ffffff' },
      { label: 'EXCELLENT!', maxPx: 30,  color: '#00ff9d' },
      { label: 'GREAT!',     maxPx: 55,  color: '#ffe600' },
      { label: 'GOOD!',      maxPx: 80,  color: '#ffe600' },
      { label: 'NOT BAD',    maxPx: 110, color: '#888899' },
    ];
  ```
  Replace with:
  ```js
    const SCORE_TIERS = [
      { label: 'PERFECT!',   maxPx: 12,  color: '#ffffff', points: 10 },
      { label: 'EXCELLENT!', maxPx: 30,  color: '#00ff9d', points: 8  },
      { label: 'GREAT!',     maxPx: 55,  color: '#ffe600', points: 6  },
      { label: 'GOOD!',      maxPx: 80,  color: '#ffe600', points: 4  },
      { label: 'NOT BAD!',   maxPx: 110, color: '#888899', points: 2  },
    ];
  ```
  _(Note: label updated from `'NOT BAD'` to `'NOT BAD!'` to match the spec.)_

- [ ] **Step 2: Award points in `handleSoundInput`**.

  Find:
  ```js
      if (tier) {
        closest.scored = true;
        game.verdict = { text: tier.label, color: tier.color, expiresAt: Date.now() + 750 };
      }
  ```
  Replace with:
  ```js
      if (tier) {
        closest.scored = true;
        game.totalScore += tier.points;
        updateScoreDisplay();
        game.verdict = { text: tier.label, color: tier.color, expiresAt: Date.now() + 750 };
      }
  ```

- [ ] **Step 3: Verify in browser** — play the game and make sounds. After each successful hit the score at the top should increment: PERFECT adds 10, GREAT adds 6, etc. MISSED should not change the score.

- [ ] **Step 4: Commit**
  ```bash
  git add index.html
  git commit -m "feat: assign point values to score tiers and accumulate total score"
  ```

---

### Task 5: Restart Button

**Files:**
- Modify: `index.html` — CSS, HTML (top-right of `#game-view`), new `restartGame` function

- [ ] **Step 1: Add CSS for the top-right button group and `#restart-btn`**.

  Find:
  ```css
    #stop-btn {
      position: absolute;
      top: 20px;
      right: 24px;
      background: transparent;
      border: 1px solid var(--muted);
      color: var(--muted);
      font-family: var(--font-mono);
      font-size: 0.65rem;
      letter-spacing: 0.2em;
      padding: 6px 14px;
      cursor: pointer;
      text-transform: uppercase;
      border-radius: 3px;
    }

    #stop-btn:hover {
      border-color: var(--accent2);
      color: var(--accent2);
    }
  ```
  Replace with:
  ```css
    #top-right-btns {
      position: absolute;
      top: 20px;
      right: 24px;
      display: flex;
      gap: 8px;
    }

    #stop-btn, #restart-btn {
      background: transparent;
      border: 1px solid var(--muted);
      color: var(--muted);
      font-family: var(--font-mono);
      font-size: 0.65rem;
      letter-spacing: 0.2em;
      padding: 6px 14px;
      cursor: pointer;
      text-transform: uppercase;
      border-radius: 3px;
    }

    #stop-btn:hover {
      border-color: var(--accent2);
      color: var(--accent2);
    }

    #restart-btn:hover {
      border-color: var(--accent);
      color: var(--accent);
    }
  ```

- [ ] **Step 2: Wrap Stop in a container and add Restart button**.

  Find:
  ```html
      <button id="stop-btn" onclick="toggleListen()">■ Stop</button>
  ```
  Replace with:
  ```html
      <div id="top-right-btns">
        <button id="restart-btn" onclick="restartGame()">▶ RESTART</button>
        <button id="stop-btn" onclick="toggleListen()">■ Stop</button>
      </div>
  ```

- [ ] **Step 3: Add `restartGame` function** — place it after `stopGame`.

  Find:
  ```js
    function stopGame() {
      if (game.rafId) { cancelAnimationFrame(game.rafId); game.rafId = null; }
      document.getElementById('game-view').style.display = 'none';
      document.querySelector('.wrapper').style.display = 'flex';
    }
  ```
  Replace with:
  ```js
    function stopGame() {
      if (game.rafId) { cancelAnimationFrame(game.rafId); game.rafId = null; }
      document.getElementById('game-view').style.display = 'none';
      document.querySelector('.wrapper').style.display = 'flex';
    }

    function restartGame() {
      if (game.rafId) cancelAnimationFrame(game.rafId);
      initGame();
      updateScoreDisplay();
      game.rafId = requestAnimationFrame(gameLoop);
    }
  ```

- [ ] **Step 4: Verify in browser** — play until you accumulate some score, then click RESTART. Score resets to 0, boxes reset, game continues without reloading the model. Stop button still works. Both buttons are clickable (not blocked by pointer-events).

- [ ] **Step 5: Commit**
  ```bash
  git add index.html
  git commit -m "feat: add restart button that resets score and reinitializes game"
  ```

---

## Self-Review

**Spec coverage:**
- ✅ BPM control +/- → Task 2 (`adjustBPM`, `#bpm-ctrl`)
- ✅ BPM changes interval (scroll speed) → Task 1 (`game.speed = spacing * bpm / 60`)
- ✅ PERFECT=10, EXCELLENT=8, GREAT=6, GOOD=4, NOT BAD!=2, MISSED=0 → Task 4 (`SCORE_TIERS[*].points`)
- ✅ Total Score at top of screen → Task 3 (`#score-display`, `updateScoreDisplay`)
- ✅ Restart resets score to 0 → Task 5 (`restartGame`) + Task 3 (`initGame` resets `totalScore`)

**Placeholder scan:** No TBDs. All code blocks are complete. ✓

**Type consistency:**
- `game.totalScore` — defined in Task 3, used in Task 4 ✓
- `updateScoreDisplay()` — defined in Task 3, called in Task 4 and Task 5 ✓
- `game.bpm` — defined in Task 1, used in Task 2 (`adjustBPM`) ✓
- `initGame()` — modified in Task 1 and Task 3; both edits target different lines, no conflict ✓
- `restartGame()` — defined in Task 5, referenced in HTML added in Task 5 ✓
