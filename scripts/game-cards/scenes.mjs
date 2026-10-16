// Hand-built SVG scenes, one per game, in the Series Winner look: charcoal panels,
// one orange accent, glow, a dark bottom third for the tile's text. Rendered by render.mjs.
// Canvas is 1600x900; keep subjects roughly inside y 90..640.
import { BRAND } from "./lib.mjs";

export const W = 1600;
export const H = 900;
const O = BRAND; // #ff6a1a
const O2 = "#ffb27a"; // warm highlight
const LINE = "#3a2f28"; // unlit edge
const DARK = "#15110f";

const DEFS = `
<defs>
  <radialGradient id="bg" cx="86%" cy="6%" r="75%">
    <stop offset="0" stop-color="#4a2410"/><stop offset="0.45" stop-color="#1b1411"/><stop offset="1" stop-color="#0b0b0b"/>
  </radialGradient>
  <linearGradient id="panel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2320"/><stop offset="1" stop-color="#14100e"/></linearGradient>
  <linearGradient id="panelLit" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a2a10"/><stop offset="1" stop-color="#2a150a"/></linearGradient>
  <linearGradient id="orange" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${O2}"/><stop offset="0.55" stop-color="${O}"/><stop offset="1" stop-color="#b84a0e"/></linearGradient>
  <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#241a15" stop-opacity="0"/><stop offset="0.35" stop-color="#241a15"/><stop offset="1" stop-color="#0b0b0b"/></linearGradient>
  <linearGradient id="fog" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a1d14" stop-opacity="0"/><stop offset="1" stop-color="#2a1d14" stop-opacity="0.55"/></linearGradient>
  <linearGradient id="cone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${O}" stop-opacity="0.35"/><stop offset="1" stop-color="${O}" stop-opacity="0"/></linearGradient>
  <filter id="glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="10" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="glowBig" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="26" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter>
  <filter id="blur14"><feGaussianBlur stdDeviation="14"/></filter>
  <filter id="blur40"><feGaussianBlur stdDeviation="40"/></filter>
  <pattern id="hex" width="84" height="48.5" patternUnits="userSpaceOnUse" patternTransform="scale(2.4)">
    <path d="M21 0 L63 0 L84 24.25 L63 48.5 L21 48.5 L0 24.25 Z" fill="none" stroke="#2a221d" stroke-width="1.2"/>
  </pattern>
</defs>`;

/** Floor plane + horizon line; `reflect` draws a soft orange pool under the subject. */
function floor(reflect = true, y = 600) {
  return `
<rect x="0" y="${y}" width="${W}" height="${H - y}" fill="url(#floor)"/>
<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#2c231d" stroke-width="2"/>
${reflect ? `<ellipse cx="800" cy="${y + 40}" rx="420" ry="46" fill="${O}" opacity="0.16" filter="url(#blur40)"/>` : ""}`;
}

function panel(x, y, w, h, { lit = false, r = 12 } = {}) {
  return `<g${lit ? ' filter="url(#glow)"' : ""}>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#${lit ? "panelLit" : "panel"})" stroke="${lit ? O : LINE}" stroke-width="${lit ? 3 : 2}"/>
  <rect x="${x + 6}" y="${y + 5}" width="${w - 12}" height="2" rx="1" fill="${lit ? O2 : "#4a3b31"}" opacity="${lit ? 0.9 : 0.5}"/>
</g>`;
}

function silhouette(cx, baseY, scale = 1, { lit = false } = {}) {
  const s = scale;
  return `<g transform="translate(${cx} ${baseY}) scale(${s})"${lit ? ' filter="url(#glow)"' : ""}>
  <path d="M-120 0 C-120 -95 -70 -135 0 -135 C70 -135 120 -95 120 0 Z" fill="${lit ? "#2a1a10" : DARK}" stroke="${lit ? O : LINE}" stroke-width="${lit ? 5 : 3}"/>
  <circle cx="0" cy="-185" r="52" fill="${lit ? "#2a1a10" : DARK}" stroke="${lit ? O : LINE}" stroke-width="${lit ? 5 : 3}"/>
</g>`;
}

