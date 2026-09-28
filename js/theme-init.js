// Apply a saved theme before first paint (no flash). 'system' = no attribute.
// A classic (non-module) script loaded from <head>: kept external so the Content-Security-Policy
// needs no inline-script hash.
(function () {
  try {
    var t = localStorage.getItem('tts-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* storage blocked: follow the system theme */ }
})();
