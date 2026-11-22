/* Start the SimQ engine (Python, via Pyodide), route the UI's /api/<name> calls to it, then load the app.
   When served by tools/dev_server.py (local testing), /api/ goes to the real server instead. */
"use strict";
(async () => {
  const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.27.2/full/";
  const msg = t => { const m = document.getElementById("bootmsg"); if (m) m.textContent = t; };
  const fail = e => { msg("SimQ couldn't start: " + (e && e.message || e)); console.error(e); };
  const loadApp = () => { const s = document.createElement("script"); s.src = "app.js"; document.body.appendChild(s); };
  try {
    if ((await fetch("api-mode").then(r => r.ok ? r.text() : "").catch(() => "")).trim() === "server") return loadApp();
    await new Promise((ok, no) => { const s = document.createElement("script"); s.src = PYODIDE + "pyodide.js"; s.onload = ok; s.onerror = () => no(new Error("couldn't load Python")); document.head.appendChild(s); });
    const py = await loadPyodide({indexURL: PYODIDE});
    msg("Loading the math library");
    await py.loadPackage(["numpy"]);
    msg("Unpacking SimQ and 16 years of real TQQQ history");
    const files = await (await fetch("simq-bundle.json")).json();
    for (const [path, text] of Object.entries(files)) {
      const full = "/simq/" + path;
      py.FS.mkdirTree(full.slice(0, full.lastIndexOf("/")));
      py.FS.writeFile(full, text);
    }
    py.runPython("import sys, os; sys.path.insert(0, '/simq/engine'); os.environ['SIMQ_DATA'] = '/simq/data/history'");
    const api = py.pyimport("simq.api");
    msg("Ready");
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts = {}) => {
      const u = typeof url === "string" ? url : url.url;
      if (!u.startsWith("/api/")) return realFetch(url, opts);
      await new Promise(r => setTimeout(r, 0));
      const [code, body] = api.dispatch(u.slice(5), opts.body || "{}").toJs();
      return new Response(body, {status: code, headers: {"Content-Type": "application/json"}});
    };
    loadApp();
  } catch (e) { fail(e); }
})();