function pedestal(cx, topY, w = 220, h = 140) {
  return `
<polygon points="${cx - w / 2},${topY} ${cx + w / 2},${topY} ${cx + w / 2 + 16},${topY + h} ${cx - w / 2 - 16},${topY + h}" fill="url(#panel)" stroke="${LINE}" stroke-width="2"/>
<rect x="${cx - w / 2 - 6}" y="${topY - 10}" width="${w + 12}" height="14" rx="4" fill="#2a2320" stroke="${O}" stroke-width="2" filter="url(#glow)"/>`;
}

function trophy(cx, baseY, scale = 1) {
  return `<g transform="translate(${cx} ${baseY}) scale(${scale})" filter="url(#glowBig)">
  <path d="M-70 -300 L70 -300 L58 -190 C50 -140 25 -118 0 -112 C-25 -118 -50 -140 -58 -190 Z" fill="url(#orange)"/>
  <path d="M-70 -280 C-120 -280 -120 -200 -62 -196" fill="none" stroke="url(#orange)" stroke-width="12" stroke-linecap="round"/>
  <path d="M70 -280 C120 -280 120 -200 62 -196" fill="none" stroke="url(#orange)" stroke-width="12" stroke-linecap="round"/>
  <rect x="-14" y="-112" width="28" height="60" fill="url(#orange)"/>
  <rect x="-60" y="-52" width="120" height="22" rx="4" fill="url(#orange)"/>
  <rect x="-80" y="-30" width="160" height="30" rx="6" fill="#1a120d" stroke="${O}" stroke-width="3"/>
</g>`;
}

function ball(cx, cy, r) {
  return `<g filter="url(#glowBig)">
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#orange)"/>
  <path d="M${cx - r} ${cy} A${r} ${r} 0 0 0 ${cx + r} ${cy}" fill="none" stroke="#5a2410" stroke-width="5"/>
  <path d="M${cx} ${cy - r} A${r} ${r} 0 0 1 ${cx} ${cy + r}" fill="none" stroke="#5a2410" stroke-width="5"/>
  <path d="M${cx - r * 0.7} ${cy - r * 0.7} Q${cx} ${cy} ${cx - r * 0.7} ${cy + r * 0.7}" fill="none" stroke="#5a2410" stroke-width="5"/>
  <path d="M${cx + r * 0.7} ${cy - r * 0.7} Q${cx} ${cy} ${cx + r * 0.7} ${cy + r * 0.7}" fill="none" stroke="#5a2410" stroke-width="5"/>
</g>`;
}

