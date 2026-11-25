/**
 * Admin panel → Game Builder tab.
 *
 * An admin describes a trivia game in plain text; a backend AI agent picks one of the datasets and builds a
 * data-driven game spec (a draft). The draft can be refined with follow-up prompts and played right here
 * (CustomGamePlayer). A draft is admin-only; approving it ("Publish") gives it a public page at /custom/<slug>
 * (views/CustomGame), and refining a published game puts it back to draft. No custom game awards points. Building
 * and refining take 10-60 s, so both show a loader and disable their inputs while they run, and keep the typed
 * prompt if they fail.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Button, CourtLoader } from "../ui";
import Modal from "../ui/Modal";
import AutoHeight from "../motion/AutoHeight";
import SwapText from "../motion/SwapText";
import CustomGamePlayer from "../customGame/CustomGamePlayer";
import { durations, easing } from "../../motion/tokens";
import { fadeIn, swap } from "../../motion/variants";
import {
  MODE_LABEL,
  buildGame,
  deleteGame,
  fetchGame,
  fetchOverview,
  fetchPlay,
  publishGame,
  refineGame,
  toSummary,
  type BuilderFilter,
  type BuilderOverview,
  type BuilderPlay,
  type BuilderSource,
  type GameDetail,
  type GameSpec,
  type GameSummary,
} from "./gameBuilderApi";

const MAX_PROMPT = 1000;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
const fmt = (n: number) => n.toLocaleString("en-US");

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

const fmtDateTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "—";

const plural = (n: number, word: string) => `${fmt(n)} ${word}${n === 1 ? "" : "s"}`;

const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

const OP_LABEL: Record<BuilderFilter["op"], string> = {
  eq: "is",
  ne: "is not",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  in: "is one of",
  contains: "contains",
  exists: "exists",
};

function fmtFilterValue(v: unknown): string {
  if (v === null || v === undefined) return "empty";
  if (Array.isArray(v)) return v.map(fmtFilterValue).join(", ");
  if (typeof v === "string") return `“${v}”`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

/** A filter as one readable line, e.g. `draft_year > 2000`. */
function describeFilter(f: BuilderFilter): string {
  if (f.op === "exists") return `${f.field} ${f.value === false ? "is empty" : "has a value"}`;
  return `${f.field} ${OP_LABEL[f.op] ?? f.op} ${fmtFilterValue(f.value)}`;
}

/* ------------------------------------------------------------------ */
/*  Prompt box + submit, shared by "Describe a game" and "Refine"      */
/* ------------------------------------------------------------------ */
interface PromptFormProps {
  label: string;
  placeholder: string;
  rows: number;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  /** The AI is not configured: nothing can be sent. */
  off: boolean;
  busy: boolean;
  submitLabel: string;
  busyLabel: string;
  loaderLabel: string;
  error: string | null;
}

function PromptForm({
  label,
  placeholder,
  rows,
  value,
  onChange,
  onSubmit,
  off,
  busy,
  submitLabel,
  busyLabel,
  loaderLabel,
  error,
}: PromptFormProps) {
  const counterId = useId();
  const canSubmit = !off && !busy && value.trim().length > 0;

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit) {
      e.preventDefault();
      onSubmit();
    }
  }

  return (
    <div className="gb-form">
      <textarea
        className="field gb-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        maxLength={MAX_PROMPT}
        rows={rows}
        disabled={off || busy}
        placeholder={placeholder}
        aria-label={label}
        aria-describedby={counterId}
      />
      <div className="gb-form-foot">
        <span id={counterId} className="admin-muted tnum">
          {value.length}/{MAX_PROMPT}
        </span>
        <Button type="button" size="sm" onClick={onSubmit} disabled={!canSubmit}>
          <SwapText reserveWidth={[submitLabel, busyLabel]}>{busy ? busyLabel : submitLabel}</SwapText>
        </Button>
      </div>
      <AutoHeight>
        {busy && (
          <motion.div
            className="gb-busy"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: durations.base, ease: easing.out }}
          >
            <CourtLoader label={loaderLabel} scale={0.6} />
            <p className="admin-muted">This can take up to a minute.</p>
          </motion.div>
        )}
        {!busy && error && (
          <div className="admin-error" role="alert">
            {error}
          </div>
        )}
      </AutoHeight>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Collapsible block (datasets, raw JSON)                             */
