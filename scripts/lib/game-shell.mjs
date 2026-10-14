/**
 * The GAME_DESIGN_CONSTRAINTS shell contract (Rule 0, 1.2, 4.1, 4.2, 4.2a) as code, shared by
 * scripts/ui-audit.mjs and the ui-check games suite (scripts/ui-check/specs/games/shell.spec.mjs).
 *
 *   measureInPage()    runs in the page (page.evaluate) while a game is playing → row of measurements
 *   shellFailures(row) → string[] of rule failures for one measured row ([] when it passes)
 */

/** Runs in the page. Measures the shell contract + the game's own top-level rhythm. */
export function measureInPage() {
  const r = (el) => el.getBoundingClientRect();
  const inner = document.querySelector('.stage-inner');
  const shell = document.querySelector('.stage-shell');
  const wrap = document.querySelector('.playing-wrap');
  const exit = document.querySelector('.exit-link');
  if (!inner || !wrap || !exit) return { mounted: false };

  const root = wrap.firstElementChild;
  const cs = getComputedStyle(root);
  const kids = [...root.children].filter((k) => r(k).height > 0);

  return {
    mounted: true,
    // The expected top/bottom offset IS the stage's padding — clamp(14px,2.6vw,30px),
    // so it varies with viewport width. Never hardcode it in an assertion.
    stagePad: +parseFloat(getComputedStyle(inner).paddingTop).toFixed(1),
    // Derived from what the game declared via <GameFrame fill> — there is no
    // is-content class any more (see MiniGame.css).
    isContent: !!root.classList.contains('gf') && !root.classList.contains('gf--fill'),
    usesGameFrame: root.classList.contains('gf'),
    // Shell contract (Rule 4.2) — must be identical in every game.
    shellTop: +(r(root).top - r(inner).top).toFixed(1),
    gameToExit: +(r(exit).top - r(root).bottom).toFixed(1),
    exitToBottom: +(r(inner).bottom - r(exit).bottom).toFixed(1),
    // Rules 1.1 / 1.2
    playAreaFitsViewport: r(exit).bottom <= window.innerHeight,
    shellContainsGame: r(exit).bottom <= r(shell).bottom + 1,
    // The game's own root — this is what actually differs between games.
    rootClass: root.className || '(inline styles)',
    rootMaxWidth: cs.maxWidth,
    rootGap: cs.rowGap,
    rootAlign: cs.alignItems,
    rootWidth: +r(root).width.toFixed(1),
    // Distance from the top of the game root to its first visible element, and
    // the gaps between top-level children. Reveals bespoke HUDs / floating boards.
    firstChildOffset: kids.length ? +(r(kids[0]).top - r(root).top).toFixed(1) : null,
    childGaps: kids.slice(1).map((k, i) => +(r(k).top - r(kids[i]).bottom).toFixed(1)),
    childCount: kids.length,
    // Status row alignment: a lone left label must be centred, a lone right
    // group must stay right-aligned, both present → space-between.
    status: (() => {
      const bar = root.querySelector(':scope > .gf-status');
      if (!bar) return null;
      const l = bar.querySelector(':scope > .gf-status-left');
      const rt = bar.querySelector(':scope > .gf-status-right');
      const br = r(bar);
      const off = (el) => (el ? +((r(el).left + r(el).right) / 2 - (br.left + br.right) / 2).toFixed(1) : null);
      return {
        slots: [l && 'left', rt && 'right'].filter(Boolean),
        // distance from the row's centre; ~0 means centred
        loneOffsetFromCentre: (l && !rt) ? off(l) : (rt && !l) ? off(rt) : null,
        loneRightIsFlush: (rt && !l) ? Math.abs(r(rt).right - br.right) < 1.5 : null,
      };
    })(),
    // Any absolutely-positioned descendant overlapping a sibling is usually a bug
    // (e.g. Heatmap's .hm-center score painted on top of the hex board).
    absoluteOverlays: [...root.querySelectorAll('*')]
      .filter((el) => getComputedStyle(el).position === 'absolute' && r(el).height > 8)
      .map((el) => el.className)
      .filter((c) => typeof c === 'string' && c)
      .slice(0, 6),
  };
}

/** The shell-contract assertions for one measured row (`{ id, ...measureInPage() }`). */
export function shellFailures(x) {
  const failures = [];
  const near = (a, b) => Math.abs(a - b) < 1.5;
  // Expected offset is the stage's own padding at THIS viewport, not a constant.
  const TOP = x.stagePad;
  if (!x.usesGameFrame) failures.push(`${x.id}: root is not <GameFrame> (got .${x.rootClass})`);
  if (!near(x.shellTop, TOP)) failures.push(`${x.id}: top offset ${x.shellTop} ≠ stage padding ${TOP}${x.shellTop < 0 ? ' — NEGATIVE: content is spilling above the shell border' : ''}`);
  if (!near(x.exitToBottom, TOP)) failures.push(`${x.id}: exit→bottom ${x.exitToBottom} ≠ stage padding ${TOP}`);
  if (x.rootGap !== '20px') failures.push(`${x.id}: root gap ${x.rootGap} ≠ 20px — games must not override GameFrame's rhythm`);
  // Game→Exit must match the game's own family: content 28px, fill 12px.
  const expectExit = x.isContent ? 28 : 12;
  if (!near(x.gameToExit, expectExit)) failures.push(`${x.id}: game→exit ${x.gameToExit} ≠ ${expectExit} (${x.isContent ? 'content' : 'fill'} family)`);
  if (!x.shellContainsGame) failures.push(`${x.id}: game renders OUTSIDE the shell border`);
  const s = x.status;
  if (s && s.slots.length === 1) {
    if (s.slots[0] === 'left' && Math.abs(s.loneOffsetFromCentre) > 1.5)
      failures.push(`${x.id}: lone status label is ${s.loneOffsetFromCentre}px off centre — it must centre when there is no right slot`);
    if (s.slots[0] === 'right' && !s.loneRightIsFlush)
      failures.push(`${x.id}: lone status score is not flush right`);
  }
  return failures;
}