/** Deterministic pseudo-random so renders are reproducible. */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** `zoom` enlarges the whole scene around its centre so subjects fill the 206px tile. */
function wrap(body, { floorY = 600, reflect = true, hexes = true, zoom = 1.15 } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
${DEFS}
<rect width="${W}" height="${H}" fill="url(#bg)"/>
${hexes ? `<rect width="${W}" height="${H}" fill="url(#hex)" opacity="0.32"/>` : ""}
<g transform="translate(800 400) scale(${zoom}) translate(-800 -400)">
${floor(reflect, floorY)}
${body}
</g>
<rect width="${W}" height="${H}" fill="url(#fog)" opacity="0.6"/>
</svg>`;
}

// ---------------------------------------------------------------- scenes

function seriesWinner() {
  let b = "";
  const rows = [150, 250, 350, 450];
  for (const side of [-1, 1]) {
    const x1 = side < 0 ? 130 : W - 130 - 250;
    const x2 = side < 0 ? 430 : W - 430 - 180;
    rows.forEach((y, i) => {
      b += panel(x1, y, 250, 36, { lit: i === 1 });
      b += panel(x1, y + 44, 250, 36, { lit: false });
      const cx = side < 0 ? x1 + 250 : x1;
      const tx = side < 0 ? x2 : x2 + 180;
      b += `<path d="M${cx} ${y + 18} H${cx + side * 24} V${y + 62} H${cx} M${cx + side * 24} ${y + 40} H${tx}" fill="none" stroke="${i === 1 ? O : LINE}" stroke-width="3"${i === 1 ? ' filter="url(#glow)"' : ""}/>`;
      if (i % 2 === 0) b += panel(x2, y + 62, 180, 36, { lit: i === 0 });
    });
  }
  b += pedestal(800, 470, 240, 150);
  b += trophy(800, 470, 1.05);
  return wrap(b);
}

function nameLogo() {
  let b = "";
  const shield = (x, y, lit) => `<g transform="translate(${x} ${y})"${lit ? ' filter="url(#glow)"' : ""}>
  <path d="M0 0 H170 V110 Q170 190 85 230 Q0 190 0 110 Z" fill="url(#${lit ? "panelLit" : "panel"})" stroke="${lit ? O : LINE}" stroke-width="${lit ? 4 : 2.5}"/>
  <path d="M20 20 H150 V108 Q150 170 85 200 Q20 170 20 108 Z" fill="none" stroke="${lit ? O2 : "#4a3b31"}" stroke-width="1.5" opacity="0.7"/>
</g>`;
  const xs = [380, 630, 880, 1130 - 60];
  [0, 1].forEach((row) => xs.slice(0, 3).forEach((x, i) => (b += shield(x + 60 * 2 + 30, 110 + row * 270, row === 0 && i === 1))));
  return wrap(b, { floorY: 660 });
}

/** MVP trophy: a leaping figure reaching up to a crystal ball, on a rock and a faceted base,
 *  in front of draped curtains (after the real MVP trophy photo, re-cast in the brand palette). */
function guessMvps() {
  let b = `<defs>
  <linearGradient id="fold" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#120805"/><stop offset="0.45" stop-color="#4a1d0a"/><stop offset="0.6" stop-color="#62280d"/><stop offset="1" stop-color="#120805"/>
  </linearGradient>
  <pattern id="drape" width="96" height="900" patternUnits="userSpaceOnUse"><rect width="96" height="900" fill="url(#fold)"/></pattern>
  <pattern id="drape2" width="150" height="900" patternUnits="userSpaceOnUse" patternTransform="translate(37 0)"><rect width="150" height="900" fill="url(#fold)"/></pattern>
  <linearGradient id="drapeShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b0b0b" stop-opacity="0.8"/><stop offset="0.45" stop-color="#0b0b0b" stop-opacity="0.15"/><stop offset="1" stop-color="#0b0b0b" stop-opacity="0.7"/></linearGradient>
  <radialGradient id="spot" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${O}" stop-opacity="0.32"/><stop offset="1" stop-color="${O}" stop-opacity="0"/></radialGradient>
  <linearGradient id="gold" gradientUnits="userSpaceOnUse" x1="726" y1="0" x2="862" y2="0">
    <stop offset="0" stop-color="#ffc49a"/><stop offset="0.3" stop-color="#f2873f"/><stop offset="0.62" stop-color="#c9550f"/><stop offset="1" stop-color="#5a2208"/>
  </linearGradient>
  <radialGradient id="halo" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${O}" stop-opacity="0.5"/><stop offset="1" stop-color="${O}" stop-opacity="0"/></radialGradient>
  <radialGradient id="crystal" cx="38%" cy="34%" r="70%"><stop offset="0" stop-color="#fff6ee"/><stop offset="0.5" stop-color="#ffc49a"/><stop offset="1" stop-color="${O}"/></radialGradient>
</defs>`;
  // Curtain backdrop, darker at the top and bottom, warmer behind the trophy.
  b += `<rect width="${W}" height="740" fill="url(#drape)"/><rect width="${W}" height="740" fill="url(#drape2)" opacity="0.5"/>
<rect width="${W}" height="740" fill="url(#drapeShade)"/>
<ellipse cx="800" cy="360" rx="560" ry="420" fill="url(#spot)"/>`;
  // Faceted black base with a blank plaque, then the rock the figure stands on.
  b += pedestal(800, 650, 300, 100);
  b += `<rect x="740" y="680" width="120" height="38" rx="4" fill="none" stroke="${O2}" stroke-width="2" opacity="0.6"/>`;
  b += `<polygon points="690,646 704,604 738,586 770,596 800,572 842,586 876,602 906,646" fill="#2a1a10" stroke="${O}" stroke-width="2.5" filter="url(#glow)"/>
<path d="M738 586 L752 646 M800 572 L790 646 M842 586 L860 646 M704 604 L770 596 L842 586" stroke="#120a06" stroke-width="3" fill="none" opacity="0.8"/>`;
  // The leaping figure, built from tapered two-tone facets so it reads as cast, faceted metal:
  // every part is lit on its left side and shaded on its right, with joints rounded off.
  const pts = (arr) => arr.map((p) => p.join(",")).join(" ");
  const limb = ([x1, y1], [x2, y2], w1, w2) => {
    const L = Math.hypot(x2 - x1, y2 - y1), nx = -(y2 - y1) / L, ny = (x2 - x1) / L;
    const A = [x1 + (nx * w1) / 2, y1 + (ny * w1) / 2], B = [x2 + (nx * w2) / 2, y2 + (ny * w2) / 2];
    const C = [x2 - (nx * w2) / 2, y2 - (ny * w2) / 2], D = [x1 - (nx * w1) / 2, y1 - (ny * w1) / 2];
    // The shaded half is the one whose edge lies further right.
    const shade = A[0] + B[0] > C[0] + D[0] ? [A, B, [x2, y2], [x1, y1]] : [[x1, y1], [x2, y2], C, D];
    const lit = shade[0] === A ? [D, C] : [A, B];
    return `<polygon points="${pts([A, B, C, D])}" fill="url(#gold)"/>
<polygon points="${pts(shade)}" fill="#4a1c06" opacity="0.55"/>
<line x1="${lit[0][0]}" y1="${lit[0][1]}" x2="${lit[1][0]}" y2="${lit[1][1]}" stroke="#fff1e4" stroke-width="2.5" opacity="0.55"/>
<circle cx="${x2}" cy="${y2}" r="${w2 / 2}" fill="url(#gold)"/>`;
  };
  const torso = [[762, 300], [806, 292], [822, 330], [806, 382], [798, 438], [752, 444], [748, 398], [740, 342]];
  let fig = "";
  fig += limb([764, 312], [742, 378], 26, 20) + limb([742, 378], [764, 432], 20, 15); // back arm, down
  fig += limb([756, 440], [728, 504], 42, 28) + limb([728, 504], [748, 562], 28, 16) + limb([748, 562], [754, 592], 16, 6); // bent leg
  fig += `<polygon points="${pts(torso)}" fill="url(#gold)"/>
<polygon points="790,294 822,330 806,382 798,438 776,442 786,380" fill="#4a1c06" opacity="0.55"/>
<polygon points="764,326 790,352 776,398 754,370" fill="#ffe2c8" opacity="0.14"/>
<path d="M762 300 L740 342 L748 398 L752 444" fill="none" stroke="#fff1e4" stroke-width="2.5" opacity="0.55"/>`;
  fig += limb([786, 438], [798, 516], 46, 30) + limb([798, 516], [808, 584], 30, 18) + limb([808, 584], [826, 594], 18, 10); // standing leg
  fig += limb([782, 300], [786, 286], 18, 18); // neck
  fig += `<ellipse cx="776" cy="262" rx="24" ry="30" transform="rotate(-30 776 262)" fill="url(#gold)"/>
<path d="M790 238 A24 30 -30 0 1 792 284 L780 262 Z" fill="#4a1c06" opacity="0.55"/>`;
  fig += limb([798, 304], [822, 218], 30, 24) + limb([822, 218], [846, 138], 24, 17); // raised arm
  fig += `<path d="M832 140 Q852 116 878 130" fill="none" stroke="url(#gold)" stroke-width="10" stroke-linecap="round"/>`;
  // Soft orange halo behind the figure (the figure itself stays sharp).
  b += `<ellipse cx="796" cy="340" rx="190" ry="320" fill="url(#halo)"/>`;
  b += `<g transform="translate(800 600) scale(1.08) translate(-800 -600)">${fig}`;
  // Crystal ball with a few facet lines.
  b += `<circle cx="858" cy="88" r="40" fill="url(#crystal)" filter="url(#glowBig)"/>
<g stroke="#fff6ee" stroke-width="1.6" fill="none" opacity="0.65">
  <path d="M822 76 L858 60 L894 80 M828 108 L858 124 L890 104 M858 60 L846 92 L858 124 M846 92 L822 76 M846 92 L894 80 M846 92 L890 104"/>
</g></g>`;
  return wrap(b, { floorY: 740, hexes: false, zoom: 1.02 });
}

function startingFive() {
  let b = "";
  [360, 580, 800, 1020, 1240].forEach((x, i) => (b += silhouette(x, 560, i === 2 ? 1.25 : 1, { lit: i === 2 })));
  b += `<line x1="200" y1="560" x2="1400" y2="560" stroke="${O}" stroke-width="3" opacity="0.5"/>`;
  return wrap(b, { floorY: 560 });
}

function wordle() {
  const r = rng(3);
  let b = `<g transform="translate(800 400) skewY(-4) translate(-800 -400)">`;
  for (let row = 0; row < 6; row++)
    for (let col = 0; col < 5; col++) {
      const lit = row < 3 && r() > 0.55;
      b += panel(800 - 230 + col * 94, 110 + row * 92, 82, 82, { lit, r: 10 });
    }
  b += "</g>";
  return wrap(b, { floorY: 680 });
}

/** Game-show survey board ("We asked 100 NBA fans"): oval board with bulb rim, score wings,
 *  a 2x4 answer grid with some answers revealed, podiums on a glossy floor. */
function fanFavorites() {
  const answers = [
    [1, "JORDAN", 38, true], [2, "LEBRON", 31, true], [3, "KOBE", 12, true], [4, "KAREEM", 7, false],
    [5, "CURRY", 5, false], [6, "MAGIC", 3, true], [7, "BIRD", 2, false], [8, "DUNCAN", 2, false],
  ];
  const T = (x, y, s, size, fill, anchor = "middle") =>
    `<text x="${x}" y="${y}" font-family="Russo One" font-size="${size}" fill="${fill}" text-anchor="${anchor}" dominant-baseline="central">${s}</text>`;
  let b = `<defs>
  <pattern id="leds" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="11" cy="11" r="3.2" fill="${O}" opacity="0.32"/></pattern>
  <pattern id="stars" width="70" height="70" patternUnits="userSpaceOnUse">
    <circle cx="12" cy="18" r="1.6" fill="${O2}" opacity="0.35"/><circle cx="48" cy="40" r="1.2" fill="${O2}" opacity="0.25"/><circle cx="30" cy="62" r="1" fill="${O2}" opacity="0.3"/>
  </pattern>
</defs>
<rect width="${W}" height="700" fill="url(#stars)"/>`;
  // Score wings behind the oval.
  b += `<rect x="230" y="252" width="1140" height="96" rx="48" fill="url(#panel)" stroke="${O}" stroke-width="4" filter="url(#glow)"/>`;
  for (const [x, s] of [[262, "84"], [1198, "57"]])
    b += `<rect x="${x}" y="266" width="140" height="68" rx="10" fill="#1a0f08" stroke="${O2}" stroke-width="2.5"/>${T(x + 70, 301, s, 46, O2)}`;
  // The oval board: glowing rim, a ring of bulbs, LED dot field inside.
  b += `<ellipse cx="800" cy="300" rx="362" ry="272" fill="#100b08" stroke="${O}" stroke-width="10" filter="url(#glow)"/>
<ellipse cx="800" cy="300" rx="336" ry="248" fill="url(#leds)"/>`;
  for (let i = 0; i < 56; i++) {
    const a = (i / 56) * Math.PI * 2;
    b += `<circle cx="${800 + 349 * Math.cos(a)}" cy="${300 + 260 * Math.sin(a)}" r="4.5" fill="${O2}" opacity="0.9"/>`;
  }
  // Top counter.
  b += panel(735, 62, 130, 66, { lit: true, r: 10 }) + T(800, 96, "100", 42, "#fff1e4");
  // Answer grid.
  b += `<rect x="505" y="146" width="590" height="302" rx="12" fill="#0e0a08" stroke="${O}" stroke-width="4"/>`;
  for (const [n, name, pts, shown] of answers) {
    const col = n <= 4 ? 0 : 1, row = (n - 1) % 4;
    const x = 520 + col * 290, y = 158 + row * 72;
    b += panel(x, y, 270, 62, { lit: shown, r: 8 });
    if (shown) {
      b += T(x + 18, y + 33, name, 30, "#fff1e4", "start");
      b += `<rect x="${x + 206}" y="${y + 8}" width="54" height="46" rx="6" fill="#1a0f08" stroke="${O2}" stroke-width="2"/>${T(x + 233, y + 33, pts, 28, O2)}`;
    } else {
      b += `<ellipse cx="${x + 135}" cy="${y + 31}" rx="34" ry="22" fill="#241309" stroke="${O}" stroke-width="3"/>${T(x + 135, y + 33, n, 26, O2)}`;
    }
  }
  // Podiums: two contestants and the host, LED faces with lit tops.
  for (const [x, w] of [[470, 150], [725, 150], [980, 150]]) {
    const host = x === 725;
    const top = host ? 610 : 596;
    b += `<rect x="${x + (host ? 25 : 0)}" y="${top}" width="${host ? 100 : w}" height="${700 - top}" rx="8" fill="url(#panel)" stroke="${LINE}" stroke-width="2"/>
<rect x="${x + (host ? 35 : 12)}" y="${top + 14}" width="${host ? 80 : w - 24}" height="${700 - top - 26}" rx="6" fill="url(#leds)" opacity="${host ? 0.6 : 1}"/>
<rect x="${x + (host ? 19 : -6)}" y="${top - 8}" width="${host ? 112 : w + 12}" height="12" rx="4" fill="#2a2320" stroke="${O}" stroke-width="2" filter="url(#glow)"/>`;
  }
  return wrap(b, { floorY: 700, hexes: false, zoom: 1 });
}

function heatmap() {
  let b = `<g transform="translate(800 400) scale(1 0.82) translate(-800 -400)">`;
  const R = 46, dx = R * Math.sqrt(3), dy = R * 1.5;
  for (let row = -3; row <= 3; row++)
    for (let col = -7; col <= 7; col++) {
      const cx = 800 + col * dx + (row % 2 ? dx / 2 : 0), cy = 380 + row * dy;
      const d = Math.hypot((cx - 760) / 1.1, cy - 360);
      const heat = Math.max(0, 1 - d / 260);
      const pts = Array.from({ length: 6 }, (_, k) => {
        const a = (Math.PI / 3) * k + Math.PI / 6;
        return `${cx + (R - 4) * Math.cos(a)},${cy + (R - 4) * Math.sin(a)}`;
      }).join(" ");
      b += `<polygon points="${pts}" fill="${heat > 0.05 ? O : DARK}" opacity="${heat > 0.05 ? 0.25 + heat * 0.75 : 1}" stroke="${heat > 0.4 ? O2 : LINE}" stroke-width="2"${heat > 0.6 ? ' filter="url(#glow)"' : ""}/>`;
    }
  b += "</g>";
  return wrap(b, { floorY: 680 });
}

function connections() {
  let b = "";
  const lifted = new Set([1, 6, 9, 14]);
  const centres = [];
  for (let i = 0; i < 16; i++) {
    const col = i % 4, row = Math.floor(i / 4);
    const lift = lifted.has(i) ? -22 : 0;
    const x = 800 - 260 + col * 132, y = 140 + row * 116 + lift;
    if (lifted.has(i)) centres.push([x + 56, y + 48]);
    b += panel(x, y, 112, 96, { lit: lifted.has(i) });
  }
  const path = centres.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
  b = `<path d="${path}" fill="none" stroke="${O}" stroke-width="4" stroke-linejoin="round" filter="url(#glow)" opacity="0.9"/>` + b;
  return wrap(b, { floorY: 660 });
}

function careerPath() {
  const pts = [[260, 520], [470, 300], [680, 430], [900, 220], [1120, 380], [1340, 260]];
  let b = `<g opacity="0.35">${[0, 1, 2, 3, 4].map((i) => `<line x1="0" y1="${620 + i * 60}" x2="${W}" y2="${620 + i * 60}" stroke="${LINE}" stroke-width="1.5"/>`).join("")}</g>`;
  b += `<path d="${pts.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ")}" fill="none" stroke="url(#orange)" stroke-width="8" stroke-linejoin="round" stroke-linecap="round" filter="url(#glow)"/>`;
  pts.forEach(([x, y], i) => {
    const last = i === pts.length - 1;
    b += `<circle cx="${x}" cy="${y}" r="${last ? 40 : 28}" fill="${last ? "url(#orange)" : DARK}" stroke="${O}" stroke-width="5" filter="url(#${last ? "glowBig" : "glow"})"/>`;
  });
  return wrap(b, { floorY: 620 });
}