/* ------------------------------------------------------------------ */
function Disclosure({ label, count, children }: { label: string; count?: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="gb-disclosure">
      <button type="button" className="gb-disclosure-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>{label}</span>
        {count != null && <span className="gb-disclosure-count tnum">{count}</span>}
        <svg
          className={`admin-chevron${open ? " is-open" : ""}`}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <AutoHeight>
        {open && (
          <motion.div
            className="gb-disclosure-body"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: durations.base, ease: easing.out }}
          >
            {children}
          </motion.div>
        )}
      </AutoHeight>
    </div>
  );
}

function SourceList({ sources }: { sources: BuilderSource[] }) {
  return (
    <>
      {sources.map((s) => (
        <div key={s.id} className="admin-source">
          <div className="admin-source-row">
            <span className="admin-source-label">{s.title}</span>
            <span className="admin-source-meta tnum">{plural(s.rows, "row")}</span>
          </div>
          <p className="admin-desc gb-dataset-desc">{s.description}</p>
          <div className="gb-fields">
            {s.fields.map((f) => (
              <span key={f.name} className="chip gb-field" title={f.description}>
                {f.name}
                <span className="gb-field-type">{f.type}</span>
              </span>
            ))}
          </div>
        </div>
      ))}
      {sources.length === 0 && <div className="admin-empty">The backend lists no datasets.</div>}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  The spec as a compact definition list                              */
/* ------------------------------------------------------------------ */
function SpecDetails({ spec, sourceTitle }: { spec: GameSpec; sourceTitle: string }) {
  const rows: { label: string; value: ReactNode; wide?: boolean }[] = [
    { label: "Prompt template", value: <code className="gb-code">{spec.prompt}</code>, wide: true },
    { label: "Dataset", value: sourceTitle },
    { label: "Mode", value: MODE_LABEL[spec.mode] },
    { label: "Rounds", value: String(spec.rounds) },
    { label: "Points per correct", value: String(spec.points_per_correct) },
  ];
  if (spec.answer_field) rows.push({ label: "Answer field", value: <code className="gb-code">{spec.answer_field}</code> });
  if (spec.options != null) rows.push({ label: "Options per round", value: String(spec.options) });
  if (spec.compare_field) rows.push({ label: "Compare field", value: <code className="gb-code">{spec.compare_field}</code> });
  if (spec.label_field) rows.push({ label: "Label field", value: <code className="gb-code">{spec.label_field}</code> });
  if (spec.reveal) rows.push({ label: "Reveal template", value: <code className="gb-code">{spec.reveal}</code>, wide: true });
  rows.push({
    label: "Filters",
    wide: true,
    value:
      spec.filters.length === 0 ? (
        <span className="admin-muted">None, every row of the dataset can be used</span>
      ) : (
        <ul className="gb-filter-list">
          {spec.filters.map((f, i) => (
            <li key={i}>{describeFilter(f)}</li>
          ))}
        </ul>
      ),
  });

  return (
    <div className="fb-detail-grid">
      {rows.map((r) => (
        <div key={r.label} className={r.wide ? "gb-detail-wide" : undefined}>
          <span className="fb-detail-label">{r.label}</span>
          <span className="fb-detail-value">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Delete confirmation (same pattern as the Users tab's ban dialog)   */
/* ------------------------------------------------------------------ */
function DeleteModal({
  title,
  published,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  published: boolean;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Delete this game?" onClose={onClose}>
      <div className="au-confirm">
        <p>
          “{title}” is removed for good, together with its conversation with the agent.{" "}
          {published ? "It is published, so its public link stops working." : "It was never public, so no player is affected."}{" "}
          This cannot be undone.
        </p>
        {error && <p className="admin-error">{error}</p>}
        <div className="au-compose-actions">
          <Button variant="danger" size="sm" onClick={onConfirm} disabled={busy}>
            <SwapText reserveWidth={["Working…", "Delete game"]}>{busy ? "Working…" : "Delete game"}</SwapText>
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Publish confirmation (same dialog style as Delete)                 */
/* ------------------------------------------------------------------ */
function PublishModal({
  busy,
  error,
  onConfirm,
  onClose,
}: {
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Publish this game?" onClose={onClose}>
      <div className="au-confirm">
        <p>Anyone with the link can play it. It awards no points.</p>
        {error && <p className="admin-error">{error}</p>}
        <div className="au-compose-actions">
          <Button size="sm" onClick={onConfirm} disabled={busy}>
            <SwapText reserveWidth={["Working…", "Publish game"]}>{busy ? "Working…" : "Publish game"}</SwapText>
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Draft / published, as one chip whose label swaps (UI-21). Sized by its widest state so a swap never moves the row. */
function StatusChip({ status }: { status: GameSummary["status"] }) {
  return (
    <span className={`chip gb-status${status === "published" ? " chip-good" : ""}`}>
      <SwapText reserveWidth={["draft", "published"]}>{status}</SwapText>
    </span>
  );
}

/** The public page's address, absolute against this origin, with a copy button (the Users tab's clipboard pattern). */
function PublicLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const href = `${window.location.origin}${path}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard refused: the link is shown in full to copy by hand */
    }
  }

  return (
    <div className="gb-link">
      <span className="fb-detail-label">Public link</span>
      <div className="gb-link-row">
        <a className="gb-link-url" href={href} target="_blank" rel="noopener noreferrer">
          {href}
        </a>
        <button type="button" className="admin-browse gb-toggle" onClick={copyLink}>
          <SwapText reserveWidth={["Copy link", "Copied!"]}>{copied ? "Copied!" : "Copy link"}</SwapText>
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  One draft, opened                                                  */
/* ------------------------------------------------------------------ */
type PlayState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: BuilderPlay; nonce: number };

interface GameBodyProps {
  game: GameDetail;
  enabled: boolean;
  sourceTitle: string;
  onChange: (g: GameDetail) => void;
  onDeleted: (id: number) => void;
}

function GameBody({ game, enabled, sourceTitle, onChange, onDeleted }: GameBodyProps) {
  const [refinePrompt, setRefinePrompt] = useState("");
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [play, setPlay] = useState<PlayState | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  // Bumped by every play / close, so a slow /play/ response for a preview that was closed is dropped.
  const playToken = useRef(0);

  const { spec, preview } = game;

  async function startPlay() {
    const token = ++playToken.current;
    setPlay({ status: "loading" });
    try {
      const data = await fetchPlay(game.id);
      if (playToken.current === token) setPlay({ status: "ready", data, nonce: token });
    } catch (e) {
      if (playToken.current === token) setPlay({ status: "error", message: errorText(e, "Could not load the rounds") });
    }
  }

  function closePlay() {
    playToken.current += 1;
    setPlay(null);
  }

  async function refine() {
    const text = refinePrompt.trim();
    if (!text || refining) return;
    setRefining(true);
    setRefineError(null);
    try {
      const updated = await refineGame(game.id, text);
      // The open preview was made from the old spec.
      closePlay();
      setRefinePrompt("");
      onChange(updated);
    } catch (e) {
      setRefineError(errorText(e, "The agent could not refine this game"));
    } finally {
      setRefining(false);
    }
  }

  async function remove() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteGame(game.id);
      setConfirmOpen(false);
      onDeleted(game.id);
    } catch (e) {
      setDeleteError(errorText(e, "Could not delete this game"));
      setDeleting(false);
    }
  }

  // Publish and unpublish both hand back the whole game, so the open card and the list row update in place.
  async function setPublished(action: "publish" | "unpublish") {
    setPublishing(true);
    setPublishError(null);
    try {
      const updated = await publishGame(game.id, action);
      setPublishOpen(false);
      onChange(updated);
    } catch (e) {
      setPublishError(errorText(e, action === "publish" ? "Could not publish this game" : "Could not unpublish this game"));
    } finally {
      setPublishing(false);
    }
  }

  const { usage } = game;
  const published = game.status === "published";

  return (
    <div className="gb-body">
      <p className="admin-desc">{game.description}</p>

      <div className="admin-chip-row">
        <StatusChip status={game.status} />
        <span className="chip">{MODE_LABEL[game.mode]}</span>
        <span className="chip">{sourceTitle}</span>
        <span className="chip tnum">{plural(spec.rounds, "round")}</span>
        <span className="chip chip-brand tnum">{spec.points_per_correct} pts / correct</span>
        <span className="chip tnum">{fmt(preview.pool_size)} rows match</span>
      </div>

      {preview.warnings.length > 0 && (
        <ul className="gb-warnings" aria-label="Warnings">
          {preview.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      <div className="gb-actions">
        <Button type="button" size="sm" onClick={play ? closePlay : startPlay} disabled={refining}>
          <SwapText reserveWidth={["Play", "Close preview"]}>{play ? "Close preview" : "Play"}</SwapText>
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={refining || publishing}
          onClick={() => {
            if (published) {
              void setPublished("unpublish");
            } else {
              setPublishError(null);
              setPublishOpen(true);
            }
          }}
        >
          <SwapText reserveWidth={["Publish", "Unpublish"]}>{published ? "Unpublish" : "Publish"}</SwapText>
        </Button>
        <button
          type="button"
          className="admin-browse gb-toggle au-ban is-danger"
          onClick={() => {
            setDeleteError(null);
            setConfirmOpen(true);
          }}
        >
          Delete
        </button>
      </div>

      <AutoHeight>
        <AnimatePresence initial={false}>
          {published && (
            <motion.div key="link" variants={fadeIn} initial="hidden" animate="visible" exit="exit">
              <PublicLink path={game.public_path} />
            </motion.div>
          )}
          {publishError && !publishOpen && (
            <motion.div key="error" className="admin-error gb-publish-error" role="alert" variants={fadeIn} initial="hidden" animate="visible" exit="exit">
              {publishError}
            </motion.div>
          )}
        </AnimatePresence>
      </AutoHeight>

      <AutoHeight>
        <AnimatePresence mode="wait" initial={false}>
          {play && (
            <motion.div
              key={play.status === "ready" ? `ready-${play.nonce}` : play.status}
              className="gb-play-area"
              variants={swap}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              {play.status === "loading" && (
                <div className="admin-loading gb-loading">
                  <CourtLoader label="Shuffling the rounds…" scale={0.5} />
                </div>
              )}
              {play.status === "error" && <div className="admin-error">{play.message}</div>}
              {play.status === "ready" && (
                <CustomGamePlayer
                  rounds={play.data.rounds}
                  pointsPerCorrect={play.data.points_per_correct}
                  maxPoints={play.data.max_points}
                  exitLabel="Back to builder"
                  noPointsNote="This is an admin preview, so no points are awarded."
                  onExit={closePlay}
                  onReplay={startPlay}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </AutoHeight>

      <div className="admin-section-label">Game definition</div>
      <SpecDetails spec={spec} sourceTitle={sourceTitle} />
      <Disclosure label="Raw spec (JSON)">
        <pre className="gb-json">{JSON.stringify(spec, null, 2)}</pre>
      </Disclosure>

      <div className="admin-section-label">Conversation</div>
      <AutoHeight>
        {game.transcript.length === 0 ? (
          <p className="admin-muted">No messages yet.</p>
        ) : (
          <ol className="gb-chat">
            {game.transcript.map((m, i) => (
              <motion.li
                key={`${i}-${m.at}`}
                className={`gb-msg gb-msg--${m.role}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: durations.base, ease: easing.out }}
              >
                <div className="gb-msg-head">
                  <span className="gb-msg-who">{m.role === "admin" ? "You" : "Agent"}</span>
                  <time className="admin-muted tnum" dateTime={m.at}>
                    {fmtDateTime(m.at)}
                  </time>
                </div>
                <p className="gb-msg-text">{m.text}</p>
              </motion.li>
            ))}
          </ol>
        )}
      </AutoHeight>

      <div className="admin-section-label">Refine with a prompt</div>
      <PromptForm
        label="Refinement prompt"
        placeholder="e.g. make it harder, or only players drafted after 2000"
        rows={3}
        value={refinePrompt}
        onChange={setRefinePrompt}
        onSubmit={refine}
        off={!enabled}
        busy={refining}
        submitLabel="Refine"
        busyLabel="Refining…"
        loaderLabel="The agent is refining your game…"
        error={refineError}
      />

      <p className="admin-muted gb-meta tnum">
        {game.model} · {plural(usage.turns, "turn")} · {fmt(usage.input_tokens)} tokens in · {fmt(usage.output_tokens)} out ·
        updated {fmtDateTime(game.updated_at)}
      </p>

      {/* Portalled: the card body animates with a transform, which would re-anchor a fixed overlay. */}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {confirmOpen && (
              <DeleteModal
                key="delete"
                title={game.title}
                published={published}
                busy={deleting}
                error={deleteError}
                onConfirm={remove}
                onClose={() => !deleting && setConfirmOpen(false)}
              />
            )}
            {publishOpen && (
              <PublishModal
                key="publish"
                busy={publishing}
                error={publishError}
                onConfirm={() => void setPublished("publish")}
                onClose={() => {
                  if (publishing) return;
                  setPublishOpen(false);
                  setPublishError(null);
                }}
              />
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}

/** Loads the full detail of one draft (unless the build just returned it) and shows it. */
function GamePanel({
  id,
  initial,
  enabled,
  sources,
  onUpdated,
  onDeleted,
}: {
  id: number;
  initial: GameDetail | null;
  enabled: boolean;
  sources: BuilderSource[];
  onUpdated: (g: GameDetail) => void;
  onDeleted: (id: number) => void;
}) {
  const [game, setGame] = useState<GameDetail | null>(initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (game) return;
    let cancelled = false;
    fetchGame(id)
      .then((g) => {
        if (!cancelled) setGame(g);
      })
      .catch((e) => {
        if (!cancelled) setError(errorText(e, "Could not load this game"));
      });
    return () => {
      cancelled = true;
    };
  }, [id, game]);

  if (error) return <div className="admin-error gb-panel-msg">{error}</div>;
  if (!game)
    return (
      <div className="gb-panel-msg">
        <CourtLoader label="Loading game…" scale={0.5} />
      </div>
    );

  return (
    <GameBody
      game={game}
      enabled={enabled}
      sourceTitle={sources.find((s) => s.id === game.source)?.title ?? game.source}
      onChange={(g) => {
        setGame(g);
        onUpdated(g);
      }}
      onDeleted={onDeleted}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Tab                                                                */
/* ------------------------------------------------------------------ */
export default function GameBuilderTab() {
  const [overview, setOverview] = useState<BuilderOverview | null>(null);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [prompt, setPrompt] = useState("");
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  // The detail a build just returned, so opening that draft needs no second request. Cleared on any toggle.
  const [seed, setSeed] = useState<GameDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchOverview()
      .then((o) => {
        if (cancelled) return;
        setOverview(o);
        setGames(o.games);
      })
      .catch((e) => {
        if (!cancelled) setError(errorText(e, "Could not load the game builder"));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function build() {
    const text = prompt.trim();
    if (!text || building) return;
    setBuilding(true);
    setBuildError(null);
    try {
      const game = await buildGame(text);
      setGames((prev) => [toSummary(game), ...prev.filter((g) => g.id !== game.id)]);
      setSeed(game);
      setSelectedId(game.id);
      setPrompt("");
      window.setTimeout(() => {
        document.getElementById(`gb-game-${game.id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }, 60);
    } catch (e) {
      setBuildError(errorText(e, "The agent could not build this game"));
    } finally {
      setBuilding(false);
    }
  }

  function toggle(id: number) {
    setSeed(null);
    setSelectedId((cur) => (cur === id ? null : id));
  }

  function updated(g: GameDetail) {
    const summary = toSummary(g);
    setGames((prev) => prev.map((x) => (x.id === summary.id ? summary : x)));
  }

  function deleted(id: number) {
    setGames((prev) => prev.filter((g) => g.id !== id));
    setSelectedId(null);
    setSeed(null);
  }

  if (error) return <div className="admin-error">{error}</div>;
  if (!overview)
    return (
      <div className="admin-loading">
        <CourtLoader label="Loading the game builder…" scale={0.7} />
      </div>
    );

  const { enabled, sources } = overview;
  const sourceTitle = (id: string) => sources.find((s) => s.id === id)?.title ?? id;

  return (
    <div className="gb-tab">
      {!enabled && (
        <div className="gb-notice" role="status">
          The AI game builder is off: the backend has no ANTHROPIC_API_KEY. Existing drafts can still be played.
        </div>
      )}

      <section className="admin-card surface gb-build" aria-label="Describe a game">
        <div className="admin-section-label">Describe a game</div>
        <p className="admin-desc gb-build-desc">
          Say what the game should ask in plain words. The agent picks a dataset and builds a playable draft that only
          admins can see; refine it afterwards with follow-up prompts.
          {enabled && overview.model ? ` Agent model: ${overview.model}.` : ""}
        </p>
        <PromptForm
          label="Describe the game"
          placeholder="e.g. Higher or lower: which of two players scored more career points? Only players drafted after 2000."
          rows={4}
          value={prompt}
          onChange={setPrompt}
          onSubmit={build}
          off={!enabled}
          busy={building}
          submitLabel="Build game"
          busyLabel="Building…"
          loaderLabel="The agent is building your game…"
          error={buildError}
        />
        <Disclosure label="Datasets the agent can use" count={sources.length}>
          <SourceList sources={sources} />
        </Disclosure>
      </section>

      <div className="admin-section-label">
        <SwapText swapKey={games.length}>{`Games · ${games.length}`}</SwapText>
      </div>

      <AutoHeight>
        <div className="admin-list">
          {games.map((g) => {
            const open = selectedId === g.id;
            return (
              <div key={g.id} id={`gb-game-${g.id}`} className={`admin-card surface${open ? " is-open" : ""}`}>
                <button type="button" className="admin-card-head gb-card-head" onClick={() => toggle(g.id)} aria-expanded={open}>
                  <span className="admin-card-name">{g.title}</span>
                  <span className="admin-card-source">
                    {MODE_LABEL[g.mode]} · {sourceTitle(g.source)}
                  </span>
                  <span className="admin-card-count">
                    <StatusChip status={g.status} />
                  </span>
                  <span className="admin-card-date">{fmtDate(g.updated_at)}</span>
                  <svg
                    className={`admin-chevron${open ? " is-open" : ""}`}
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                <AutoHeight>
                  {open && (
                    <motion.div
                      className="admin-card-body"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: durations.base, ease: easing.out }}
                    >
                      <GamePanel
                        id={g.id}
                        initial={seed?.id === g.id ? seed : null}
                        enabled={enabled}
                        sources={sources}
                        onUpdated={updated}
                        onDeleted={deleted}
                      />
                    </motion.div>
                  )}
                </AutoHeight>
              </div>
            );
          })}
          {games.length === 0 && (
            <div className="admin-empty">No games yet. Describe a game above and the agent will build the first draft.</div>
          )}
        </div>
      </AutoHeight>
    </div>
  );
}
