// In-page detectors (spec §6 rule ids). Every function in this file runs INSIDE the page and is pure:
// no closures over module scope. Node code runs them through inPage(fn, arg), which prepends HELPERS
// and serialises the argument, so they work under page.evaluate with no build step.
//
// Results come back as plain objects: { rule, selector, measured, expected, note?, rect? }.
// `rect` (viewport coords) is for evidence crops and is stripped before recording.

/** Short readable selector: tag + up to 2 stable classes (+ :nth-of-type), anchored at an id, main or a dialog. */
export function cssPath(el) {
  if (!el || el.nodeType !== 1) return '';
  const stable = (c) => !/^(sc-|css-|jsx-)/.test(c) && !(/^[A-Za-z]{5,8}$/.test(c) && /[A-Z]/.test(c) && /[a-z]/.test(c));
  const parts = [];
  let node = el;
  for (let depth = 0; node && node.nodeType === 1 && depth < 5; depth++) {
    const tag = node.tagName.toLowerCase();
    if (node.id && !/^:|\d{4,}/.test(node.id)) { parts.unshift(`${tag}#${CSS.escape(node.id)}`); break; }
    if (tag === 'html' || tag === 'body') { parts.unshift(tag); break; }
    const classes = [...node.classList].filter(stable).slice(0, 2);
    let part = tag + classes.map((c) => '.' + CSS.escape(c)).join('');
    const parent = node.parentElement;
    if (parent) {
      const sameTag = [...parent.children].filter((s) => s.tagName === node.tagName);
      const twins = sameTag.filter((s) => classes.every((c) => s.classList.contains(c)));
      if (twins.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    if (tag === 'main' || node.getAttribute('role') === 'dialog' || node.getAttribute('aria-modal') === 'true') break;
    node = parent;
  }
  return parts.join(' > ');
}

/** Rendered, not hidden by display/visibility/opacity/aria-hidden/inert, and has a box. */
export function isShown(el) {
  if (!el || !el.isConnected) return false;
  if (el.closest('[aria-hidden="true"], [inert]')) return false;
  if (typeof el.checkVisibility === 'function'
    && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, checkOpacity: true, checkVisibilityCSS: true })) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** The element's rect after ancestor overflow clipping (viewport coords; null when fully clipped) and whether an ancestor scrolls it sideways. */
export function clipInfo(el) {
  const r = el.getBoundingClientRect();
  let left = r.left, top = r.top, right = r.right, bottom = r.bottom;
  let scroller = false;
  if (getComputedStyle(el).position !== 'fixed') {
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const pr = p.getBoundingClientRect();
        const cl = pr.left + p.clientLeft, ct = pr.top + p.clientTop;
        if (cs.overflowX !== 'visible') {
          left = Math.max(left, cl); right = Math.min(right, cl + p.clientWidth);
          if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') scroller = true;
        }
        if (cs.overflowY !== 'visible') { top = Math.max(top, ct); bottom = Math.min(bottom, ct + p.clientHeight); }
      }
      if (cs.position === 'fixed') break;
    }
  }
  return { rect: right - left > 0.5 && bottom - top > 0.5 ? { left, top, right, bottom } : null, scroller };
}

/** Nearest fixed/sticky element at or above `el` (the layer that covers things), or null. */
export function layerOf(el) {
  for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
    const pos = getComputedStyle(p).position;
    if (pos === 'fixed' || pos === 'sticky') return p;
  }
  return null;
}

export function interactiveSelector() {
  return [
    'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea', 'summary',
    '[role="button"]', '[role="link"]', '[role="tab"]', '[role="checkbox"]', '[role="radio"]',
    '[role="switch"]', '[role="menuitem"]', '[role="option"]', '[tabindex]:not([tabindex="-1"])',
    '[contenteditable=""]', '[contenteditable="true"]',
  ].join(', ');
}

/**
 * WCAG 2.5.8 inline exception: an inline target inside running text. The target is inline-level and
 * its nearest block ancestor (skipping inline wrappers) holds other non-whitespace text outside any
 * interactive element: a link in a sentence. Stacked list links (`ul > li > a`, nothing else in
 * the li) are not inline-in-text; the spacing exception judges them.
 */