function nbaGrid() {
  let b = `<rect x="492" y="92" width="616" height="616" rx="20" fill="none" stroke="${O}" stroke-width="4" filter="url(#glow)" opacity="0.9"/>`;
  for (let i = 0; i < 3; i++) {
    b += panel(640 + i * 150, 110, 130, 60);
    b += panel(510, 260 + i * 150, 110, 130);
  }
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) b += panel(640 + c * 150, 260 + r * 150, 130, 130, { lit: r === 1 && c === 1, r: 16 });
  return wrap(b, { floorY: 720, reflect: false });
}

function whoAreYa() {
  const r = rng(5);
  let pix = "";
  for (let i = 0; i < 140; i++) {
    const s = 18 + Math.floor(r() * 3) * 18;
    pix += `<rect x="${560 + Math.floor((r() * 480) / 18) * 18}" y="${120 + Math.floor((r() * 460) / 18) * 18}" width="${s}" height="${s}" fill="${r() > 0.75 ? O : "#2a1f18"}" opacity="${0.15 + r() * 0.35}"/>`;
  }
  let b = `<g filter="url(#blur14)">${silhouette(800, 600, 2.1)}</g>`;
  b += `<g filter="url(#glowBig)" opacity="0.85"><path d="M548 600 C548 400 653 316 800 316 C947 316 1052 400 1052 600" fill="none" stroke="${O}" stroke-width="6"/><circle cx="800" cy="211" r="110" fill="none" stroke="${O}" stroke-width="6"/></g>`;
  b += `<g>${pix}</g>`;
  return wrap(b, { floorY: 600 });
}

