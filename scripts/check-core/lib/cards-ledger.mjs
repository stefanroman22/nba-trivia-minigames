// <home>/notion-cards.json: fingerprint → { key, card, url, title, status, run, at, decision }. A mirror of what
// notion-push decided, for speed and for humans; Notion (the card's Source property) is the truth.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { uicHome } from './home.mjs';

export const ledgerPath = (home = uicHome()) => path.join(home, 'notion-cards.json');

export function readLedger(file = ledgerPath()) {
  if (!existsSync(file)) return {};
  try { return JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return {}; }
}

/** Merge entries ({ fp: {...} }) into the ledger file (atomic rename). */
export function recordLedger(entries, file = ledgerPath()) {
  const all = { ...readLedger(file), ...entries };
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(all, null, 2) + '\n');
  renameSync(tmp, file);
  return all;
}
