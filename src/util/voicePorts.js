// T56: bind Discord voice UDP sockets to a fixed local port range so the host's DDoS filter (ZAP PletX)
// can allow them with one rule; with random ports PletX dropped ~65% of inbound voice packets.
// VOICE_UDP_PORTS=50000-50199 (default); VOICE_UDP_PORTS=0 turns it off.
const dgram = require('dgram');

function install() {
  const spec = String(process.env.VOICE_UDP_PORTS ?? '50000-50199').trim();
  if (!spec || spec === '0') return null;
  const m = /^(\d{2,5})-(\d{2,5})$/.exec(spec);
  if (!m || +m[1] > +m[2] || +m[2] > 65535) {
    console.warn(`[VOICE] VOICE_UDP_PORTS "${spec}" invalid — random ports`);
    return null;
  }
  const lo = +m[1];
  const hi = +m[2];
  const used = new Set();
  let next = lo;
  const pick = () => {
    for (let i = 0; i <= hi - lo; i++) {
      const p = next;
      next = next >= hi ? lo : next + 1;
      if (!used.has(p)) return p;
    }
    return null;
  };
  const orig = dgram.createSocket;
  dgram.createSocket = function createSocket(type, ...rest) {
    const sock = orig.call(dgram, type, ...rest);
    // Only the voice library's bare createSocket('udp4') call; anything else keeps default behaviour.
    if (type !== 'udp4' || rest.length) return sock;
    const port = pick();
    if (port === null) return sock; // range full: OS picks a port
    used.add(port);
    sock.once('close', () => used.delete(port));
    sock.bind(port); // sends issued before the bind completes are queued by Node
    return sock;
  };
  console.log(`[VOICE] UDP ports ${lo}-${hi}`);
  return { lo, hi, used };
}

module.exports = { install };
