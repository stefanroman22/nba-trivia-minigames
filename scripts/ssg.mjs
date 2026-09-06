/**
 * Build-time static-site generation of the landing page.
 *
 * A client-side SPA serves an empty <div id="root">, so on slow connections
 * nothing paints until the whole JS bundle arrives. This script runs the real
 * server render (dist-server/entry-server.js, built with `vite build --ssr`)
 * for "/" and injects the markup into dist/index.html's <!--app-html-->
 * placeholder. main.tsx then hydrates that DOM on "/" instead of re-rendering
 * it, so the static paint IS the LCP.
 *
 * Pure Node — no browser needed, so it runs the same on Vercel builds.
 * Fail-soft: on any error the placeholder is left in place (harmless — the
 * client falls back to a normal SPA render) and the build continues.
 *
 * Runs via the package.json "postbuild" hook, after both vite builds.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PLACEHOLDER = "<!--app-html-->";

try {
  const entry = pathToFileURL(path.resolve("dist-server/entry-server.js")).href;
  const { render } = await import(entry);
  const appHtml = render("/");
  if (!appHtml || !appHtml.includes("hero-h1")) {
    throw new Error("render('/') did not produce the landing hero");
  }

  const indexPath = path.resolve("dist/index.html");
  let template = await readFile(indexPath, "utf8");
  if (!template.includes(PLACEHOLDER)) {
    throw new Error(`dist/index.html is missing the ${PLACEHOLDER} placeholder`);
  }
  template = template.replace(PLACEHOLDER, appHtml);

  // Defer bundle EXECUTION until after the first painted frame. The page is
  // fully server-rendered, so nothing above the fold needs JS to appear —
  // hydration starting one frame later is imperceptible, and it keeps the
  // bundle out of the first paint's critical path.
  const scriptTag = template.match(/<script type="module"[^>]*src="(\/assets\/[^"]+\.js)"[^>]*><\/script>/);
  if (!scriptTag) throw new Error("could not find the vite module script tag");
  template = template.replace(scriptTag[0], "");
  // Double rAF: the first fires before the frame paints, the second after it
  // commits — so the bundle request genuinely starts post-first-paint.
  const loader = `<script>requestAnimationFrame(function(){requestAnimationFrame(function(){setTimeout(function(){var s=document.createElement("script");s.type="module";s.crossOrigin="";s.src="${scriptTag[1]}";document.head.appendChild(s)},0)})})</script>`;
  template = template.replace("</body>", `${loader}</body>`);

  await writeFile(indexPath, template);
  console.log(`[ssg] landing page prerendered into dist/index.html (${Math.round(appHtml.length / 1024)}KB of markup, bundle deferred past first paint)`);
} catch (err) {
  console.warn(`[ssg] skipped: ${String(err?.message || err).split("\n")[0]}`);
  console.warn("[ssg] the build still works — it just ships the plain SPA shell.");
}

// Imported modules may hold timers/handles; the work is done, exit cleanly.
process.exit(0);
