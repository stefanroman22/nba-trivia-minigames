import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useSelector } from "react-redux";
import Navigation from "../components/Navigation";
import { Button, CourtLoader, Field } from "../components/ui";
import { apiFetch } from "../utils/Api";
import { BACKEND_URL } from "../configurations/backend";
import { games as gameCatalog } from "../utils/GameUtils";
import type { RootState } from "../store";
import "../styles/LandPage.css";
import "../styles/Admin.css";

/* ------------------------------------------------------------------ */
/*  API payload types (see backend/trivia/admin_api.py)                */
/* ------------------------------------------------------------------ */
type AdminSync = { dataset: string; status: string; rows: number; at: string | null };

type AdminSource = {
  key: string;
  kind: "db" | "pool";
  label: string;
  link?: string;
  count: number | null;
  fields: string[] | null;
  last_updated: string | null;
  sync?: AdminSync | null;
  missing?: boolean;
};

type AdminGame = {
  id: string;
  name: string;
  status: "live" | "backend-only";
  modes: { singleplayer: boolean; multiplayer: boolean; turn_based: boolean; party: boolean };
  config: string[];
  sources: AdminSource[];
};

type AdminOverview = {
  games: AdminGame[];
  shared: AdminSource[];
  manifest_version: string | null;
  generated_at: string;
};

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */
const fmtDate = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : "—";

const fmtCount = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());

/** Compact, table-friendly rendering of any record value. */
const fmtCell = (value: unknown): string => {
  if (value == null) return "—";
  if (typeof value === "boolean") return value ? "✓" : "✕";
  if (typeof value === "object") {
    const s = JSON.stringify(value);
    return s.length > 90 ? s.slice(0, 90) + "…" : s;
  }
  const s = String(value);
  return s.length > 120 ? s.slice(0, 120) + "…" : s;
};

const modeChips = (m: AdminGame["modes"]) =>
  [
    m.singleplayer && "Singleplayer",
    m.multiplayer && "Multiplayer",
    m.turn_based && "Turn-based",
    m.party && "Party (3–5)",
  ].filter(Boolean) as string[];

/* ------------------------------------------------------------------ */
/*  Record browser for one data source                                 */
/* ------------------------------------------------------------------ */
const PAGE_SIZE = 20;