export function isInlineInText(el) {
  if (!getComputedStyle(el).display.startsWith('inline')) return false;
  let block = el.parentElement;
  for (let i = 0; block && i < 8; i++, block = block.parentElement) {
    const d = getComputedStyle(block).display;
    if (d !== 'inline' && d !== 'contents') break;
  }
  if (!block) return false;
  const sel = interactiveSelector();
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue.trim() || el.contains(n)) continue;
    const owner = n.parentElement && n.parentElement.closest(sel);
    if (owner && block.contains(owner)) continue; // text of another control is not running text
    return true;
  }
  return false;
}

/** 'auto' snap watch set: the largest visible boxes (cards/panels/modal panels) in main, max 12. */
export function autoWatch(ignore) {
  const isIgnored = (el) => (ignore || []).some((s) => { try { return !!el.closest(s); } catch { return false; } });
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  const root = document.querySelector('main') || document.body;
  const cands = new Set([...root.querySelectorAll('*'),
    ...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]')]);
  const transparent = (c) => !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c);
  const scored = [];
  for (const el of cands) {
    if (isIgnored(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 24 || r.width * r.height < 2000) continue;
    if (r.bottom < 0 || r.top > vh * 1.5 || r.right < 0 || r.left > vw) continue;
    if (r.width >= vw * 0.95 && r.height >= vh) continue; // page-level wrappers
    const cs = getComputedStyle(el);
    const dialog = el.matches('[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog');
    const boxy = dialog || !transparent(cs.backgroundColor) || cs.backgroundImage !== 'none'
      || cs.boxShadow !== 'none' || parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0;
    if (!boxy || !isShown(el)) continue;
    scored.push([r.width * r.height, el, r]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const picked = [];
  for (const [, el, r] of scored) {
    if (picked.some(([, pr]) => Math.abs(pr.top - r.top) < 2 && Math.abs(pr.left - r.left) < 2
      && Math.abs(pr.width - r.width) < 2 && Math.abs(pr.height - r.height) < 2)) continue;
    picked.push([el, r]);
    if (picked.length >= 12) break;
  }
  return picked.map(([el]) => el);
}

export const HELPERS = [cssPath, isShown, clipInfo, layerOf, interactiveSelector, isInlineInText, autoWatch];

/** Build a page.evaluate expression that runs `fn(arg)` with the helpers in scope. */
export function inPage(fn, arg) {
  return `(() => {\n${HELPERS.map(String).join('\n')}\nreturn (${String(fn)})(${JSON.stringify(arg === undefined ? null : arg)});\n})()`;
}

// ---------------------------------------------------------------------------------------------
// layout: overflow-x, offscreen, clipped, occluded, tap-target (+ the soft tap-target-touch)

export function layoutScan({ scope = null, ignore = [], rules = null, touch = false } = {}) {
  const ALL = ['overflow-x', 'offscreen', 'clipped', 'occluded', 'tap-target', 'tap-target-touch'];
  const want = new Set(rules && rules.length ? rules : ALL);
  const de = document.documentElement;
  const vw = de.clientWidth, vh = de.clientHeight || window.innerHeight;
  const roots = scope ? [...document.querySelectorAll(scope)] : [document.body];
  const inScope = (el) => roots.some((r) => r === el || r.contains(el));
  const ignored = (el) => (ignore || []).some((s) => { try { return !!el.closest(s); } catch { return false; } });
  const R = (r) => r && { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top };
  const out = [];
  const add = (rule, el, measured, expected, note, rect) => {
    const v = { rule, selector: el ? cssPath(el) : 'html', measured, expected };
    if (note) v.note = note;
    if (rect) v.rect = R(rect);
    out.push(v);
  };
  if (!roots.length) return out;
  const interactive = [...document.querySelectorAll(interactiveSelector())].filter((el) => inScope(el) && !ignored(el));

  // overflow-x: the document scrolls sideways; report the outermost elements that stick out.
  if (want.has('overflow-x') && de.scrollWidth > vw + 1) {
    const offenders = [];
    for (const root of roots) {
      for (const el of root.querySelectorAll('*')) {
        if (ignored(el)) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const left = r.left + window.scrollX, right = r.right + window.scrollX;
        if (right <= vw + 1 && left >= -1) continue;
        if (offenders.some((o) => o.contains(el))) continue;
        let contained = getComputedStyle(el).position === 'fixed';
        for (let p = el.parentElement; !contained && p && p !== document.body && p !== de; p = p.parentElement) {
          const cs = getComputedStyle(p);
          if (cs.overflowX !== 'visible' || cs.position === 'fixed') contained = true;
        }
        if (contained || !isShown(el)) continue;
        offenders.push(el);
      }
    }
    for (const el of offenders.slice(0, 5)) {
      const r = el.getBoundingClientRect();
      add('overflow-x', el, `right edge ${Math.round(r.right + window.scrollX)}px, page scrollWidth ${de.scrollWidth}px`, `≤ ${vw}px`, null, r);
    }
    if (!offenders.length && !scope) add('overflow-x', null, `page scrollWidth ${de.scrollWidth}px`, `≤ ${vw}px`, 'no single offending element found');
  }

  // offscreen: an interactive element sticks out of the viewport sideways and no scroller can bring it in.
  if (want.has('offscreen')) {
    for (const el of interactive) {
      if (!isShown(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right <= vw + 1 && r.left >= -1) continue;
      const ci = clipInfo(el);
      if (!ci.rect || ci.scroller) continue;
      add('offscreen', el, `x ${Math.round(r.left)}–${Math.round(r.right)}px`, `within 0–${vw}px`, null, r);
    }
  }

  // tap-target (hard, WCAG 2.5.8): smaller than 24×24 unless inline in text, or spaced: a 24px circle
  // centred on it meets no other target's box and no undersized target's own 24px circle.
  // tap-target-touch (soft, a warning only): smaller than 44×44 on a touch viewport.
  if (want.has('tap-target') || want.has('tap-target-touch')) {
    const boxOf = (el) => {
      let r = el.getBoundingClientRect();
      const labels = el.labels ? [...el.labels].filter(isShown) : [];
      if (labels.length) {
        const rs = [r, ...labels.map((l) => l.getBoundingClientRect())];
        r = { left: Math.min(...rs.map((x) => x.left)), top: Math.min(...rs.map((x) => x.top)), right: Math.max(...rs.map((x) => x.right)), bottom: Math.max(...rs.map((x) => x.bottom)) };
      }
      return r;
    };
    const live = (el) => !el.disabled && el.getAttribute('aria-disabled') !== 'true' && isShown(el);
    // Every live target on the page is a neighbour, in scope or not.
    const targets = [...document.querySelectorAll(interactiveSelector())].filter(live).map((el) => ({ el, r: boxOf(el) }))
      .filter((t) => t.r.right - t.r.left > 0 && t.r.bottom - t.r.top > 0);
    const small = (r) => r.right - r.left < 23.5 || r.bottom - r.top < 23.5;
    const centre = (r) => [(r.left + r.right) / 2, (r.top + r.bottom) / 2];
    const toBox = ([x, y], r) => Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
    // Nested or labelled-by pairs are one target, not neighbours.
    const related = (a, b) => a.contains(b) || b.contains(a)
      || (a.labels && [...a.labels].some((l) => l.contains(b))) || (b.labels && [...b.labels].some((l) => l.contains(a)));
    const crowdedBy = (t) => {
      const c = centre(t.r);
      for (const o of targets) {
        if (o.el === t.el || related(t.el, o.el)) continue;
        if (toBox(c, o.r) < 11.5) return o;
        if (small(o.r)) { const oc = centre(o.r); if (Math.hypot(c[0] - oc[0], c[1] - oc[1]) < 23.5) return o; }
      }
      return null;
    };
    const inScan = new Set(interactive);
    for (const t of targets) {
      if (!inScan.has(t.el) || isInlineInText(t.el)) continue;
      const w = t.r.right - t.r.left, h = t.r.bottom - t.r.top;
      const size = `${Math.round(w)}×${Math.round(h)}px`;
      if (want.has('tap-target') && small(t.r)) {
        const o = crowdedBy(t);
        if (o) { add('tap-target', t.el, size, '≥ 24×24px', `undersized and within 24px of ${cssPath(o.el)}`, t.r); continue; }
      }
      if (touch && (w < 43.5 || h < 43.5)) add('tap-target-touch', t.el, size, '≥ 44×44px on touch', null, t.r);
    }
  }

  // occluded: the element at an interactive element's visible centre is something else.
  if (want.has('occluded')) {
    const dialogs = [...document.querySelectorAll('[aria-modal="true"], dialog[open], [role="dialog"], [role="alertdialog"]')].filter(isShown);
    const canScrollDown = window.scrollY + vh < de.scrollHeight - 1;
    for (const el of interactive) {
      if (el.disabled || !isShown(el)) continue;
      if (dialogs.length && !dialogs.some((d) => d.contains(el))) continue; // a modal is up: only its controls matter
      const ci = clipInfo(el);
      if (!ci.rect) continue;
      const left = Math.max(ci.rect.left, 0), right = Math.min(ci.rect.right, vw);
      const top = Math.max(ci.rect.top, 0), bottom = Math.min(ci.rect.bottom, vh);
      if (right - left < 1 || bottom - top < 1) continue; // not in the viewport
      const cx = (left + right) / 2, cy = (top + bottom) / 2;
      const hit = document.elementFromPoint(cx, cy);
      if (!hit || hit === el || el.contains(hit) || hit.contains(el)) continue;
      if (el.labels && [...el.labels].some((l) => l === hit || l.contains(hit))) continue;
      const layer = layerOf(hit);
      if (layer && !layer.contains(el)) {
        const lr = layer.getBoundingClientRect();
        if (lr.top <= 1 && cy < lr.bottom) continue;                     // scrolled under a top bar (sticky nav)
        if (lr.bottom >= vh - 1 && cy > lr.top && canScrollDown) continue; // scrolled under a bottom bar
        if ((lr.width * lr.height) >= vw * vh * 0.9) continue;           // full-screen overlay / backdrop
      }
      add('occluded', el, `covered by ${cssPath(hit)}`, 'element on top at its centre', null, el.getBoundingClientRect());
    }
  }

  // clipped: visible text cut by an overflow:hidden/clip box (ellipsis and line-clamp included).
  if (want.has('clipped')) {
    const seen = new Set();
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.nodeValue.trim()) continue;
        const parent = node.parentElement;
        if (!parent || seen.has(parent) || parent.closest('script, style, noscript, template, svg, textarea, select')) continue;
        if (ignored(parent) || !isShown(parent)) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const tr = range.getBoundingClientRect();
        if (tr.width < 1 || tr.height < 1) continue;
        const fs = parseFloat(getComputedStyle(parent).fontSize) || 16;
        let hit = null;
        for (let p = parent; p && p !== document.body && p !== de; p = p.parentElement) {
          const cs = getComputedStyle(p);
          const ox = cs.overflowX, oy = cs.overflowY;
          if (ox === 'auto' || ox === 'scroll' || oy === 'auto' || oy === 'scroll') break; // reachable by scrolling
          const hx = ox === 'hidden' || ox === 'clip', hy = oy === 'hidden' || oy === 'clip';
          if (hx || hy) {
            const pr = p.getBoundingClientRect();
            if (pr.width <= 2 || pr.height <= 2 || cs.clip !== 'auto' || cs.clipPath !== 'none') { hit = 'skip'; break; } // visually-hidden pattern
            const cl = pr.left + p.clientLeft, ct = pr.top + p.clientTop;
            const cr = cl + p.clientWidth, cb = ct + p.clientHeight;
            if (tr.right <= cl || tr.left >= cr || tr.bottom <= ct || tr.top >= cb) { hit = 'skip'; break; } // fully outside: hidden content, not clipped text
            const overX = hx ? Math.max(cl - tr.left, tr.right - cr) : 0;
            const overY = hy ? Math.max(ct - tr.top, tr.bottom - cb) : 0;
            if (overX > 1.5 || overY > 0.3 * fs + 1) { hit = { p, cw: cr - cl, ch: cb - ct }; break; }
          }
          if (cs.position === 'fixed') break;
        }
        if (!hit || hit === 'skip') continue;
        seen.add(parent);
        const text = node.nodeValue.trim().replace(/\s+/g, ' ');
        add('clipped', parent,
          `text ${Math.round(tr.width)}×${Math.round(tr.height)}px in ${Math.round(hit.cw)}×${Math.round(hit.ch)}px box`,
          'text fully visible',
          `"${text.length > 40 ? text.slice(0, 40) + '…' : text}"${hit.p === parent ? '' : ` cut by ${cssPath(hit.p)}`}`,
          parent.getBoundingClientRect());
        if (seen.size >= 10) break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// motion: snap sampler (rAF rect sampling) + layout-shift / long-animation-frame window

/**
 * Start sampling watched elements every animation frame. `watch` is 'auto' or a list of selectors
 * (re-queried every frame so elements that mount mid-window are picked up).
 */
export function snapStart({ watch = 'auto', ignore = [] } = {}) {
  if (window.__uicSnap) window.__uicSnap.stop();
  const isIgnored = (el) => (ignore || []).some((s) => { try { return !!el.closest(s); } catch { return false; } });
  const LAYOUT = /^(all|height|width|max-|min-|margin|padding|top|left|right|bottom|inset|flex|grid|font-size|line-height|border)/;
  const tracks = new Map();
  const styleFrames = new Map();
  const seen = {}; // explicit watch selector → number of sampled frames in which it matched ≥ 1 element
  let frame = 0, raf = 0, stopped = false;
  const track = (el) => {
    if (tracks.has(el) || tracks.size >= 40 || isIgnored(el)) return;
    let viewportPinned = false;
    const scrollers = [];
    for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.position === 'fixed' || cs.position === 'sticky') { viewportPinned = true; break; }
      if (p !== el && /(auto|scroll)/.test(cs.overflowX + cs.overflowY)) scrollers.push(p);
    }
    tracks.set(el, { el, viewportPinned, scrollers, frames: [] });
  };
  const initial = watch === 'auto' ? autoWatch(ignore) : [];
  initial.forEach(track);
  const mo = new MutationObserver((recs) => {
    for (const r of recs) {
      let s = styleFrames.get(r.target);
      if (!s) styleFrames.set(r.target, (s = new Set()));
      s.add(frame);
    }
  });
  mo.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['style'] });
  const animTargets = () => {
    const out = [];
    for (const a of document.getAnimations()) {
      if (!(a.playState === 'running' || a.pending)) continue;
      const t = a.effect && a.effect.target;
      if (!t || t.nodeType !== 1) continue;
      let layout = false;
      if (typeof a.transitionProperty === 'string') layout = LAYOUT.test(a.transitionProperty);
      else {
        try {
          layout = a.effect.getKeyframes().some((k) => Object.keys(k).some((p) => LAYOUT.test(p.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()))));
        } catch { layout = true; }
      }
      out.push({ t, layout });
    }
    return out;
  };
  const sample = () => {
    if (stopped) return;
    frame++;
    if (Array.isArray(watch)) {
      for (const s of watch) {
        seen[s] = seen[s] || 0;
        try { const els = document.querySelectorAll(s); if (els.length) seen[s]++; els.forEach(track); } catch { /* bad selector */ }
      }
    }
    const anims = animTargets();
    for (const tr of tracks.values()) {
      const el = tr.el;
      if (!el.isConnected) continue;
      const r = el.getBoundingClientRect();
      let x = r.left, y = r.top;
      if (!tr.viewportPinned) {
        x += window.scrollX; y += window.scrollY;
        for (const s of tr.scrollers) { x += s.scrollLeft; y += s.scrollTop; }
      }
      let anc4 = el;
      for (let i = 0; i < 4 && anc4.parentElement; i++) anc4 = anc4.parentElement;
      const animated = anims.some(({ t, layout }) => t === el || t.contains(el) || (layout && (el.contains(t) || anc4.contains(t))));
      tr.frames.push({ f: frame, x, y, w: r.width, h: r.height, a: animated });
      if (tr.frames.length > 600) tr.frames.shift();
    }
    raf = requestAnimationFrame(sample);
  };
  sample(); // baseline now, before the interaction starts; then every frame

  window.__uicSnap = {
    seen, // read after the window: a watch selector at 0 matched nothing in any sampled frame
    stop() { stopped = true; cancelAnimationFrame(raf); mo.disconnect(); },
    collect() {
      this.stop();
      const jumps = [];
      for (const tr of tracks.values()) {
        const el = tr.el;
        let anc4 = el;
        for (let i = 0; i < 4 && anc4.parentElement; i++) anc4 = anc4.parentElement;
        // inline style written in >= 2 frames around the jump by el / an ancestor / a descendant / a near relative
        // = a rAF-driven (framer-motion style) animation, not an instant snap.
        const styleSpread = (f) => {
          const hits = new Set();
          for (const [t, frames] of styleFrames) {
            if (!(t === el || t.contains(el) || el.contains(t) || anc4.contains(t))) continue;
            for (const g of frames) if (g >= f - 2 && g <= f + 2) hits.add(g);
            if (hits.size >= 2) return true;
          }
          return false;
        };
        let worst = null;
        for (let i = 1; i < tr.frames.length; i++) {
          const a = tr.frames[i - 1], b = tr.frames[i];
          if (b.f !== a.f + 1) continue;
          if ((!a.w && !a.h) || (!b.w && !b.h)) continue; // appear / disappear is not a snap
          const deltas = { y: b.y - a.y, x: b.x - a.x, height: b.h - a.h, width: b.w - a.w };
          const [dim, d] = Object.entries(deltas).sort((p, q) => Math.abs(q[1]) - Math.abs(p[1]))[0];
          if (Math.abs(d) <= 8 || a.a || b.a || styleSpread(b.f)) continue;
          if (!worst || Math.abs(d) > Math.abs(worst.d)) {
            const key = { y: 'y', x: 'x', height: 'h', width: 'w' }[dim];
            worst = { d, dim, from: a[key], to: b[key] };
          }
        }
        if (worst) {
          const r = el.isConnected ? el.getBoundingClientRect() : null;
          jumps.push({
            selector: cssPath(el),
            measured: `${worst.dim} ${Math.round(worst.from)}→${Math.round(worst.to)}px in one frame`,
            delta: Math.round(Math.abs(worst.d)),
            rect: r && { x: r.left, y: r.top, w: r.width, h: r.height },
          });
        }
      }
      return { watched: tracks.size, frames: frame, jumps };
    },
  };
  return { watched: tracks.size, now: performance.now(), origin: performance.timeOrigin };
}

