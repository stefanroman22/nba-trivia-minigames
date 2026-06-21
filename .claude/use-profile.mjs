#!/usr/bin/env node
// .claude/use-profile.mjs
// Switch the coding-engine profile (model + reasoning effort) for the whole subagent fleet.
// Usage: node .claude/use-profile.mjs <profile>   (or: npm run engine <profile>)
//        node .claude/use-profile.mjs              (prints current + available profiles)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const profilesPath = join(here, 'profiles.json');
const settingsPath = join(here, 'settings.json');
const activePath = join(here, 'active-profile');

const profilesDoc = JSON.parse(readFileSync(profilesPath, 'utf8'));
const profiles = profilesDoc.profiles ?? {};
const names = Object.keys(profiles);
const requested = process.argv[2];

function readActive() {
  try { return readFileSync(activePath, 'utf8').trim(); } catch { return '(unknown)'; }
}

if (!requested) {
  console.log(`Active profile: ${readActive()}`);
  console.log(`Available profiles: ${names.join(', ')}`);
  console.log('Usage: npm run engine <profile>');
  process.exit(0);
}

if (!profiles[requested]) {
  console.error(`Unknown profile "${requested}". Available: ${names.join(', ')}`);
  process.exit(1);
}

const { subagentModel, effort } = profiles[requested];
const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
settings.env = settings.env ?? {};
settings.env.CLAUDE_CODE_SUBAGENT_MODEL = subagentModel;
settings.env.CLAUDE_CODE_EFFORT_LEVEL = effort;
writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
writeFileSync(activePath, requested + '\n');

console.log(`Engine profile -> ${requested}`);
console.log(`  CLAUDE_CODE_SUBAGENT_MODEL = ${subagentModel}`);
console.log(`  CLAUDE_CODE_EFFORT_LEVEL   = ${effort}`);
console.log('Updated .claude/settings.json. Commit + push so web/routines/CI pick it up.');
