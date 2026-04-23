# Migrate to Custom Onset Detection & Micro CNN

We are moving away from Teachable Machine to a custom audio pipeline to achieve millisecond-level responsiveness for high BPM gameplay. Because you need to collect new, correctly-formatted samples, we must build a custom data collection tool first.

## Goal Description

Teachable Machine's 1-second rolling window is too slow for transient percussive sounds. We need to implement a pipeline that detects the exact moment a sound starts (Onset Detector) and passes only the first ~100-150ms of that sound to a small, fast custom CNN. 

To achieve this, we will execute the following steps in order. **The immediate step is building the Data Collector.**

## Proposed Approach

### Phase 1: Build the Custom Data Collector (Web)
To ensure the training data perfectly matches what the game engine hears, and because your friends will be recording on their phones, we will build a dedicated **Mobile-First Data Collection App**.
#### [NEW] `data_collector.html`
- A responsive, mobile-first HTML app using vanilla JS and Web Audio API (with big, easy-to-tap buttons for non-developers).
- Requires a mandatory "Start Module" button to unblock the Web Audio Context (required to bypass iOS Safari's strict silence policy).
- Implements the **Onset Detector** (watching the `AnalyserNode` for volume spikes).
- When a volume spike is detected, it automatically slices a ~150ms `AudioBuffer`.
- Provides buttons to switch between labels ("Kick", "Hi-hat", "Snare", "Background").
- **JSZip & Web Share API:** Uses JSZip to bundle all the 150ms `.wav` slices directly in the browser memory. When your friend taps "Export," it uses `navigator.share()` so they can seamlessly Airdrop or WhatsApp the `.zip` file directly to you!
- You can host this temporarily for free using Vercel, GitHub Pages, or `ngrok` so they just have to click a link.

### Phase 2: Create the ML Training Pipeline (Python)
Once you have generated your dataset using the Data Collector, we will build the training script.
#### [NEW] `train.py` (or a Google Colab notebook)
- Loads your 150ms micro-samples.
- Uses `librosa` to convert the raw audio arrays into Mel-spectrograms (the visual representation of the sound).
- Defines a tiny, ultra-fast Convolutional Neural Network (CNN) in Keras/TensorFlow.
- Trains the model and exports it to a `model.json` format readable by TensorFlow.js.

### Phase 3: Game Integration (Browser)
We rip out Teachable Machine and replace it with our new engine.
#### [NEW] `audio_processor.js` (AudioWorklet)
- Moves the Onset Detector to an AudioWorklet so it runs perfectly in sync on a background thread without being blocked by UI stutters.
#### [MODIFY] `index.html`
- Replace `ml5.js` / Teachable machine logic.
- Load the custom TF.js model.
- The Worklet triggers a "Hit" visually on onset, and passes the 150ms buffer to the main thread for classification by the TF.js model.

## User Review Required
> [!IMPORTANT]
> Because you are relying on mobile audio inputs, the models trained will be heavily biased to the compression that iOS and Android apply. This is *perfect* since your target device is also mobile. But this means when *you* test the game on your laptop with the newly trained ML model, it might actually perform slightly worse than testing it on your iPhone. 

## Open Questions

1. Do you have Python installed on your Mac for Phase 2, or would you prefer I build the training pipeline as a Google Colab Notebook so you can train it entirely in the cloud for free? 
2. Should we prioritize creating `data_collector.html` in the exact modern UI/UX style as your core app, or keep it basic and strictly functional for your friends?
3. Shall I proceed with writing `data_collector.html`?

## Verification Plan
1. Launch `data_collector.html` on your local server.
2. Select the "Kick" class.
3. Make a kick drum sound into the mic.
4. Verify the UI immediately registers the hit, plays back exactly the 150ms slice, and increments your sample counter.
