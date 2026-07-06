// Criteria semantics (frozen contract #3) — the single client-side truth for
// whether a player satisfies a Criterion. Heatmap / NBA Grid / Tic-Tac-Toe /
// Bingo all validate answers with this against the players-index pool
// (alias matching itself lives in utils/answerMatch.ts).
//
// Sanity examples (pure evaluations):
//   playerMatches(dirk,   { type: "team",  value: "DAL",     label: "Mavericks"    }) === true
//     // dirk.teams = [{ abbr: "DAL", start_year: 1998, end_year: 2019, ... }]
//   playerMatches(jordan, { type: "award", value: "ring",    label: "Won a ring"   }) === true
//     // jordan.awards.rings = [1991, 1992, 1993, 1996, 1997, 1998] — non-empty
//   playerMatches(curry,  { type: "era",   value: "1990s",   label: "Played in the 90s" }) === false
//     // curry's only stint starts 2009: [2009, now] does not overlap 1990–1999

import type { Criterion, PlayerIndexEntry } from "../types/types";

const CURRENT_YEAR = new Date().getFullYear();

/** "1990s" / "decade-1990s" -> 1990; null when the value has no decade. */
function decadeStart(value: string): number | null {
  const m = value.match(/(\d{4})s$/);
  return m ? parseInt(m[1], 10) : null;
}

/** Does player `p` satisfy criterion `c`? (Pure — no fetches, no state.) */
export function playerMatches(p: PlayerIndexEntry, c: Criterion): boolean {
  switch (c.type) {
    case "team":
      // Franchise abbreviation — any stint with that franchise counts.
      return p.teams.some((t) => t.abbr === c.value);

    case "award": {
      const a = p.awards;
      switch (c.value) {
        case "mvp": return a.mvp.length > 0;
        case "fmvp": return a.fmvp.length > 0;
        case "dpoy": return a.dpoy.length > 0;
        case "roty": return a.roty != null;
        case "smoy": return a.smoy.length > 0;
        case "ring": return a.rings.length > 0;
        case "allstar5plus": return a.allstar_count >= 5;
        case "allnba": return a.allnba_count > 0;
        default: return false;
      }
    }

    case "country":
      if (c.value === "USA") return p.country === "USA";
      if (c.value === "INTL") return p.country !== "USA";
      return p.country === c.value;

    case "draft": {
      if (c.value === "undrafted") return p.draft == null;
      if (!p.draft) return false;
      if (c.value === "top5") return p.draft.pick <= 5;
      if (c.value === "lottery") return p.draft.pick <= 14;
      if (c.value === "round2") return p.draft.round === 2;
      if (c.value.startsWith("decade-")) {
        const d = decadeStart(c.value);
        return d != null && p.draft.year >= d && p.draft.year <= d + 9;
      }
      return false;
    }

    case "college":
      if (c.value === "none") return p.college == null;
      return p.college === c.value;

    case "stat":
      switch (c.value) {
        case "20kpts": return p.career.pts >= 20000;
        case "25kpts": return p.career.pts >= 25000;
        case "ppg20": return p.career.ppg >= 20; // career average
        case "rpg10": return p.career.rpg >= 10;
        case "apg8": return p.career.apg >= 8;
        case "seasons15plus": return p.career.seasons >= 15;
        default: return false;
      }

    case "era": {
      // Any stint [start_year, end_year || current] intersecting the decade.
      const d = decadeStart(c.value);
      if (d == null) return false;
      return p.teams.some(
        (t) => t.start_year <= d + 9 && (t.end_year ?? CURRENT_YEAR) >= d,
      );
    }

    default:
      return false;
  }
}
