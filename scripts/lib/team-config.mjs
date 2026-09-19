// Shared constants + loaders for the team pipeline scripts. Zero deps.
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CONFIG_PATH = resolve(ROOT, ".claude/team/config.json");
export const ENV_PATH = resolve(ROOT, ".env.team");

export const STATUS = Object.freeze({
  BACKLOG: "Backlog", TODO: "To Do", IN_PROGRESS: "In progress", QA: "QA", DONE: "Done",
});
export const CATEGORIES = Object.freeze(["frontend", "backend", "fullstack", "CI/CD", "pipeline", "AI", "docs"]);

const DEFAULT_CHANNELS = {
  frontend: "frontend", docs: "frontend",
  backend: "backend", "CI/CD": "backend", AI: "backend", pipeline: "backend",
  fullstack: "both",
};

// Populate process.env from .env.team without overriding values already set.
export function loadEnvTeam() {
  if (!existsSync(ENV_PATH)) return;
  for (const line of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

export function loadConfig() {
  return existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, "utf8")) : {};
}

// Which agent channel key(s) a card's Category posts to: ["frontend"], ["backend"], or both.
export function channelsFor(category, cfg) {
  const map = { ...DEFAULT_CHANNELS, ...(cfg?.slack?.categoryChannels || {}) };
  const v = map[category] || "backend";
  return v === "both" ? ["frontend", "backend"] : [v];
}

export const text = (s) => [{ type: "text", text: { content: String(s).slice(0, 1900) } }];
