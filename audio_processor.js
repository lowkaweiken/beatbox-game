class BeatboxProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._collecting = false;
    this._collectBuf = [];
    this._collectTarget = Math.round(sampleRate * 0.2); // 200ms of samples
    this._cooldown = 0;
    this._cooldownAfter = Math.round(sampleRate * 0.4); // 400ms dead zone after each hit
    this._emaRms = 0;
    this._ONSET_RATIO = 5;   // spike must be 5× above background EMA
    this._MIN_RMS = 0.008;   // absolute floor to ignore silence
    this.port.onmessage = (e) => {
      if (e.data.type === 'set_cooldown') {
        this._cooldownAfter = Math.round(sampleRate * e.data.seconds);
      }
    };
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;

    let rms = 0;
    for (let i = 0; i < ch.length; i++) rms += ch[i] * ch[i];
    rms = Math.sqrt(rms / ch.length);

    // Slow-tracking EMA of background energy level
    this._emaRms = 0.97 * this._emaRms + 0.03 * rms;

    if (this._collecting) {
      for (let i = 0; i < ch.length; i++) this._collectBuf.push(ch[i]);
      if (this._collectBuf.length >= this._collectTarget) {
        const audio = new Float32Array(this._collectBuf.slice(0, this._collectTarget));
        this.port.postMessage({ type: 'onset', audio }, [audio.buffer]);
        this._collectBuf = [];
        this._collecting = false;
        this._cooldown = this._cooldownAfter;
      }
    } else if (this._cooldown > 0) {
      this._cooldown -= ch.length;
    } else if (rms > this._emaRms * this._ONSET_RATIO && rms > this._MIN_RMS) {
      // Signal onset immediately so the main thread can react without waiting for the full window
      this.port.postMessage({ type: 'onset_start' });
      this._collecting = true;
      this._collectBuf = Array.from(ch);
    }

    return true;
  }
}

registerProcessor('beatbox-processor', BeatboxProcessor);
