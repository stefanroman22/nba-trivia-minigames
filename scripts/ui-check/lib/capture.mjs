// Network capture for one page: JSON HTTP responses and socket.io frames, recorded from the moment
// capture(page) is called (before the first goto, via the `cap` fixture).
//   cap.json(re)      → last JSON body whose URL matches (awaits its body), or undefined
//   cap.all(re)       → every matching JSON body, in arrival order
//   cap.entries(re)   → [{ url, method, status, body }] for matching JSON responses
//   cap.frames(name, { dir: 'in' | 'out' | 'any' = 'any' }) → socket.io payloads (first argument) in order
//   cap.events(name?) → [{ dir, event, args, at }] raw socket.io events
//   cap.clear()       → forget everything recorded so far
const isJson = (headers) => /\bjson\b/i.test(headers['content-type'] || '');

/** Parse one socket.io-over-engine.io text frame: '42/ns,7["event",{...}]' → { event, args } | null. */
export function parseSocketIoFrame(data) {
  if (typeof data !== 'string' || !data.startsWith('4')) return null; // engine.io "message" packets only
  let s = data.slice(1);
  const type = s[0];
  if (type !== '2' && type !== '3') return null; // EVENT / ACK
  s = s.slice(1);
  if (s.startsWith('/')) { const comma = s.indexOf(','); if (comma < 0) return null; s = s.slice(comma + 1); }
  s = s.replace(/^\d+/, ''); // ack id
  try {
    const arr = JSON.parse(s);
    if (!Array.isArray(arr)) return null;
    return type === '2' ? { event: String(arr[0]), args: arr.slice(1) } : { event: '(ack)', args: arr };
  } catch { return null; }
}

export function capture(page) {
  let responses = [];
  let events = [];
  const test = (re, url) => (re instanceof RegExp ? re.test(url) : String(url).includes(String(re)));

  page.on('response', (r) => {
    let headers;
    try { headers = r.headers(); } catch { return; }
    if (!isJson(headers)) return;
    const entry = { url: r.url(), method: r.request().method(), status: r.status(), body: undefined };
    entry.ready = r.text().then((t) => { try { entry.body = JSON.parse(t); } catch { entry.body = t; } }).catch(() => {});
    responses.push(entry);
  });

  page.on('websocket', (ws) => {
    const on = (dir) => (f) => {
      const parsed = parseSocketIoFrame(typeof f.payload === 'string' ? f.payload : null);
      if (parsed) events.push({ dir, ...parsed, url: ws.url(), at: Date.now() });
    };
    ws.on('framereceived', on('in'));
    ws.on('framesent', on('out'));
  });

  const matching = async (re) => {
    const hits = responses.filter((e) => test(re, e.url));
    await Promise.all(hits.map((e) => e.ready));
    return hits;
  };

  return {
    async json(re) { const hits = await matching(re); return hits.length ? hits[hits.length - 1].body : undefined; },
    async all(re) { return (await matching(re)).map((e) => e.body); },
    async entries(re) { return (await matching(re)).map(({ url, method, status, body }) => ({ url, method, status, body })); },
    frames(name, { dir = 'any' } = {}) {
      return events.filter((e) => e.event === name && (dir === 'any' || e.dir === dir)).map((e) => e.args[0]);
    },
    events(name) { return events.filter((e) => !name || e.event === name).map(({ dir, event, args, at }) => ({ dir, event, args, at })); },
    clear() { responses = []; events = []; },
  };
}
