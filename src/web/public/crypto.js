// crypto.js – SHA-256 / HMAC / PBKDF2 in plain JS (WebCrypto is unavailable on plain-HTTP origins).
// Used only to prove knowledge of the password without sending it.
(function () {
  'use strict';
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const W = new Uint32Array(64);

  function compress(H, block, off) {
    for (let i = 0; i < 16; i++) {
      W[i] = (block[off + i * 4] << 24) | (block[off + i * 4 + 1] << 16) | (block[off + i * 4 + 2] << 8) | block[off + i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15];
      const b = W[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let a = H[0]; let b = H[1]; let c = H[2]; let d = H[3];
    let e = H[4]; let f = H[5]; let g = H[6]; let h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }

  function sha256(bytes) {
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const len = bytes.length;
    const total = ((len + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(total);
    buf.set(bytes);
    buf[len] = 0x80;
    const bits = len * 8;
    buf[total - 4] = (bits >>> 24) & 0xff;
    buf[total - 3] = (bits >>> 16) & 0xff;
    buf[total - 2] = (bits >>> 8) & 0xff;
    buf[total - 1] = bits & 0xff;
    buf[total - 5] = Math.floor(bits / 2 ** 32) & 0xff;
    for (let off = 0; off < total; off += 64) compress(H, buf, off);
    const out = new Uint8Array(32);
    for (let i = 0; i < 8; i++) {
      out[i * 4] = H[i] >>> 24; out[i * 4 + 1] = (H[i] >>> 16) & 0xff;
      out[i * 4 + 2] = (H[i] >>> 8) & 0xff; out[i * 4 + 3] = H[i] & 0xff;
    }
    return out;
  }

  function concat(a, b) {
    const out = new Uint8Array(a.length + b.length);
    out.set(a);
    out.set(b, a.length);
    return out;
  }

  function hmacKey(key) {
    let k = key.length > 64 ? sha256(key) : key;
    const padded = new Uint8Array(64);
    padded.set(k);
    const ipad = new Uint8Array(64);
    const opad = new Uint8Array(64);
    for (let i = 0; i < 64; i++) {
      ipad[i] = padded[i] ^ 0x36;
      opad[i] = padded[i] ^ 0x5c;
    }
    return { ipad, opad };
  }

  function hmac(key, msg) {
    const { ipad, opad } = hmacKey(key);
    return sha256(concat(opad, sha256(concat(ipad, msg))));
  }

  function pbkdf2(password, salt, iterations) {
    // dkLen = 32 → single block
    const { ipad, opad } = hmacKey(password);
    const mac = (m) => sha256(concat(opad, sha256(concat(ipad, m))));
    const block = new Uint8Array(salt.length + 4);
    block.set(salt);
    block[salt.length + 3] = 1;
    let u = mac(block);
    const out = u.slice();
    for (let i = 1; i < iterations; i++) {
      u = mac(u);
      for (let j = 0; j < 32; j++) out[j] ^= u[j];
    }
    return out;
  }

  const enc = (s) => new TextEncoder().encode(s);
  const fromHex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)));
  const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

  async function webPbkdf2(password, salt, iterations) {
    const key = await crypto.subtle.importKey('raw', enc(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
    return new Uint8Array(bits);
  }

  /** proof = HMAC(PBKDF2(password, salt, iter), nonce) */
  async function passwordProof(password, saltHex, iterations, nonce) {
    const salt = fromHex(saltHex);
    let key;
    if (window.crypto?.subtle) key = await webPbkdf2(password, salt, iterations);
    else key = pbkdf2(enc(password), salt, iterations);
    return toHex(hmac(key, enc(nonce)));
  }

  window.OudCrypto = { sha256, hmac, pbkdf2, passwordProof, toHex, fromHex };
})();
