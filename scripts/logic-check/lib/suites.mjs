// Logic Check suites: each is a check-id prefix (spec §5) run by one or more Playwright projects.
//   live       LC-LIVE-     project live (the live site, no stack)
//   pages      LC-PAGES-    project pages (local stack, one browser)
//   auth       LC-AUTH-     projects api + pages (LC-AUTH-GOOGLE-01 is a browser case)
//   signup     LC-SIGNUP-   projects api + pages (LC-SIGNUP-UI-01 is a browser case)
//   profile    LC-PROFILE-  project api
//   friends    LC-FRIENDS-  project api
//   game-data  LC-GAMEDATA- project api
//   rooms      LC-ROOMS-    project rooms
// A result's suite (results.json, digest) is its check id's prefix's suite (SUITE_BY_PREFIX in the project `use`).
export const SUITES = {
  live: { prefix: 'LC-LIVE-', projects: ['live'] },
  pages: { prefix: 'LC-PAGES-', projects: ['pages'] },
  auth: { prefix: 'LC-AUTH-', projects: ['api', 'pages'] },
  signup: { prefix: 'LC-SIGNUP-', projects: ['api', 'pages'] },
  profile: { prefix: 'LC-PROFILE-', projects: ['api'] },
  friends: { prefix: 'LC-FRIENDS-', projects: ['api'] },
  'game-data': { prefix: 'LC-GAMEDATA-', projects: ['api'] },
  rooms: { prefix: 'LC-ROOMS-', projects: ['rooms'] },
};

/** Check-id prefix → suite (plus the selftests' LC-ST-). */
export const SUITE_BY_PREFIX = { ...Object.fromEntries(Object.entries(SUITES).map(([s, { prefix }]) => [prefix, s])), 'LC-ST-': 'selftest' };

/** The suite of a check id (or an --only pattern such as `LC-AUTH-*`), or null. */
export const suiteOfId = (id) => Object.entries(SUITES).find(([, { prefix }]) => String(id).startsWith(prefix))?.[0] ?? null;