function tictactoe() {
  const s = 150, x0 = 800 - s * 1.5, y0 = 110;
  let b = "";
  for (let i = 1; i < 3; i++) {
    b += `<line x1="${x0 + i * s}" y1="${y0}" x2="${x0 + i * s}" y2="${y0 + 3 * s}" stroke="${LINE}" stroke-width="6" stroke-linecap="round"/>`;
    b += `<line x1="${x0}" y1="${y0 + i * s}" x2="${x0 + 3 * s}" y2="${y0 + i * s}" stroke="${LINE}" stroke-width="6" stroke-linecap="round"/>`;
  }
  const X = (c, rr, bright) => {
    const cx = x0 + c * s + s / 2, cy = y0 + rr * s + s / 2, d = 44;
    return `<g stroke="${bright ? O2 : O}" stroke-width="${bright ? 16 : 12}" stroke-linecap="round" filter="url(#${bright ? "glowBig" : "glow"})" opacity="${bright ? 1 : 0.8}"><line x1="${cx - d}" y1="${cy - d}" x2="${cx + d}" y2="${cy + d}"/><line x1="${cx + d}" y1="${cy - d}" x2="${cx - d}" y2="${cy + d}"/></g>`;
  };
  const Oo = (c, rr) => `<circle cx="${x0 + c * s + s / 2}" cy="${y0 + rr * s + s / 2}" r="46" fill="none" stroke="#7a3a16" stroke-width="12" filter="url(#glow)" opacity="0.9"/>`;
  b += X(0, 0, true) + X(1, 1, true) + X(2, 2, true) + Oo(2, 0) + Oo(0, 2) + Oo(1, 2);
  return wrap(b, { floorY: 640 });
}