export function snapCollect() {
  return window.__uicSnap ? window.__uicSnap.collect() : null;
}

/** Layout shifts (CLS session-window max, no recent input) and long animation frames since `since`
 *  (a performance.now() of the document with time origin `origin`; a newer document counts from 0). */
export function windowStats({ since = 0, origin = null } = {}) {
  const u = window.__uic;
  if (!u) return null;
  if (origin !== null && origin !== performance.timeOrigin) since = 0;
  const shifts = u.shifts.filter((s) => s.t >= since && !s.input);
  let max = 0, cur = 0, start = 0, last = 0, maxSrc = null, curBig = null;
  for (const s of shifts) {
    if (cur && (s.t - last > 1000 || s.t - start > 5000)) { cur = 0; curBig = null; }
    if (!cur) start = s.t;
    cur += s.v; last = s.t;
    if (!curBig || s.v > curBig.v) curBig = s;
    if (cur > max) { max = cur; maxSrc = curBig; }
  }
  const loafs = u.loafs.filter((l) => l.t >= since);
  const longest = loafs.reduce((m, l) => (l.d > (m ? m.d : 0) ? l : m), null);
  return {
    cls: Math.round(max * 1000) / 1000,
    clsSource: maxSrc && maxSrc.src && maxSrc.src[0] || null,
    longestLoaf: longest ? Math.round(longest.d) : 0,
    loafScript: longest ? longest.script : '',
    longLoafs: loafs.filter((l) => l.d > 100).length,
    now: performance.now(),
  };
}

/** Page-load numbers: ttfb, fcp, lcp, whole-page cls, longest LoAF. */
export function perfSnapshot() {
  const nav = performance.getEntriesByType('navigation')[0];
  const fcpE = performance.getEntriesByName('first-contentful-paint')[0];
  const u = window.__uic || { shifts: [], loafs: [], lcp: [] };
  const lcpE = u.lcp[u.lcp.length - 1];
  let max = 0, cur = 0, start = 0, last = 0;
  for (const s of u.shifts) {
    if (s.input) continue;
    if (cur && (s.t - last > 1000 || s.t - start > 5000)) cur = 0;
    if (!cur) start = s.t;
    cur += s.v; last = s.t;
    max = Math.max(max, cur);
  }
  return {
    ttfb: nav ? Math.round(nav.responseStart - nav.startTime) : null,
    fcp: fcpE ? Math.round(fcpE.startTime) : null,
    lcp: lcpE ? Math.round(lcpE.t) : null,
    lcpEl: lcpE ? lcpE.el : null,
    cls: Math.round(max * 1000) / 1000,
    longestLoaf: Math.round(u.loafs.reduce((m, l) => Math.max(m, l.d), 0)),
  };
}
