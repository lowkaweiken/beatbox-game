class BeatboxProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._collecting = false;
    this._collectBuf = [];
    this._collectTarget = Math.round(sampleRate * 0.2);
    this._cooldown = 0;
    this._cooldownAfter = Math.round(sampleRate * 0.4);
    this._emaRms = 0;
    this._ONSET_RATIO = 5;
    this._MIN_RMS = 0.008;
    this._rawCollecting = false;
    this._rawBuf = [];
    this._rawTarget = 0;
    this.port.onmessage = (e) => {
      if (e.data.type === 'set_cooldown') {
        this._cooldownAfter = Math.round(sampleRate * e.data.seconds);
      } else if (e.data.type === 'collect_raw') {
        this._rawCollecting = true;
        this._rawBuf = [];
        this._rawTarget = e.data.samples;
      }
    };
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;

    // Raw-collect mode: capture N samples regardless of onset, suppress onset detection
    if (this._rawCollecting) {
      for (let i = 0; i < ch.length; i++) this._rawBuf.push(ch[i]);
      if (this._rawBuf.length >= this._rawTarget) {
        const audio = new Float32Array(this._rawBuf.slice(0, this._rawTarget));
        this.port.postMessage({ type: 'raw_audio', audio }, [audio.buffer]);
        this._rawCollecting = false;
        this._rawBuf = [];
      }
      return true;
    }

    let rms = 0;
    for (let i = 0; i < ch.length; i++) rms += ch[i] * ch[i];
    rms = Math.sqrt(rms / ch.length);

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
      this.port.postMessage({ type: 'onset_start' });
      this._collecting = true;
      this._collectBuf = Array.from(ch);
    }

    return true;
  }
}

registerProcessor('beatbox-processor', BeatboxProcessor);