function bingo() {
  let b = "";
  for (let r = 0; r < 5; r++)
    for (let c = 0; c < 5; c++) {
      const x = 800 - 240 + c * 98, y = 100 + r * 98, hit = r === c;
      b += panel(x, y, 86, 86, { lit: hit, r: 10 });
      if (hit) b += `<circle cx="${x + 43}" cy="${y + 43}" r="28" fill="url(#orange)" filter="url(#glow)"/>`;
    }
  return wrap(b, { floorY: 660 });
}

function contexto() {
  let b = "";
  for (let r = 300; r >= 60; r -= 48) b += `<circle cx="800" cy="380" r="${r}" fill="none" stroke="${r < 120 ? O : LINE}" stroke-width="${r < 120 ? 4 : 2.5}" opacity="${r < 120 ? 0.9 : 0.5 + (300 - r) / 600}"/>`;
  b += `<circle cx="800" cy="380" r="26" fill="url(#orange)" filter="url(#glowBig)"/>`;
  b += `<circle cx="${800 + 204 * Math.cos(-0.6)}" cy="${380 + 204 * Math.sin(-0.6)}" r="14" fill="${O2}" filter="url(#glow)"/>`;
  b += `<path d="M${800 + 300 * Math.cos(-0.9)} ${380 + 300 * Math.sin(-0.9)} A300 300 0 0 1 ${800 + 300 * Math.cos(-0.5)} ${380 + 300 * Math.sin(-0.5)}" fill="none" stroke="${O}" stroke-width="4" opacity="0.6"/>`;
  return wrap(b, { floorY: 700 });
}

