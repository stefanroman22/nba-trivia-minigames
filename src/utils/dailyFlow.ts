// The order of a daily question game's start (solo Contexto): read the gate, load the day's question, and only
// then record the play, so a failed load never uses up the day. Import-free so scripts/check-daily-flow.mjs can
// run it with plain Node.

export type DailyRecord = { kind: "ok"; day: string } | { kind: "locked" } | { kind: "error" };

export type DailyStart<Q> =
  | { kind: "ok"; question: Q }
  | { kind: "locked" } // already played today (the status said so, or another tab/device won the race)
  | { kind: "unavailable" } // the question did not load: nothing was recorded, the player can retry
  | { kind: "error" }; // the server could not be reached or refused the record: no play

export interface DailyFlowDeps<Q> {
  /** GET daily-status: null when the server can't be reached. */
  status: () => Promise<{ locked: boolean; day?: string } | null>;
  /** The question scheduled for `day`, or null when it could not be loaded. */
  load: (day: string) => Promise<Q | null>;
  /** POST daily-play: records today's play. */
  record: () => Promise<DailyRecord>;
}

export async function startDailyQuestion<Q>(deps: DailyFlowDeps<Q>): Promise<DailyStart<Q>> {
  const status = await deps.status();
  if (!status || typeof status.day !== "string") return { kind: "error" };
  if (status.locked) return { kind: "locked" };
  const question = await deps.load(status.day);
  if (question == null) return { kind: "unavailable" };
  const rec = await deps.record();
  if (rec.kind !== "ok") return rec;
  // Paris midnight passed between the status and the record: the play counts for the new day, so deal its question.
  if (rec.day !== status.day) {
    const fresh = await deps.load(rec.day);
    return fresh == null ? { kind: "unavailable" } : { kind: "ok", question: fresh };
  }
  return { kind: "ok", question };
}
