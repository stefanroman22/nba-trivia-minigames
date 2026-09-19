import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleSpec } from "./notion-spec.mjs";

const rt = (s) => [{ plain_text: s }];
const download = async (url, i) => (url.includes("fail") ? null : `/tmp/att/${i}.png`);

test("body blocks: headings, bullets, paragraphs, images", async () => {
  const blocks = [
    { type: "heading_2", heading_2: { rich_text: rt("Goal") } },
    { type: "paragraph", paragraph: { rich_text: rt("Make it fast") } },
    { type: "bulleted_list_item", bulleted_list_item: { rich_text: rt("step one") } },
    { type: "image", image: { type: "file", file: { url: "https://n/1.png" } } },
    { type: "image", image: { type: "external", external: { url: "https://n/fail.png" } } },
  ];
  const out = await assembleSpec({ blocks, files: [], comments: [], botId: "bot", download });
  assert.equal(out, [
    "## Goal", "Make it fast", "- step one", "[Image attached: /tmp/att/0.png]",
    "[Image attached: DOWNLOAD FAILED — an image exists on this card but could not be fetched; ask the owner to re-upload it directly in Notion before building]",
  ].join("\n"));
});

test("Attachments property: images vs other files, external urls", async () => {
  const files = [
    { type: "file", name: "mock.png", file: { url: "https://n/mock.png" } },
    { type: "external", name: "brief.pdf", external: { url: "https://x/brief.pdf" } },
  ];
  const out = await assembleSpec({ blocks: [], files, comments: [], botId: "bot", download });
  assert.equal(out, "[Image attached: /tmp/att/0.png]\n[File attached: /tmp/att/1.png (brief.pdf)]");
});

test("comments: owner comments included with attachments, bot comments skipped", async () => {
  const comments = [
    { created_by: { id: "bot" }, created_time: "2026-09-16T10:00:00Z", rich_text: rt("🤖 started"), attachments: [] },
    { created_by: { id: "u1", name: "Stefan" }, created_time: "2026-09-16T11:00:00Z", rich_text: rt("also see this"),
      attachments: [{ category: "image", file: { url: "https://n/c.png" } }] },
  ];
  const out = await assembleSpec({ blocks: [], files: [], comments, botId: "bot", download });
  assert.equal(out, "## Comment (Stefan, 2026-09-16)\nalso see this\n[Image attached: /tmp/att/0.png]");
});

test("download index is continuous across sources", async () => {
  const seen = [];
  const dl = async (url, i) => { seen.push(i); return `/p/${i}`; };
  await assembleSpec({
    blocks: [{ type: "image", image: { type: "file", file: { url: "a" } } }],
    files: [{ type: "file", name: "b.png", file: { url: "b" } }],
    comments: [{ created_by: { id: "u" }, created_time: "2026-01-01T00:00:00Z", rich_text: rt("c"), attachments: [{ category: "image", file: { url: "c" } }] }],
    botId: "bot", download: dl,
  });
  assert.deepEqual(seen, [0, 1, 2]);
});
