// React internals reader (React 19 DOM): props and hook state of the components that rendered an
// element, read from the element's __reactFiber$* / __reactProps$* keys. For checks that need a
// value the DOM does not show (the correct answer of a round, a timer's remaining time…).
//   fiber.props(selector, depth = 8) → [{ name, props }]  the element's own DOM props first, then each
//                                      function/class component above it, up to `depth` fibers up
//   fiber.state(selector, depth = 8) → [{ name, hooks }]  hook values (useState/useReducer/useRef…,
//                                      in declaration order) or class state, same walk
// Values are serialised: functions → '[fn name]', DOM nodes → '[node <tag>]', React elements →
// '[element <type>]', cycles → '[circular]', nesting beyond 5 → '[…]'. null when nothing matches.
// Component names are minified in prod builds (UserChip reads as 'w'): match components on their
// props shape (e.g. the entry whose props have 'aria-label' and 'onClick'), never on `name`.
function readFiber({ selector, depth, kind }) {
  const el = document.querySelector(selector);
  if (!el) return null;
  const key = (prefix) => Object.keys(el).find((k) => k.startsWith(prefix));
  const fiberKey = key('__reactFiber$');
  if (!fiberKey) return null;

  const ser = (v, d = 0, seen = new WeakSet()) => {
    if (v === null || v === undefined || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'function') return `[fn ${v.name || 'anonymous'}]`;
    if (typeof v === 'symbol' || typeof v === 'bigint') return String(v);
    if (typeof Node !== 'undefined' && v instanceof Node) return `[node ${v.nodeName.toLowerCase()}]`;
    if (v.$$typeof) { const t = v.type; return `[element ${typeof t === 'string' ? t : (t && (t.displayName || t.name)) || '?'}]`; }
    if (seen.has(v)) return '[circular]';
    if (d >= 5) return '[…]';
    seen.add(v);
    if (v instanceof Map) return { '[Map]': [...v.entries()].slice(0, 50).map(([k, x]) => [ser(k, d + 1, seen), ser(x, d + 1, seen)]) };
    if (v instanceof Set) return { '[Set]': [...v].slice(0, 50).map((x) => ser(x, d + 1, seen)) };
    if (Array.isArray(v)) return v.slice(0, 100).map((x) => ser(x, d + 1, seen));
    const out = {};
    for (const k of Object.keys(v).slice(0, 100)) {
      try { out[k] = ser(v[k], d + 1, seen); } catch { out[k] = '[unreadable]'; }
    }
    return out;
  };
  const nameOf = (f) => {
    const t = f.type;
    if (!t) return null;
    if (typeof t === 'string') return t;
    return t.displayName || t.name || (t.render && (t.render.displayName || t.render.name)) || (t.type && (t.type.displayName || t.type.name)) || 'Anonymous';
  };
  const isComponent = (f) => typeof f.type === 'function' || (f.type && typeof f.type === 'object' && (f.type.render || f.type.type));

  const hooksOf = (f) => {
    if (f.stateNode && f.stateNode.state !== undefined && typeof f.type === 'function' && f.type.prototype && f.type.prototype.isReactComponent) {
      return { classState: ser(f.stateNode.state) };
    }
    const hooks = [];
    for (let h = f.memoizedState; h && hooks.length < 60; h = h.next) {
      // useRef keeps {current}; effects keep {create, deps…}; memo keeps [value, deps]; state keeps the value.
      const s = h.memoizedState;
      if (s && typeof s === 'object' && 'create' in s && 'deps' in s) continue; // effect
      hooks.push(ser(s));
    }
    return hooks;
  };

  const out = [];
  if (kind === 'props') {
    const propsKey = key('__reactProps$');
    if (propsKey) out.push({ name: el.tagName.toLowerCase(), props: ser(el[propsKey]) });
  }
  let f = el[fiberKey];
  for (let i = 0; f && i < depth; i++, f = f.return) {
    if (!isComponent(f)) continue;
    out.push(kind === 'props' ? { name: nameOf(f), props: ser(f.memoizedProps) } : { name: nameOf(f), hooks: hooksOf(f) });
  }
  return out;
}

/** Fiber reader bound to a page. */
export function fiberReader(page) {
  return {
    props: (selector, depth = 8) => page.evaluate(readFiber, { selector, depth, kind: 'props' }),
    state: (selector, depth = 8) => page.evaluate(readFiber, { selector, depth, kind: 'state' }),
  };
}
