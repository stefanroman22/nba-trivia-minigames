// Selftest for the Who Are Ya end-reveal photo rule (games/who-are-ya.mjs photoEndProblem / isBlockedHeadshot): the
// sharp headshot passes; the silhouette fallback passes only when the mystery's own headshot request failed at the
// connection level on the runner (cdn.nba.com for that person_id, or a Commons file); every other missing or blurred
// photo is still an `answer-hidden` problem. Pure node, no browser.
import { test, expect } from '@playwright/test';
import { isBlockedHeadshot, photoEndProblem } from '../../games/who-are-ya.mjs';

const ID = 201939;
const NBA = (id, size = '260x190') => `https://cdn.nba.com/headshots/nba/latest/${size}/${id}.png`;
const COMMONS = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Some_Player.jpg/320px-Some_Player.jpg';
const fail = (url, error = 'net::ERR_HTTP2_PROTOCOL_ERROR') => ({ url, error });
const problem = (o) => photoEndProblem({ filter: null, silhouette: false, failed: [], personId: ID, ...o });

test('[ST-WAYA-PHOTO] who-are-ya end photo: sharp or runner-blocked silhouette passes, everything else fails', () => {
  // Pass
  expect(problem({ filter: 'none' })).toBeNull();
  expect(problem({ filter: 'blur(0px)' })).toBeNull();
  expect(problem({ filter: 'blur(0)' })).toBeNull();
  expect(problem({ silhouette: true, failed: [fail(NBA(ID))] })).toBeNull();
  expect(problem({ silhouette: true, failed: [fail(NBA(ID, '1040x760'), 'net::ERR_CONNECTION_RESET')] })).toBeNull();
  expect(problem({ silhouette: true, failed: [fail(COMMONS, 'net::ERR_TUNNEL_CONNECTION_FAILED')] })).toBeNull();
  expect(problem({ silhouette: true, failed: [fail('https://example.com/x.js'), fail(NBA(ID), 'net::ERR_TIMED_OUT')] })).toBeNull();

  // Must still fail
  const failing = {
    'still blurred, even with a blocked headshot recorded': { filter: 'blur(6px)', silhouette: true, failed: [fail(NBA(ID))] },
    'silhouette, no failed request': { silhouette: true },
    'silhouette, failure for another person id': { silhouette: true, failed: [fail(NBA(2544))] },
    'silhouette, id only as a substring': { silhouette: true, failed: [fail(NBA(12019390)), fail(NBA(20193))] },
    'silhouette, ERR_ABORTED': { silhouette: true, failed: [fail(NBA(ID), 'net::ERR_ABORTED')] },
    'silhouette, 404 text': { silhouette: true, failed: [fail(NBA(ID), 'HTTP 404')] },
    'silhouette, DNS error': { silhouette: true, failed: [fail(NBA(ID), 'net::ERR_NAME_NOT_RESOLVED')] },
    'silhouette, certificate error': { silhouette: true, failed: [fail(COMMONS, 'net::ERR_CERT_AUTHORITY_INVALID')] },
    'silhouette, no error text': { silhouette: true, failed: [{ url: NBA(ID), error: null }] },
    'silhouette, failure on a non-allowed host': { silhouette: true, failed: [fail(`https://cdn.example.com/headshots/nba/latest/260x190/${ID}.png`), fail('https://en.wikipedia.org/x.png')] },
    'silhouette, cdn.nba.com but not a headshot path': { silhouette: true, failed: [fail(`https://cdn.nba.com/logos/nba/${ID}.png`)] },
    'frame gone entirely (no photo, no silhouette), even with a matching failure': { silhouette: false, failed: [fail(NBA(ID))] },
    'silhouette, matching failure but no mystery id': { silhouette: true, failed: [fail(NBA(ID))], personId: null },
  };
  for (const [name, o] of Object.entries(failing)) {
    expect(problem(o), name).toEqual(expect.any(String));
  }

  // isBlockedHeadshot on its own
  expect(isBlockedHeadshot([fail(NBA(ID))], ID)).toBe(true);
  expect(isBlockedHeadshot([fail(NBA(ID))], String(ID))).toBe(true);
  expect(isBlockedHeadshot([fail(NBA(2544))], ID)).toBe(false);
  expect(isBlockedHeadshot([], ID)).toBe(false);
  expect(isBlockedHeadshot(undefined, ID)).toBe(false);
  expect(isBlockedHeadshot([fail('not a url')], ID)).toBe(false);
});
