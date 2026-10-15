// Port sets of a local stack. The checkers use `prod` and `dev`; a pipeline QA lane passes its own
// (`--ports django=8100,socket=4100,web=5273`). Child processes learn theirs from UI_CHECK_PORTS.
export const PORT_SETS = { prod: { django: 8200, socket: 4200, web: 5374 }, dev: { django: 8000, socket: 4000, web: 5173 } };
const KEYS = ['django', 'socket', 'web'];

/** "django=8100,socket=4100,web=5273" → { django, socket, web }; throws on a missing, unknown or non-port key. */
export function parsePorts(str) {
  const out = {};
  for (const part of String(str || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\w+)=(\d{2,5})$/.exec(part);
    if (!m) throw new Error(`ports: "${part}" must look like name=port`);
    if (!KEYS.includes(m[1])) throw new Error(`ports: unknown key "${m[1]}" (${KEYS.join(', ')})`);
    out[m[1]] = Number(m[2]);
  }
  const missing = KEYS.filter((k) => !out[k]);
  if (missing.length) throw new Error(`ports: missing ${missing.join(', ')} in "${str}" (need django=…,socket=…,web=…)`);
  return out;
}

/** { django, socket, web } → "django=…,socket=…,web=…" (the UI_CHECK_PORTS / --ports form). */
export const formatPorts = (p) => KEYS.map((k) => `${k}=${p[k]}`).join(',');

/** Stable key of a port set (stack.json `stacks` map). */
export const portsKey = (p) => KEYS.map((k) => p[k]).join('-');

/** The ports this process works on: UI_CHECK_PORTS when set, else the mode's checker set. */
export function activePorts(mode = process.env.UI_CHECK_MODE || 'prod') {
  if (process.env.UI_CHECK_PORTS) return parsePorts(process.env.UI_CHECK_PORTS);
  const p = PORT_SETS[mode];
  if (!p) throw new Error(`unknown stack mode "${mode}" (prod|dev)`);
  return p;
}
