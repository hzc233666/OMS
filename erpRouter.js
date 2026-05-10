/**
 * Hash Router：#/dashboard、#/inventory/ledger …
 */
(function (global) {
  function isAuthCallbackHash() {
    var h = String(location.hash || "");
    return (
      h.indexOf("access_token") >= 0 ||
      h.indexOf("refresh_token") >= 0 ||
      (h.indexOf("type=") >= 0 && h.indexOf("recovery") >= 0)
    );
  }

  function normalizePath() {
    if (isAuthCallbackHash()) return "/dashboard";
    var raw = location.hash.replace(/^#/, "").trim();
    if (!raw) return "/dashboard";
    var p = raw.split("?")[0];
    if (!p.startsWith("/")) p = "/" + p;
    p = p.replace(/\/+$/, "") || "/";
    return p;
  }

  function navigate(path) {
    var p = path.charAt(0) === "/" ? path : "/" + path;
    location.hash = "#" + p;
  }

  function safeDefaultHash() {
    if (isAuthCallbackHash()) return;
    if (!location.hash || location.hash === "#") navigate("/dashboard");
  }

  function onRoute(fn) {
    var run = function () {
      fn(normalizePath());
    };
    global.addEventListener("hashchange", run);
    run();
  }

  global.ErpRouter = {
    getPath: normalizePath,
    navigate: navigate,
    onRoute: onRoute,
    safeDefaultHash: safeDefaultHash,
    isAuthCallbackHash: isAuthCallbackHash
  };
})(window);
