// Guards the legal pages' facts (src/configurations/legal.ts):
//   - FAILS if the terms version there differs from the one the backend stamps on sign-ups
//     (backend/users/consent.py), because acceptances would then point at the wrong document;
//   - WARNS (does not fail) while the operator identity is still empty, which must be filled in
//     before the service is promoted to production at scale.
//   npm run check:legal
import { readFileSync } from "node:fs";

const legal = readFileSync(new URL("../src/configurations/legal.ts", import.meta.url), "utf8");
const consent = readFileSync(new URL("../backend/users/consent.py", import.meta.url), "utf8");

const field = (name) => legal.match(new RegExp(`${name}:\\s*"([^"]*)"`))?.[1] ?? null;
const frontVersion = field("version");
const backVersion = consent.match(/TERMS_VERSION\s*=\s*"([^"]+)"/)?.[1] ?? null;

let failed = false;
if (!frontVersion || frontVersion !== backVersion) {
  console.error(`check-legal: terms version mismatch: legal.ts says ${frontVersion}, consent.py says ${backVersion}`);
  failed = true;
} else {
  console.log(`check-legal: terms version ${frontVersion} matches the backend`);
}

const missing = ["operatorName", "operatorAddress", "country"].filter((name) => !field(name));
if (missing.length) {
  console.warn(`check-legal: WARNING: legal.ts is missing ${missing.join(", ")}. Fill them in before promoting to production (see docs/legal/OPEN_ITEMS.md).`);
}

process.exit(failed ? 1 : 0);