function SourceRows({ source }: { source: AdminSource }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (offset: number, q: string, append: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          key: source.key,
          q,
          limit: String(PAGE_SIZE),
          offset: String(offset),
        });
        const res = await apiFetch(`${BACKEND_URL}/admin/source-rows/?${params}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not load records");
        // Plain-value pools (e.g. word lists) come back as bare strings.
        const page = (data.rows as unknown[]).map((r) =>
          r != null && typeof r === "object" ? (r as Record<string, unknown>) : { value: r },
        );
        setTotal(data.total);
        setRows((prev) => (append ? [...prev, ...page] : page));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load records");
      } finally {
        setLoading(false);
      }
    },
    [source.key],
  );

  // Initial load + debounced search share one effect.
  useEffect(() => {
    const t = window.setTimeout(() => load(0, query, false), query ? 350 : 0);
    return () => window.clearTimeout(t);
  }, [query, load]);

  const columns = useMemo(() => {
    const keys: string[] = [];
    for (const row of rows) {
      for (const k of Object.keys(row)) if (!keys.includes(k)) keys.push(k);
    }
    return keys;
  }, [rows]);

  return (
    <div className="admin-rows">
      <div className="admin-rows-bar">
        <Field
          search
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${source.label}…`}
          aria-label={`Search ${source.label}`}
        />
        <span className="admin-rows-total tnum">
          {total == null ? "" : `${fmtCount(total)} record${total === 1 ? "" : "s"}`}
        </span>
      </div>

      {error ? (
        <div className="admin-error">{error}</div>
      ) : rows.length === 0 && !loading ? (
        <div className="admin-empty">No records match.</div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c} title={typeof row[c] === "object" ? JSON.stringify(row[c]) : undefined}>
                      {fmtCell(row[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="admin-rows-foot">
        {loading && <span className="admin-muted">Loading…</span>}
        {!loading && total != null && rows.length < total && (
          <button className="btn btn-secondary btn-sm" onClick={() => load(rows.length, query, true)}>
            Load more ({fmtCount(total - rows.length)} left)
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  One data source line inside an expanded game card                  */
/* ------------------------------------------------------------------ */
function SourceLine({ source }: { source: AdminSource }) {
  const [browsing, setBrowsing] = useState(false);

  return (
    <div className="admin-source">
      <div className="admin-source-row">
        <span className={`admin-kind admin-kind--${source.kind}`}>{source.kind === "db" ? "DB" : "JSON"}</span>
        {source.kind === "pool" && source.link && !source.missing ? (
          <a className="admin-source-label" href={source.link} target="_blank" rel="noreferrer">
            {source.label}
          </a>
        ) : (
          <span className="admin-source-label">{source.label}</span>
        )}
        <span className="admin-source-meta tnum">
          {source.missing ? "missing" : `${fmtCount(source.count)} records`}
        </span>
        <span className="admin-source-meta">{fmtDate(source.last_updated)}</span>
        <button className="admin-browse" onClick={() => setBrowsing((b) => !b)} disabled={!!source.missing}>
          {browsing ? "Hide records" : "View records"}
        </button>
      </div>
      {source.sync && (
        <div className={`admin-sync ${source.sync.status === "success" ? "is-good" : "is-bad"}`}>
          Last sync: {source.sync.status} · {fmtCount(source.sync.rows)} rows · {fmtDate(source.sync.at)}
        </div>
      )}
      {browsing && <SourceRows source={source} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Game card                                                          */
/* ------------------------------------------------------------------ */
function GameCard({ game }: { game: AdminGame }) {
  const [expanded, setExpanded] = useState(false);
  const meta = gameCatalog.find((g) => g.id === game.id);
  const primary = game.sources[0];

  return (
    <div className={`admin-card surface${expanded ? " is-open" : ""}`}>
      <button className="admin-card-head" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
        <span className="admin-card-name">
          {game.name}
          {game.status === "backend-only" && <span className="chip admin-chip">backend only</span>}
        </span>
        <span className="admin-card-source">{primary?.label ?? "—"}</span>
        <span className="admin-card-count tnum">{fmtCount(primary?.count)}</span>
        <span className="admin-card-date">{fmtDate(primary?.last_updated)}</span>
        <svg
          className={`admin-chevron${expanded ? " is-open" : ""}`}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {expanded && (
        <motion.div
          className="admin-card-body"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          {meta && <p className="admin-desc">{meta.description}</p>}

          <div className="admin-chip-row">
            {modeChips(game.modes).map((m) => (
              <span key={m} className="chip">
                {m}
              </span>
            ))}
            {meta && meta.maxPoints > 0 && (
              <span className="chip chip-brand tnum">
                {meta.pointsPerCorrect} pts / correct · max {meta.maxPoints}
              </span>
            )}
          </div>

          <div className="admin-section-label">Data sources</div>
          {game.sources.map((s) => (
            <SourceLine key={s.key} source={s} />
          ))}

          <div className="admin-section-label">How questions are configured</div>
          <ul className="admin-config">
            {game.config.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>

          <div className="admin-card-foot">
            <button className="btn btn-secondary btn-sm" disabled title="Coming soon — will trigger the data refresh pipeline">
              Refresh data
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared datasets card                                               */
/* ------------------------------------------------------------------ */
function SharedCard({ shared }: { shared: AdminSource[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`admin-card surface${expanded ? " is-open" : ""}`}>
      <button className="admin-card-head" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
        <span className="admin-card-name">Shared datasets</span>
        <span className="admin-card-source">rosters · logs · sync history</span>
        <span className="admin-card-count tnum">{shared.length}</span>
        <span className="admin-card-date" />
        <svg
          className={`admin-chevron${expanded ? " is-open" : ""}`}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {expanded && (
        <motion.div
          className="admin-card-body"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="admin-desc">
            Datasets used across several games: the curated player roster, the autocomplete name list,
            play sessions, guess logs and the NBA-data sync history.
          </p>
          {shared.map((s) => (
            <SourceLine key={s.key} source={s} />
          ))}
        </motion.div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tabs                                                               */
/* ------------------------------------------------------------------ */
function GamesTab() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`${BACKEND_URL}/admin/games/`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || data.detail || "Could not load the overview");
        if (!cancelled) setOverview(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the overview");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!overview) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return overview.games;
    return overview.games.filter(
      (g) =>
        g.name.toLowerCase().includes(needle) ||
        g.id.includes(needle) ||
        g.sources.some((s) => s.label.toLowerCase().includes(needle)),
    );
  }, [overview, query]);

  if (error) return <div className="admin-error">{error}</div>;
  if (!overview)
    return (
      <div className="admin-loading">
        <CourtLoader label="Loading data overview…" scale={0.7} />
      </div>
    );

  return (
    <>
      <div className="admin-toolbar">
        <div className="games-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4-4" />
          </svg>
          <Field
            search
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search games or datasets…"
            aria-label="Search games or datasets"
          />
        </div>
        <span className="admin-muted tnum">
          {overview.games.filter((g) => g.status === "live").length} live games
          {overview.manifest_version ? ` · manifest v${overview.manifest_version}` : ""}
        </span>
      </div>

      <div className="admin-list">
        {filtered.map((g) => (
          <GameCard key={g.id} game={g} />
        ))}
        {filtered.length === 0 && <div className="admin-empty">No games match “{query}”.</div>}
        {!query && <SharedCard shared={overview.shared} />}
      </div>
    </>
  );
}

function UsersTab() {
  return (
    <div className="surface admin-placeholder">
      <span className="font-display admin-placeholder-title">Users</span>
      <p className="admin-muted">
        User management lands here next — player search, points &amp; rank moderation, and account actions.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */
function Admin() {
  const navigate = useNavigate();
  const { user, authChecked } = useSelector((state: RootState) => state.user);
  const [tab, setTab] = useState<"games" | "users">("games");

  let content;
  if (!authChecked) {
    content = (
      <div className="admin-loading">
        <CourtLoader label="Checking access…" scale={0.7} />
      </div>
    );
  } else if (!user?.is_admin) {
    content = (
      <div className="surface admin-placeholder">
        <span className="font-display admin-placeholder-title">Admins only</span>
        <p className="admin-muted">This page is reserved for administrators.</p>
        <Button size="sm" onClick={() => navigate("/")}>
          Back to the games
        </Button>
      </div>
    );
  } else {
    content = (
      <>
        <div className="admin-tabs" role="tablist" aria-label="Admin sections">
          <button
            role="tab"
            aria-selected={tab === "games"}
            className={`admin-tab${tab === "games" ? " is-active" : ""}`}
            onClick={() => setTab("games")}
          >
            Games
          </button>
          <button
            role="tab"
            aria-selected={tab === "users"}
            className={`admin-tab${tab === "users" ? " is-active" : ""}`}
            onClick={() => setTab("users")}
          >
            Users
          </button>
        </div>
        {tab === "games" ? <GamesTab /> : <UsersTab />}
      </>
    );
  }

  return (
    <div className="app-shell">
      <Navigation type="back" />
      <main className="page admin-page">
        <header className="admin-head">
          <h1 className="font-display admin-title">Admin</h1>
          <p className="admin-sub">Games, data sources and content health.</p>
        </header>
        {content}
      </main>
    </div>
  );
}

export default Admin;
