# Beatbox Rhythm Runner — Feasibility & Phased Roadmap

## TL;DR

**Is this feasible? Yes — with caveats.** The core technology you need (real-time classification of beatbox sounds from a microphone in a browser) is an active area of research with working implementations going back to 2005 and accuracies ranging from ~72% for amateur CNN projects to ~95% for well-tuned academic systems. Google's Teachable Machine can get you a playable prototype in a weekend. The hard problems are not "can the model recognize a kick drum" — they're **latency**, **onset-to-label timing** (critical for a Guitar Hero-style hitbox mechanic), **user variation** (everyone's kick drum sounds different), and **mobile microphone realities**.

The realistic production target: a **5-class system** (Kick `B`, Hi-hat `t`, Snare `K`/`Pf`, plus one or two advanced sounds) with ~85–90% accuracy, ~50–80ms detection latency, and a per-user calibration step. TikTok-viral quality is achievable; arcade-perfect is not, but you don't need arcade-perfect to win.

---

## 1. How the Technology Actually Works

Your game breaks down into four technical problems, in order:

1. **Capture** audio from the user's microphone (Web Audio API / `getUserMedia`)
2. **Detect an onset** — the moment a percussive sound begins
3. **Classify the sound** — which of your N target classes it belongs to
4. **Score it against the hitbox** — how close to the intended window did the user hit, and did they hit the right sound

Problems 2 and 3 are where the ML lives. Problem 4 is ordinary rhythm-game logic (Guitar Hero, osu!, Beat Saber all solved this decades ago).

### The standard pipeline (used by virtually every paper in the space)

Raw audio → onset detection → 1-second (or shorter) window around the onset → convert to spectrogram / MFCC features → feed to a small CNN → softmax over classes → compare top class to the hitbox-required class.

Two important findings from the research worth knowing upfront:

- **Delayed classification helps a lot.** Stowell & Plumbley found that applying a ~23ms delay from the onset before starting the classification window significantly improves accuracy, because the spectral signature of a beatbox sound isn't fully formed at the onset instant itself. This has direct implications for your hit-timing logic.
- **Trained beatboxers produce shorter sounds than amateurs.** Some sounds from experienced beatboxers are under 10ms long, which fights against classification windows sized for amateur input. You'll want to tune your system for your target audience — serving trained beatboxers is a materially harder problem than serving TikTok users trying it for the first time.

### What accuracy numbers can you realistically expect?

Rough ceiling based on the literature, for 4–5 classes:

| Setup | Accuracy | Notes |
|---|---|---|
| Teachable Machine on 8s of samples per class | 60–75% | Fine for POC; falls apart across users |
| Custom CNN, ~200 samples/class, single user | 75–85% | Raphael Khalid's Medium project landed here |
| Custom CNN with AVP-style dataset (28+ users) | 80–90% | Generalizes across users |
| AdaBoost + hand-crafted features, controlled recording | ~95% | The ACE study's result; requires academic setup |
| User-calibrated system (record your own sounds first) | 90%+ | The approach that actually works for a shipped product |

The insight that keeps coming up in the literature: **per-user calibration beats bigger datasets**. A 30-second "teach me your sounds" flow before gameplay is probably going to outperform any general-purpose model you can build.

---

## 2. Feasibility Verdict by Component

**Green lights** — solved problems, just integration work:
- Browser microphone capture
- Spectrogram / MFCC feature extraction (Web Audio API, Meyda.js, Essentia.js)
- CNN inference in the browser (TensorFlow.js)
- Rhythm-game visuals and hit detection (any game engine)
- 4-class classification of distinct beatbox sounds (kick, snare, closed hi-hat, open hi-hat)

**Yellow lights** — doable but needs careful engineering:
- **Latency budget.** Guitar Hero feels responsive because total input-to-visual latency is under ~50ms. Browser audio processing + CNN inference + render typically costs 30–100ms. This works but leaves little margin — you'll need Web Workers / AudioWorklet and a small model.
- **Cross-user generalization.** A kick from a deep-voiced trained beatboxer and a kick from a first-time TikTok user are acoustically different sounds sharing only a label. Solution: per-user calibration or a larger, more diverse training set.
- **Mobile microphones.** iPhone mics auto-gain, compress, and noise-reduce aggressively. Your model trained on MacBook recordings will degrade on phones. You'll need mobile training data.
- **Ambient noise.** Rhythm games are often played in noisy environments. You need a robust "background" class and onset thresholding.

**Red lights** — genuinely hard, plan around them:
- **8+ class fine-grained classification** (distinguishing inward snares from outward snares, throat bass from regular kick, lip rolls, etc.). Research shows this remains open even with deep learning. **Do not promise this in your MVP.**
- **Zero-latency perfect timing for advanced beatboxers.** Pro beatboxers produce sounds in <10ms bursts, which is below a reliable classification window. If your audience is "Swissbeatbox competitors," the tech isn't ready. If it's "people who watched a TikTok," you're fine.

---

## 3. Public Datasets You Can Use

You don't have to collect a dataset from scratch to start.

- **AVP (Amateur Vocal Percussion) Dataset** — 9,780 utterances from 28 participants, labeled for kick drum, snare drum, closed hi-hat, opened hi-hat, with onset annotations. Released under a research license on Zenodo. This is the single most relevant dataset that exists. Crucially it focuses on *amateur* beatboxers, which matches your likely TikTok audience.
- **AVP-LVT Extension** — adds phoneme-level annotations (plosive/fricative onset + vowel/breath coda), useful if you ever want to go beyond 4 classes.
- **Raphael Khalid's 234-sample set** (kick, hi-hat, synth, trumpet, snare) — small, noisy, but publicly documented.
- **Seth Adams / Kaggle vocal drum samples** — a few hundred clips across drum classes.

You'll still need to collect your own data for the sounds the AVP dataset doesn't cover (throat bass, clops, liprolls, etc.) and for mobile-microphone conditions.

---

## 4. Recommended Tech Stack

**For the POC (Phase 1):**
- Google Teachable Machine (audio model) for training
- p5.js + ml5.js for game rendering and model integration
- Host on Glitch, GitHub Pages, or Vercel

**For production (Phase 3+):**
- TensorFlow.js + a custom small CNN (MobileNet-audio-style, under 1MB)
- AudioWorklet for real-time audio processing on a dedicated thread
- Meyda.js or Essentia.js for feature extraction
- React + PixiJS or Phaser for the game layer (SVG/Canvas gets slow for particle-heavy rhythm games)
- Optional: ONNX Runtime Web or TFLite with WebAssembly for faster inference on low-end devices

**For the mobile app (Phase 5):**
- React Native or Flutter with TensorFlow Lite
- Native audio input (AVAudioEngine on iOS, AudioRecord on Android) — do NOT rely on WebViews for the audio path
- On-device inference end-to-end; no server round-trip

---

## 5. Phased Roadmap

### Phase 0 — Validation Spike (1 weekend)

**Goal:** Prove to yourself that *you* can make classifiable beatbox sounds through a consumer microphone in a web browser. No game, no art, nothing.

**Build:**
1. Go to teachablemachine.withgoogle.com, train a 4-class audio model (background, B, t, K) using 30 samples each of your own beatboxing.
2. Export the TF.js model and drop it into a basic HTML page that prints the currently-predicted label.
3. Try it with your phone mic, your laptop mic, in a quiet room, in a noisy room.

**Decision point:** If you're getting 70%+ accuracy in a quiet room with your own voice, the project is green-lit. If not, you either have a mic problem, a sound-consistency problem, or you need a bigger sample count — debug that before writing a single line of game code.

**Deliverable:** A screen recording of the classifier labeling your sounds in real time.

---

### Phase 1 — Playable POC (2–3 weeks)

**Goal:** End-to-end game loop. Ugly, janky, but playable. Prove the core mechanic is fun.

**Scope:**
- 3 sounds only: **B** (kick), **t** (closed hi-hat), **K** (snare / "pff")
- Single level, ~30 seconds long, fixed chart
- One obstacle type, one character, placeholder art
- Desktop Chrome only
- Score = hit count (no timing precision yet, just "did you make the right sound in the window")

**Architecture:**
- Teachable Machine model, loaded via TF.js
- Simple onset detection: RMS energy threshold with debounce (skip onset detection sophistication for now — use a ~300ms cooldown between triggers so you don't double-fire)
- Game loop in p5.js or plain Canvas
- The chart is a hardcoded JSON array of `{time_ms, required_sound}` entries
- Hitbox = ±150ms window around `time_ms`

**What you're learning:**
- Does the classifier fire fast enough to feel responsive?
- Do players intuitively understand which sound to make?
- How forgiving does the hit window need to be?
- Does the 3-class constraint feel fun or limiting?

**Risks to flag early:**
- If end-to-end latency exceeds 150ms, the game will feel laggy and you'll need to either shrink the model or change to an AudioWorklet architecture before Phase 2.
- If classification accuracy drops below 70% for other people (not just you), plan user-calibration into Phase 2 instead of later.

**Deliverable:** Link to a playable web page. Playtested by at least 5 people who aren't you.

---

### Phase 2 — Core Game v0.1 (4–6 weeks)

**Goal:** A real game — multiple levels, real scoring, presentable art. Private beta quality.

**New scope:**
- **5 sounds**: B (kick), t (closed hi-hat), ts (open hi-hat), K (snare), Pf (alt snare / "p-snare")
- 5–10 hand-authored levels of increasing BPM and density
- **Per-user calibration flow**: 30-second onboarding where the user records 5 samples of each sound; those samples either bias the existing model or train a thin classifier on top
- Real rhythm-game scoring: Perfect / Great / Good / Miss based on timing deviation
- Combo multiplier, health bar or lives
- Results screen with accuracy %, max combo, per-class accuracy breakdown
- Basic level editor (even just a JSON format) so you can author content quickly

**Architecture upgrade:**
- Move audio processing to an **AudioWorklet** (mandatory — main-thread processing will stutter during complex animations)
- Replace Teachable Machine model with a custom CNN trained on AVP dataset + your own collected samples
- Switch to Phaser or PixiJS for the rendering layer
- Add proper onset detection: spectral flux with adaptive threshold (see Keavon/Web-Onset on GitHub for a reference implementation)
- Apply the **23ms delay** from onset to classification window (per Stowell & Plumbley's finding)

**Data collection for the model:**
- Start with AVP dataset (4 of the 5 classes are directly covered)
- Collect ~500 samples per class from 10+ volunteers across different microphones
- Augmentation: add room noise, pitch shift ±10%, time stretch ±5%, EQ variations

**What you're validating:**
- Does per-user calibration solve the cross-user accuracy problem?
- At 120+ BPM, does the pipeline keep up?
- Is the game fun enough that beta testers come back for a second session?

**Deliverable:** Private beta link, tested by 20–50 users, with analytics on per-class accuracy, level completion rates, and session length.

---

### Phase 3 — Public Web Beta (6–8 weeks)

**Goal:** Something you'd tweet a link to. Polished enough to get real press/creator attention.

**New scope:**
- **6–8 sounds** — add at least one "advanced" sound (throat bass, lip roll, or clop) gated behind a tutorial
- **Mobile web support** — Safari iOS and Chrome Android. This is nontrivial and needs its own microphone calibration flow.
- Original music for 15–20 levels, licensed or commissioned
- **Chart editor** for community content (simple JSON loader at minimum, visual editor is better)
- Leaderboards (Firebase or Supabase backend)
- Social share: end-of-level GIF / video of your run with your score
- **Tutorial mode** that teaches new players the sounds before throwing them into gameplay
- Proper accessibility pass: colorblind-safe, captions for tutorials, adjustable hit windows

**Technical hardening:**
- Progressive model download (don't block startup on a multi-MB model)
- Graceful degradation: if the classifier confidence is low across the board, detect that and prompt a re-calibration
- Latency measurement built in; show users their actual input lag and a "calibrate latency" option (every rhythm game needs this)
- Anti-cheat for leaderboards: server-side validation that submitted scores match plausible input patterns

**Business prep:**
- Decide monetization model now, not later: premium song packs, subscription, ads, creator marketplace — each one changes your architecture
- Trademark the name; secure social handles; set up a landing page with an email list
- Plan a beatboxer-creator seeding program — this is a community that will make or break word-of-mouth

**Deliverable:** Public URL, 1,000+ users in the first month, retention data, and a pitch deck if you're raising.

---

### Phase 4 — Mobile Native App (3–4 months)

**Goal:** App Store / Play Store release. TikTok-filter-adjacent virality is only possible here.

Mobile native matters because: (a) people play mobile games portrait-mode on their commute, not laptop-in-hand, (b) native mic access is meaningfully better than browser mic access, (c) push notifications and daily-challenge hooks drive retention, (d) App Store is where people discover music games.

**Scope:**
- React Native or Flutter shell with native audio modules on both platforms
- TFLite model (not TF.js) for inference — significantly faster on mobile
- Rebuild audio pipeline natively: AVAudioEngine on iOS, AudioRecord on Android, both with low-latency flags
- Daily challenges, weekly challenges, seasonal events
- Creator tools: record a beatbox, auto-generate a playable chart from it, share
- User-generated content pipeline with moderation
- Full monetization: in-app purchases, subscription tier, cosmetic unlocks

**The big new technical challenge:** **audio-to-chart generation.** If a creator beatboxes a 30-second pattern, can you auto-generate a level from it? This is genuinely hard (it's the onset detection + classification pipeline run offline on a recorded track) but it's also your content engine — without it you'll starve for levels.

**Deliverable:** Shipped app, 50k+ downloads in month one with coordinated creator launch, 20%+ D1 retention.

---

### Phase 5 — Platform & Scale (6–12 months)

**Goal:** Turn the game into a platform. This is the 5-year plan part; don't plan it in detail yet, but know it exists.

**Possible directions** (pick one, not all):
- **Competitive mode** with matchmaking and ranked ladders — partnership with Swissbeatbox or similar
- **Learning mode** — branded as "Duolingo for beatboxing," tutorials from real artists
- **Creator marketplace** — beatboxers upload patterns, users pay to play them, revenue share
- **Hardware tie-in** — headset mic that eliminates the mobile-mic quality problem, sold separately
- **Platform expansion** — Switch, arcade cabinets, VR (Beat Saber crowd)

Each direction has different technical and business implications. The prior phases don't force this decision, but the data you collect in Phase 3–4 should inform it: if your top metric is session length, go competitive; if it's new-user completion, go learning; if it's creator-uploaded content volume, go marketplace.

---

## 6. Critical Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| End-to-end latency exceeds 100ms, game feels laggy | High | Critical | AudioWorklet from Phase 2; measure early; consider a smaller model; in-game latency calibration |
| Classifier accuracy collapses across users/devices | High | Critical | Per-user calibration flow from Phase 2; collect diverse training data; background-noise class |
| Mobile mic quality differs from desktop training data | High | High | Mobile-specific training data in Phase 3; device fingerprinting with mic-specific model variants if needed |
| Pro beatboxers find the game trivial or impossible | Medium | Medium | Difficulty tiers; pro-tier sounds gated behind calibration; separate pro mode with tighter windows |
| Community generates toxic/copyrighted content on UGC | Medium | High | Moderation tooling from Phase 4 day one; clear ToS; licensing model for pro content |
| Copyright issues with music | High (if licensing real songs) | Critical | Commission original music; partner with a library like Epidemic Sound; do not use copyrighted tracks without proper sync licenses |
| The core mechanic turns out to not be fun | Low-Medium | Critical | Validate in Phase 1 with real users before investing in Phase 2 |

---

## 7. Concrete First Week

If you want to start Monday morning, here's the literal order of operations:

1. **Day 1** — Go to teachablemachine.withgoogle.com, open a sound project, record 30 samples each of background, kick (B), and hi-hat (t). Train. See what accuracy you get.
2. **Day 2** — Export the model. Clone a Teachable Machine + p5.js starter (the Coding Train example is a good base). Get it running locally with live prediction printed to the screen.
3. **Day 3** — Add a minimum viable "game": a ball that moves left-to-right, an obstacle at x=500px, when the ball crosses the obstacle you must have predicted "B" in the last 200ms or you "fail."
4. **Day 4** — Add a second obstacle requiring "t". Confirm the mechanic feels okay.
5. **Day 5** — Give it to two friends to try. Watch them silently. Do not coach them. Note what confuses them.
6. **Weekend** — Decide: is this actually fun? If yes, proceed to Phase 1 planning. If no, figure out what changes it needs before investing further.

Don't skip step 5. The research tells you the tech works. Your playtesters will tell you if the game does.

---

## Appendix: Sound → Character Mapping Reference

The notation system you described (B for kick, t for hi-hat) is called **Standard Beatbox Notation (SBN)**. It's community-standard among beatboxers and you should stick with it for credibility. The common mappings:

| Symbol | Sound | Difficulty | Recommended Phase |
|---|---|---|---|
| `B` | Classic kick drum | Easy | Phase 0 |
| `t` | Closed hi-hat | Easy | Phase 0 |
| `K` / `Pf` | Classic snare / p-snare | Easy-Medium | Phase 1 |
| `ts` | Open hi-hat | Medium | Phase 2 |
| `Psh` | Rimshot | Medium | Phase 3 |
| `wh` | Throat bass | Hard | Phase 3 |
| `Brrr` | Lip roll | Hard | Phase 4 |
| `Clop` | Rimshot / mouth click | Hard | Phase 4 |

Using SBN from day one also gives you credibility with the beatbox community, which is a small but influential world that can make or kill a game like this through word of mouth.
