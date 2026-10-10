// Removes lettering from an NBA logo SVG.
// Every shape is split into subpaths; a subpath is dropped when its bbox lies fully inside one
// of the logo's text regions (fractions of the viewBox). Rules per team live in rules.json:
//   { "<id>": { "regions": [ {"box":[x0,y0,x1,y1]} | {"ring":[cx,cy,r0,r1]} ], "maxSize": 0.2,
//              "keep": ["e3.s1"], "drop": ["e7"] } }
// usage: node strip.cjs <svgDir> <outDir> [--debug]   (debug paints dropped parts magenta)
const fs = require("fs"), path = require("path"), svgpath = require("svgpath");
const [srcDir, outDir, flag] = process.argv.slice(2);
const DEBUG = flag === "--debug";
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "rules.json"), "utf8"));
fs.mkdirSync(outDir, { recursive: true });

function splitPath(d) {
  const subs = []; let cur = null;
  svgpath(d).abs().unshort().iterate((seg) => {
    if (seg[0] === "M") { cur = { segs: [], pts: [] }; subs.push(cur); }
    cur.segs.push(seg);
    const s = seg[0], a = seg.slice(1);
    if (s === "A") { cur.pts.push([a[5], a[6]]); cur.arcR = Math.max(cur.arcR || 0, a[0], a[1]); }
    else if (s === "H") cur.pts.push([a[0], null]);
    else if (s === "V") cur.pts.push([null, a[0]]);
    else for (let i = 0; i + 1 < a.length; i += 2) cur.pts.push([a[i], a[i + 1]]);
  });
  // resolve H/V partial points against previous point
  for (const sp of subs) {
    let px = 0, py = 0;
    sp.pts = sp.pts.map(([x, y]) => { x = x ?? px; y = y ?? py; px = x; py = y; return [x, y]; });
    const xs = sp.pts.map((p) => p[0]), ys = sp.pts.map((p) => p[1]), r = sp.arcR || 0;
    sp.bbox = [Math.min(...xs) - r, Math.min(...ys) - r, Math.max(...xs) + r, Math.max(...ys) + r];
    sp.d = sp.segs.map((s) => s[0] + s.slice(1).join(" ")).join("");
  }
  return subs;
}

function shapeToPath(tag, attrs) {
  const n = (k) => parseFloat((attrs.match(new RegExp(`\\b${k}="([^"]*)"`)) || [])[1] || 0);
  if (tag === "path") return (attrs.match(/\bd="([^"]*)"/s) || [])[1];
  if (tag === "polygon" || tag === "polyline") {
    const p = (attrs.match(/\bpoints="([^"]*)"/s) || [])[1].trim().split(/[\s,]+/).map(Number);
    let d = `M${p[0]} ${p[1]}`; for (let i = 2; i + 1 < p.length; i += 2) d += `L${p[i]} ${p[i + 1]}`;
    return d + (tag === "polygon" ? "Z" : "");
  }
  if (tag === "rect") { const x = n("x"), y = n("y"), w = n("width"), h = n("height"); return `M${x} ${y}H${x + w}V${y + h}H${x}Z`; }
  if (tag === "circle" || tag === "ellipse") {
    const cx = n("cx"), cy = n("cy"), rx = tag === "circle" ? n("r") : n("rx"), ry = tag === "circle" ? n("r") : n("ry");
    return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
  }
}

function inside(bb, reg, W, H) {
  const [x0, y0, x1, y1] = [bb[0] / W, bb[1] / H, bb[2] / W, bb[3] / H];
  if (reg.box) { const [a, b, c, d] = reg.box; return x0 >= a && y0 >= b && x1 <= c && y1 <= d; }
  if (reg.ring) {
    const [cx, cy, r0, r1] = reg.ring;
    const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
    return corners.every(([x, y]) => { const r = Math.hypot(x - cx, y - cy); return r >= r0 && r <= r1; });
  }
  return false;
}

const report = {};
for (const f of fs.readdirSync(srcDir).filter((f) => f.endsWith(".svg"))) {
  const id = f.replace(".svg", ""), rule = rules[id];
  let svg = fs.readFileSync(path.join(srcDir, f), "utf8");
  const vb = svg.match(/viewBox="([^"]*)"/)[1].trim().split(/[\s,]+/).map(Number), W = vb[2], H = vb[3];
  let el = -1, dropped = 0;
  if (rule) {
    svg = svg.replace(/<(path|polygon|polyline|rect|circle|ellipse)\b([^>]*?)(\/?)>/gs, (m, tag, attrs, selfClose) => {
      el++;
      const d = shapeToPath(tag, attrs); if (!d) return m;
      const subs = splitPath(d);
      const keepSubs = subs.filter((sp, i) => {
        const key = `e${el}.s${i}`, size = Math.max(sp.bbox[2] - sp.bbox[0], sp.bbox[3] - sp.bbox[1]) / Math.max(W, H);
        if ((rule.keep || []).includes(key) || (rule.keep || []).includes(`e${el}`)) return true;
        if ((rule.drop || []).includes(key) || (rule.drop || []).includes(`e${el}`)) return false;
        const hit = (rule.regions || []).some((r) => inside(sp.bbox, r, W, H)) && size <= (rule.maxSize ?? 1) && size >= (rule.minSize ?? 0);
        return !hit;
      });
      const gone = subs.filter((s) => !keepSubs.includes(s));
      dropped += gone.length;
      if (!gone.length) return m;
      const rest = attrs.replace(/\b(d|points|x|y|width|height|cx|cy|r|rx|ry)="[^"]*"/gs, "");
      const kept = keepSubs.length ? `<path${rest} d="${keepSubs.map((s) => s.d).join("")}"${selfClose ? "/" : "/"}>` : "";
      const dbg = DEBUG ? `<path d="${gone.map((s) => s.d).join("")}" fill="#ff00ff" fill-opacity="0.85"/>` : "";
      // closing tag for non-self-closing shapes is stripped below
      return kept + dbg + (selfClose ? "" : "<!--open-->");
    });
    svg = svg.replace(/<!--open-->\s*<\/(path|polygon|polyline|rect|circle|ellipse)>/g, "");
  }
  report[id] = dropped;
  fs.writeFileSync(path.join(outDir, f), svg);
}
console.log(JSON.stringify(report));
