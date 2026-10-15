/* A small stand-in for the Dashboard type's `dash` runtime: loads data/*.json, runs the page's calcs
   in the order they were registered, and redraws on data or width changes. */
window.dash = (() => {
  const DATASETS = ['channel', 'videos', 'comments', 'diagnosis', 'advice', 'ideas', 'findings', 'series', 'title_patterns', 'audience'];
  const params = new URLSearchParams(location.search);
  // Bust the CDN cache once a minute, or right after a refresh.
  const refreshed = params.get('refreshed');
  const version = refreshed && !Number.isNaN(Date.parse(refreshed)) ? refreshed : String(Math.floor(Date.now() / 60000));
  const sources = {};
  const results = {};
  const calcs = [];
  const listeners = [];

  const get = (id) => sources[id] || results[id] || { status: DATASETS.includes(id) ? 'loading' : 'missing', data: [] };

  const compute = () => {
    for (const c of calcs) {
      const ins = c.inputs.map(get);
      if (ins.every((s) => s.status === 'ok')) {
        try {
          results[c.id] = { status: 'ok', data: c.fn(...ins.map((s) => s.data)) };
        } catch (e) {
          results[c.id] = { status: 'error', data: [] };
          console.error(`calc ${c.id} failed`, e);
        }
      } else {
        results[c.id] = { status: ins.some((s) => s.status === 'loading') ? 'loading' : 'error', data: [] };
      }
    }
  };

  let queued = false;
  const emit = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      compute();
      listeners.forEach((fn) => {
        try { fn(); } catch (e) { console.error(e); }
      });
    });
  };

  DATASETS.forEach((id) => {
    fetch(`data/${id}.json?v=${encodeURIComponent(version)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((data) => { sources[id] = { status: 'ok', data: Array.isArray(data) ? data : [] }; })
      .catch(() => { sources[id] = { status: 'error', data: [] }; })
      .finally(emit);
  });

  let lastWidth = document.documentElement.clientWidth;
  let t;
  new ResizeObserver(() => {
    const w = document.documentElement.clientWidth;
    if (w === lastWidth) return;
    lastWidth = w;
    clearTimeout(t);
    t = setTimeout(emit, 120);
  }).observe(document.documentElement);

  return {
    data: get,
    calc(id, def) { calcs.push({ id, inputs: def.inputs, fn: def.fn }); },
    onData(fn) { listeners.push(fn); compute(); fn(); },
    setLink(id) { history.replaceState(null, '', `${location.pathname}${location.search}#${id}`); },
  };
})();
