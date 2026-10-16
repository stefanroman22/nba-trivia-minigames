import { test } from "node:test";
import assert from "node:assert/strict";
import { markdownToBlocks, blockBatches } from "./notion-blocks.mjs";
import { assembleSpec } from "./notion-spec.mjs";

const fakeImage = async (path, caption) => ({ object: "block", type: "image", image: { type: "file_upload", file_upload: { id: `id:${path}` }, caption: caption ? [{ type: "text", text: { content: caption } }] : [] } });
const content = (b) => b[b.type].rich_text.map((t) => t.text.content).join("");

test("headings, bullets, paragraphs and images map to blocks in order", async () => {
  const md = ["## Goal", "", "Make it fast", "- step one", "### Detail", "![before](C:\\x\\a.png)"].join("\n");
  const blocks = await markdownToBlocks(md, fakeImage);
  assert.deepEqual(blocks.map((b) => b.type), ["heading_2", "paragraph", "bulleted_list_item", "heading_3", "image"]);
  assert.equal(content(blocks[0]), "Goal");
  assert.equal(content(blocks[2]), "step one");
  assert.equal(blocks[4].image.file_upload.id, "id:C:\\x\\a.png");
});

test("long lines are split under the rich_text limit without losing text", async () => {
  const long = Array.from({ length: 700 }, (_, i) => `w${i}`).join(" ");
  const blocks = await markdownToBlocks(long, fakeImage);
  assert.ok(blocks.length > 1);
  assert.ok(blocks.every((b) => content(b).length <= 1900));
  assert.equal(blocks.map(content).join(" "), long);
});

test("the pipeline's spec assembler reads the blocks back as plain spec text", async () => {
  const blocks = await markdownToBlocks("## Goal\n- one\nplain", fakeImage);
  const asRead = blocks.map((b) => ({ type: b.type, [b.type]: { rich_text: b[b.type].rich_text.map((t) => ({ plain_text: t.text.content })) } }));
  const out = await assembleSpec({ blocks: asRead, files: [], comments: [], botId: "bot", download: async () => null });
  assert.equal(out, "## Goal\n- one\nplain");
});

test("an attached findings.json is downloaded under its own name and listed as a file", async () => {
  const seen = [];
  const download = async (url, index, name) => { seen.push({ url, index, name }); return `/att/p1/${name}`; };
  const files = [{ name: "findings.json", type: "file", file: { url: "https://s3/x/findings.json?sig=1" } }];
  const out = await assembleSpec({ blocks: [], files, comments: [], botId: "bot", download });
  assert.deepEqual(seen, [{ url: "https://s3/x/findings.json?sig=1", index: 0, name: "findings.json" }]);
  assert.equal(out, "[File attached: /att/p1/findings.json (findings.json)]");
});

test("a >100-block body is split into request batches of at most 100, order kept", async () => {
  const md = Array.from({ length: 250 }, (_, i) => `- item ${i}`).join("\n");
  const blocks = await markdownToBlocks(md, fakeImage);
  const batches = blockBatches(blocks);
  assert.deepEqual(batches.map((b) => b.length), [100, 100, 50]);
  assert.deepEqual(batches.flat(), blocks);
  assert.deepEqual(blockBatches([]), []);
});
