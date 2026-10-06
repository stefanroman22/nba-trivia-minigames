// Node test for src/utils/inAppBrowser.ts, no dependencies:
//   npm run test:in-app-browser      (node --experimental-strip-types; Node >= 22.6)
import { test } from "node:test";
import assert from "node:assert/strict";
import { isInAppBrowser } from "../src/utils/inAppBrowser.ts";

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const SAFARI_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const INSTAGRAM = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0";
const FACEBOOK = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/460.0.0.0;]";
const TIKTOK = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36 musical_ly_33.1.0 BytedanceWebview/d8a21c6";

test("regular browsers are not in-app browsers", () => {
  assert.equal(isInAppBrowser(CHROME), false);
  assert.equal(isInAppBrowser(SAFARI_IOS), false);
  assert.equal(isInAppBrowser(""), false);
});

test("social-app webviews are detected", () => {
  assert.equal(isInAppBrowser(INSTAGRAM), true);
  assert.equal(isInAppBrowser(FACEBOOK), true);
  assert.equal(isInAppBrowser(TIKTOK), true);
});
