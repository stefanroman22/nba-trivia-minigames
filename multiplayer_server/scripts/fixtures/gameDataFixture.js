// Shared helpers for the two manifest-v3 loader tests (multiplayer_server/scripts/test_game_data.js
// and scripts/test-game-data.mjs at the repo root): a tiny static server over the publisher-made
// fixture folder, plus row comparison helpers. No dependencies.
const fs = require("fs");
const http = require("http");
const path = require("path");

const FIXTURE_DIR = path.join(__dirname, "game-data-v3");
const EXPECTED = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "expected.json"), "utf8"));
const MANIFEST = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "manifest.json"), "utf8"));

/**
 * Serve FIXTURE_DIR on 127.0.0.1:<random port>. `overlay` maps a path to a JSON value served
 * instead of (or in addition to) the folder; mutate it between requests. `log` records every
 * requested path.
 */
function startServer(overlay = {}) {
  const log = [];
  const sockets = new Set();
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
    log.push(rel);
    if (Object.prototype.hasOwnProperty.call(overlay, rel)) {
      if (overlay[rel] === 404) {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
      return res.end(JSON.stringify(overlay[rel]));
    }
    const file = path.join(FIXTURE_DIR, ...rel.split("/"));
    if (!file.startsWith(FIXTURE_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    fs.createReadStream(file).pipe(res);
  });
  srv.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  return new Promise((resolve) => {
    srv.listen(0, "127.0.0.1", () => {
      resolve({
        base: `http://127.0.0.1:${srv.address().port}`,
        log,
        overlay,
        close: () =>
          new Promise((done) => {
            for (const s of sockets) s.destroy();
            srv.close(() => done());
          }),
      });
    });
  });
}

/** JSON with sorted keys at every level: equal text == equal value, field for field. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Equal as multisets of rows (row order ignored). */
function sameRows(a, b) {
  const x = a.map(canonical).sort();
  const y = b.map(canonical).sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/** The row with every paired team_a* / team_b* field swapped (reference for the side checks). */
function swapped(row) {
  const out = { ...row };
  for (const key of Object.keys(row)) {
    if (!key.startsWith("team_a")) continue;
    const other = `team_b${key.slice(6)}`;
    if (other in row) {
      out[key] = row[other];
      out[other] = row[key];
    }
  }
  return out;
}

/** A check() that counts failures, like the sims. */
function makeChecker() {
  const state = { failures: 0 };
  state.check = (label, ok, detail) => {
    if (ok) console.log(`  ok  ${label}`);
    else {
      state.failures++;
      console.log(`FAIL  ${label}${detail ? ` - ${detail}` : ""}`);
    }
  };
  return state;
}

module.exports = { FIXTURE_DIR, EXPECTED, MANIFEST, startServer, canonical, sameRows, swapped, makeChecker };
