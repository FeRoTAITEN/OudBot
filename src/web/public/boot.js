// boot.js – apply saved theme/language before first paint (separate file: CSP forbids inline scripts)
try {
  var th = localStorage.getItem('oud.theme');
  if (th) document.documentElement.dataset.theme = th;
  var lg = localStorage.getItem('oud.lang');
  if (lg === 'en') { document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr'; }
} catch (e) { /* storage blocked */ }
