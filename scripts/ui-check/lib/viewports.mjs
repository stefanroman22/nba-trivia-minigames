// The 7 viewports from spec §2 (StatCounter worldwide, in-browser sizes). Ids and sizes are fixed.
// Phones: isMobile + touch, DPR 2. Tablets: touch, DPR 2. Desktop: DPR 1.
const vp = (id, width, height, cls, core) => ({
  id, width, height, cls, core,
  isMobile: cls === 'phone',
  hasTouch: cls !== 'desktop',
  deviceScaleFactor: cls === 'desktop' ? 1 : 2,
});

export const VIEWPORTS = {
  'phone-360': vp('phone-360', 360, 720, 'phone', false),
  'phone-390': vp('phone-390', 390, 664, 'phone', true),
  'phone-414': vp('phone-414', 414, 715, 'phone', false),
  'tablet-768': vp('tablet-768', 768, 954, 'tablet', true),
  'tablet-1280': vp('tablet-1280', 1280, 720, 'tablet', false),
  'desktop-1366': vp('desktop-1366', 1366, 657, 'desktop', true),
  'desktop-1920': vp('desktop-1920', 1920, 969, 'desktop', false),
};

export const CORE = ['phone-390', 'tablet-768', 'desktop-1366'];

export const MP_PAIRS = {
  pairA: ['desktop-1366', 'phone-390'],
  pairB: ['phone-360', 'desktop-1920'],
  pairC: ['tablet-768', 'tablet-1280'],
  pairD: ['phone-414', 'phone-390'],
};

/** Playwright browser-context options for a viewport id. */
export function contextOptions(id) {
  const v = VIEWPORTS[id];
  if (!v) throw new Error(`unknown viewport id "${id}" (known: ${Object.keys(VIEWPORTS).join(', ')})`);
  return {
    viewport: { width: v.width, height: v.height },
    isMobile: v.isMobile,
    hasTouch: v.hasTouch,
    deviceScaleFactor: v.deviceScaleFactor,
  };
}
