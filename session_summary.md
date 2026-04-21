# Session Summary — Day 3 Implementation

## Where We Started

Phase 0 was already complete: a working single-file classifier (`index.html`) using TF Speech Commands that recognises Kick (B), Hihat (t), and Snare (K) in real-time. The user had just finished training an updated model on Teachable Machine with 50 samples per class.

---

## What Was Built

### Game mechanic (Day 3)
- Sound boxes scroll **right-to-left** on a horizontal dotted track
- A fixed red **judgment line** sits at ~28% from the left edge
- Pattern loops infinitely: **B → t → K → t**
- When a box aligns with the line, player makes the matching sound
- Score tiers based on timing accuracy:
  - **PERFECT!** ±12px
  - **EXCELLENT!** ±30px
  - **GREAT!** ±55px
  - **GOOD!** ±80px
  - **NOT BAD** ±110px
  - **MISSED!** — box passed without a matching detection
- Full-screen game view replaces the classifier UI while playing; HUD shows last detected sound + confidence
- **■ Stop** button (top-right) returns to classifier view

### Latency compensation
- The TF Speech Commands classifier fires **300–500ms after** the user makes a sound
- Compensation formula: `compensatedX = box.x + (latencyOffsetMs / 1000 * speed)`
  - Rewinds the box to where it was when the sound was actually made, before scoring
- The **miss threshold** is also widened by the same pixel amount to avoid premature misses
- Tunable via **− / +** buttons (50ms steps, range 0–800ms) shown in the HUD
- Default: **400ms**

---

## Mistakes Made — Do Not Repeat

### 1. Wrong initial game mechanic
**What happened:** First implementation had a ball moving *left-to-right* toward a fixed obstacle. The correct design (shown in user's screenshot) was boxes scrolling *right-to-left* toward a fixed judgment line.  
**Lesson:** Always ask for or confirm the visual design before implementing game mechanics. A mockup/screenshot beats a text description.

### 2. `pointer-events: none` on parent blocked child button clicks
**What happened:** `#hud` had `pointer-events: none` (to prevent it from blocking canvas), which silently disabled all click events on the latency +/− buttons inside it.  
**Lesson:** When adding interactive elements inside a `pointer-events: none` container, explicitly set `pointer-events: all` on those children. Always test button clicks after adding overlays.

### 3. Duplicate `display: block` line in `startGame`
**What happened:** `document.getElementById("game-view").style.display = "block"` was written twice consecutively.  
**Lesson:** Minor, but caught by a quick grep check. Run a post-edit sanity check on new functions.

---

## Architecture Notes

- **Single file**: all logic, styles, and game code live in `index.html`. No bundler, no npm.
- **Model**: loaded from `/my_model/` (3 files: `model.json`, `weights.bin`, `metadata.json`)
- **Class labels** in `metadata.json`: `["Background Noise", "Hihat", "Kick", "Snare"]`
- **`CLASS_MAP`** in script must exactly match `metadata.json` wordLabels — update both when retraining
- **`lastDetection`** global (`{ label, ts }`) is written in `updateUI` whenever confidence ≥ 0.75; the game loop reads it each frame to detect new inputs
- **Game loop** uses `requestAnimationFrame`; `dt` is capped at 100ms to prevent spiral-of-death on tab hide/restore

---

## Tuning Reference

| Parameter | Location | Effect |
|---|---|---|
| `game.speed` | game object | How fast boxes scroll (px/s) |
| `game.spacing` | game object | Gap between consecutive boxes |
| `game.latencyOffsetMs` | game object / HUD buttons | Classifier latency compensation |
| `DISPLAY_THRESHOLD` | CONFIG section | Min confidence to register a sound (default 0.75) |
| `SCORE_TIERS[*].maxPx` | game section | Hit window sizes per tier |

---

## Next Steps (from Roadmap)

- **Day 4**: Add a second obstacle type requiring `t` (Hihat) — confirm multi-sound mechanic works
- **Day 5**: Give it to 2 friends to try silently — watch what confuses them
- **Phase 1 decision point**: Is the core mechanic fun? If yes, proceed to Phase 1 planning
