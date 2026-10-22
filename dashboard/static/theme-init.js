// Loaded synchronously in <head> so a saved Light/Dark choice applies before first paint.
// Keep the key in sync with theme.js.
(function () {
  try {
    var t = localStorage.getItem("trader-desk-theme");
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  } catch (e) { /* storage blocked: follow the system theme */ }
})();
