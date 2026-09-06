
import { createRoot, hydrateRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './styles/theme.css'
import './styles/ui.css'
import './index.css'
import App from './App.tsx'
import { Provider } from "react-redux";
import { store } from "./store";
import './index.css';

// GoogleOAuthProvider moved into LogInSignUp: it injects Google's gsi/client
// script on mount, so app-wide it cost every visitor ~73KB at startup.
const app = (
  <Provider store={store}>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </Provider>
);

const rootEl = document.getElementById('root')!;

// The landing route is prerendered into index.html at build time
// (scripts/ssg.mjs). On "/", hydrate so React adopts that DOM without
// repainting it. Any other path is served the same static file as an SPA
// fallback, where the baked-in landing markup is wrong — clear it and
// client-render from scratch.
if (rootEl.firstElementChild && window.location.pathname === '/') {
  hydrateRoot(rootEl, app);
} else {
  if (rootEl.firstElementChild) rootEl.innerHTML = '';
  createRoot(rootEl).render(app);
}
