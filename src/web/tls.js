// tls.js – HTTPS for the dashboard on its single port.
// Cert/key from WEB_TLS_CERT / WEB_TLS_KEY (PEM paths), else a self-signed one generated once with
// openssl into data/web-tls/. WEB_TLS=0 serves plain HTTP (not recommended: session cookies in clear).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const DIR = path.join(__dirname, '..', '..', 'data', 'web-tls');
const CERT = path.join(DIR, 'cert.pem');
const KEY = path.join(DIR, 'key.pem');

function enabled() {
  return process.env.WEB_TLS !== '0';
}

function isIp(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

function fingerprint(certPem) {
  try {
    return new crypto.X509Certificate(certPem).fingerprint256;
  } catch {
    return null;
  }
}

function generate(host, tag) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const san = [`DNS:localhost`, `IP:127.0.0.1`];
  if (host && host !== 'localhost') san.unshift(isIp(host) ? `IP:${host}` : `DNS:${host}`);
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
    '-days', '3650', '-subj', '/CN=Oud Dashboard', '-addext', `subjectAltName=${san.join(',')}`,
    '-keyout', KEY, '-out', CERT,
  ], { stdio: 'ignore', timeout: 20_000 });
  try { fs.chmodSync(KEY, 0o600); } catch { /* ignore */ }
  console.log(`${tag} Generated self-signed dashboard certificate (${san.join(', ')})`);
}

/** @returns {{ key: Buffer, cert: Buffer, selfSigned: boolean, fingerprint: string|null } | null} */
function load(host, tag = '[WEB]') {
  if (!enabled()) return null;
  const certPath = process.env.WEB_TLS_CERT?.trim();
  const keyPath = process.env.WEB_TLS_KEY?.trim();
  try {
    if (certPath && keyPath) {
      const cert = fs.readFileSync(certPath);
      return { cert, key: fs.readFileSync(keyPath), selfSigned: false, fingerprint: fingerprint(cert) };
    }
    if (!fs.existsSync(CERT) || !fs.existsSync(KEY)) generate(host, tag);
    const cert = fs.readFileSync(CERT);
    return { cert, key: fs.readFileSync(KEY), selfSigned: true, fingerprint: fingerprint(cert) };
  } catch (err) {
    console.warn(`${tag} HTTPS unavailable (${err.message}) — serving plain HTTP`);
    return null;
  }
}

module.exports = { load, enabled };
