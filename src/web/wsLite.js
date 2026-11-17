// wsLite.js – minimal WebSocket (RFC 6455) server side: binary push, small text messages, ping/pong, close.
// Used by web listening (T41). Client frames are small control messages only (max 4 KB).
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function reject(socket, status, text) {
  try { socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch { /* ignore */ }
  try { socket.destroy(); } catch { /* ignore */ }
}

class WsConn extends EventEmitter {
  constructor(socket, head) {
    super();
    this.socket = socket;
    this.closed = false;
    this.buf = head?.length ? Buffer.from(head) : Buffer.alloc(0);
    socket.setNoDelay?.(true);
    socket.on('data', (d) => this._data(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
    this._ping = setInterval(() => this._frame(0x9, Buffer.alloc(0)), 25_000);
    this._ping.unref?.();
  }

  /** Bytes queued in the socket (slow client detection). */
  get backlog() {
    return this.socket.writableLength || 0;
  }

  sendBinary(buf) { this._frame(0x2, buf); }

  sendText(str) { this._frame(0x1, Buffer.from(String(str), 'utf8')); }

  _frame(op, payload) {
    if (this.closed) return;
    const n = payload.length;
    let h;
    if (n < 126) { h = Buffer.alloc(2); h[1] = n; }
    else if (n < 65536) { h = Buffer.alloc(4); h[1] = 126; h.writeUInt16BE(n, 2); }
    else { h = Buffer.alloc(10); h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); }
    h[0] = 0x80 | op;
    try { this.socket.write(Buffer.concat([h, payload])); } catch { this._closed(); }
  }

  _data(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    if (this.buf.length > 65536) { this.close(1009); return; }
    for (;;) {
      if (this.closed || this.buf.length < 2) return;
      const op = this.buf[0] & 0x0f;
      const masked = this.buf[1] & 0x80;
      let len = this.buf[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (!masked) { this.close(1002); return; }
      if (len > 4096) { this.close(1009); return; }
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const data = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);
      if (op === 0x8) { this.close(1000); return; }
      if (op === 0x9) this._frame(0xa, data);
      else if (op === 0x1) this.emit('text', data.toString('utf8'));
      // binary / pong / continuation from the client: ignored
    }
  }

  close(code = 1000) {
    if (this.closed) return;
    const p = Buffer.alloc(2);
    p.writeUInt16BE(code);
    this._frame(0x8, p);
    try { this.socket.end(); } catch { /* ignore */ }
    this._closed();
  }

  _closed() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this._ping);
    setTimeout(() => { try { this.socket.destroy(); } catch { /* ignore */ } }, 1000).unref?.();
    this.emit('close');
  }
}

/** Complete the handshake. Returns a WsConn, or null (socket destroyed) when the request is not a WebSocket upgrade. */
function accept(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    reject(socket, 400, 'Bad Request');
    return null;
  }
  const acceptKey = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey}\r\n\r\n`);
  return new WsConn(socket, head);
}

module.exports = { accept, reject, WsConn };