function packFive() {
  let b = "";
  // Draw the lit centre card last so it sits on top of the fan.
  [[-26, 0], [-13, 1], [26, 4], [13, 3], [0, 2]].forEach(([a, i]) => {
    const lit = i === 2;
    b += `<g transform="translate(800 640) rotate(${a}) scale(1.35) translate(-100 -330)"${lit ? ' filter="url(#glow)"' : ""}>
  <rect width="200" height="300" rx="16" fill="url(#${lit ? "panelLit" : "panel"})" stroke="${lit ? O : LINE}" stroke-width="${lit ? 4 : 2.5}"/>
  <rect x="18" y="18" width="164" height="110" rx="10" fill="${lit ? "#1a0f08" : "#100d0b"}" stroke="${lit ? O2 : "#4a3b31"}" stroke-width="1.5" opacity="0.9"/>
  ${[0, 1, 2].map((k) => `<rect x="18" y="${152 + k * 36}" width="${lit ? [150, 110, 130][k] : 100}" height="14" rx="7" fill="${lit ? O : "#3a2f28"}" opacity="${lit ? 0.95 : 0.8}"/>`).join("")}
</g>`;
  });
  return wrap(b, { floorY: 640 });
}

function superdraft() {
  let b = "";
  for (let i = 0; i < 5; i++) b += panel(800 - 470 + i * 190, 110, 170, 64, { lit: true });
  b += pedestal(800, 480, 240, 130);
  b += ball(800, 380, 100);
  return wrap(b, { floorY: 610 });
}

function imposter() {
  let b = `<polygon points="520,620 1080,620 1140,470 460,470" fill="url(#cone)" opacity="0.9"/>`;
  [520, 710, 900, 1090].forEach((x, i) => (b += silhouette(x, 540, 0.95, { lit: i === 2 })));
  b += `<ellipse cx="800" cy="560" rx="380" ry="44" fill="url(#panel)" stroke="${LINE}" stroke-width="2"/>`;
  return wrap(b, { floorY: 580 });
}

function whoWouldWin() {
  let b = "";
  for (const cx of [430, 1170]) {
    b += `<polygon points="${cx - 160},80 ${cx + 160},80 ${cx + 220},520 ${cx - 220},520" fill="url(#cone)"/>`;
    b += pedestal(cx, 440, 240, 120);
  }
  b += `<polyline points="800,60 770,200 840,300 760,420 830,540 790,700" fill="none" stroke="url(#orange)" stroke-width="10" stroke-linejoin="round" filter="url(#glowBig)"/>`;
  return wrap(b, { floorY: 560, reflect: false });
}

function comingSoon() {
  let b = `<g opacity="0.45"><path d="M300 620 Q800 120 1300 620" fill="none" stroke="${LINE}" stroke-width="3"/><path d="M620 620 Q800 420 980 620" fill="none" stroke="${LINE}" stroke-width="3"/><line x1="100" y1="620" x2="1500" y2="620" stroke="${LINE}" stroke-width="3"/></g>`;
  b += `<polygon points="640,60 960,60 1060,560 540,560" fill="url(#cone)" opacity="0.8"/>`;
  b += pedestal(800, 520, 240, 100);
  // A question mark drawn as paths (no font dependency): hook, stem, dot.
  b += `<g filter="url(#glowBig)" stroke="url(#orange)" stroke-width="46" stroke-linecap="round" fill="none">
  <path d="M690 250 C690 140 910 140 910 250 C910 320 820 330 800 390 L800 420"/>
  <circle cx="800" cy="492" r="12" fill="url(#orange)"/>
</g>`;
  b += `<rect x="0" y="440" width="${W}" height="200" fill="#2a1d14" opacity="0.35" filter="url(#blur40)"/>`;
  return wrap(b, { floorY: 620 });
}

export const scenes = {
  "series-winner": seriesWinner,
  "name-logo": nameLogo,
  "guess-mvps": guessMvps,
  "starting-five": startingFive,
  wordle,
  "fan-favorites": fanFavorites,
  heatmap,
  connections,
  "career-path": careerPath,
  "nba-grid": nbaGrid,
  "who-are-ya": whoAreYa,
  tictactoe,
  bingo,
  contexto,
  "pack-five": packFive,
  superdraft,
  imposter,
  "who-would-win": whoWouldWin,
  "coming-soon": comingSoon,
};
