// listen-worklet.js – T41: plays PCM posted by the page; ~250 ms jitter buffer, silence on underrun.
/* global AudioWorkletProcessor, sampleRate, registerProcessor */
class OudListen extends AudioWorkletProcessor {
  constructor() {
    super();
    this.q = [];
    this.qLen = 0;
    this.cur = null;
    this.pos = 0;
    this.started = false;
    this.under = 0; this.drop = 0; this.calls = 0;
    this.target = sampleRate * 0.25;
    this.max = sampleRate * 1.0;
    this.port.onmessage = (e) => {
      if (e.data === 'flush') { this.q = []; this.qLen = 0; this.cur = null; this.started = false; return; }
      const [l, r] = e.data;
      this.q.push([l, r]);
      this.qLen += l.length;
      while (this.qLen > this.max && this.q.length > 1) { this.qLen -= this.q.shift()[0].length; this.drop++; }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const L = out[0];
    const R = out[1] || out[0];
    const n = L.length;
    if (!this.started) {
      if (this.qLen < this.target) { L.fill(0); R.fill(0); return true; }
      this.started = true;
    }
    let i = 0;
    while (i < n) {
      if (!this.cur) {
        this.cur = this.q.shift() || null;
        this.pos = 0;
        // qLen counts samples still to play, including the rest of `cur`.
        if (!this.cur) { this.started = false; this.under++; break; }
      }
      const [cl, cr] = this.cur;
      const k = Math.min(n - i, cl.length - this.pos);
      L.set(cl.subarray(this.pos, this.pos + k), i);
      R.set(cr.subarray(this.pos, this.pos + k), i);
      i += k;
      this.pos += k;
      this.qLen -= k;
      if (this.pos >= cl.length) this.cur = null;
    }
    if (i < n) { L.fill(0, i); R.fill(0, i); }
    if (++this.calls >= 375) { // ~1 s at 48 kHz / 128
      this.calls = 0;
      this.port.postMessage({ under: this.under, drop: this.drop, q: Math.round(this.qLen / sampleRate * 1000) });
      this.under = 0; this.drop = 0;
    }
    return true;
  }
}
registerProcessor('oud-listen', OudListen);
