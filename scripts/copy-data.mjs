// Copy the generated game-data JSON (backend/trivia/data) into the frontend's static
// dir (public/data) so it ships with the deployment and is served from the CDN at /data/.
// Runs before `dev` and `build`. The data itself is produced by the backend command
// `manage.py refresh_game_data` and committed under backend/trivia/data/.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "backend", "trivia", "data");
const dest = join(root, "public", "data");

if (!existsSync(src)) {
  console.warn(
    `[copy-data] source not found: ${src} — skipping (run backend refresh_game_data first)`,
  );
  process.exit(0);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

let count = 0;
for (const name of readdirSync(src)) {
  if (name.endsWith(".json")) {
    copyFileSync(join(src, name), join(dest, name));
    count += 1;
  }
}
console.log(`[copy-data] copied ${count} json file(s) -> public/data/`);
