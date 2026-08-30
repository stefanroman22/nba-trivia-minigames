/**
 * Fires at 05:30 and 15:30 UTC (07:30 / 17:30 local, UTC+2) and dispatches the
 * team-reports workflow with the matching session, so the Slack report posts on
 * time instead of whenever GitHub's own scheduler wakes up.
 *
 * Secret: GITHUB_TOKEN — fine-grained PAT, repo nba-trivia-minigames, Actions:
 * read+write. Set with:  wrangler secret put GITHUB_TOKEN -c infra/report-cron/wrangler.toml
 */
const REPO = "stefanroman22/nba-trivia-minigames";
const WORKFLOW = "team-reports.yml";

export default {
  async scheduled(event, env) {
    const session = event.cron === "30 15 * * *" ? "day" : "night";
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
          "Accept": "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "nba-report-cron", // GitHub's API rejects requests without one
        },
        body: JSON.stringify({ ref: "main", inputs: { session } }),
      },
    );
    if (res.status !== 204) {
      // Throwing marks the invocation failed in the Cloudflare dashboard, which
      // is the only place this Worker's health is visible.
      throw new Error(`dispatch ${session} failed: HTTP ${res.status} ${await res.text()}`);
    }
    console.log(`dispatched ${session} report`);
  },
};
