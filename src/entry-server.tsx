/**
 * Build-time SSG entry (see scripts/ssg.mjs). Renders the app for a given URL
 * to an HTML string with the same tree main.tsx hydrates, so hydration adopts
 * the static DOM without repainting — that static paint is the real LCP.
 *
 * Built separately via `vite build --ssr src/entry-server.tsx` and run in
 * Node, so nothing here (or in the modules it pulls in at render time) may
 * touch browser globals during render.
 */
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import { Provider } from "react-redux";
import { store } from "./store";
import App from "./App";

export function render(url: string): string {
  return renderToString(
    <Provider store={store}>
      <StaticRouter location={url}>
        <App />
      </StaticRouter>
    </Provider>
  );
}
