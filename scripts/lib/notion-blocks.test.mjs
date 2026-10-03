import { test } from "node:test";
import assert from "node:assert/strict";
import { markdownToBlocks } from "./notion-blocks.mjs";
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
