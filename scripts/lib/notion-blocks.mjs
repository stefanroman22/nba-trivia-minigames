// Pure markdown-lite -> Notion block conversion for task-card bodies.
// Supported lines: "## "/"### " headings, "- " bullets, "![caption](local/path.png)" images, anything
// else is a paragraph. Blank lines are skipped. Long lines are split so no rich_text exceeds the
// Notion limit. Images are resolved through `imageBlock(path, caption)` (injected: it uploads the
// file and returns the block), which keeps this module free of I/O and testable.
const MAX_TEXT = 1900;
const IMAGE_LINE = /^!\[([^\]]*)\]\((.+)\)\s*$/;

const rich = (s) => [{ type: "text", text: { content: s } }];

function chunks(s) {
  const out = [];
  let rest = s;
  while (rest.length > MAX_TEXT) {
    let cut = rest.lastIndexOf(" ", MAX_TEXT);
    if (cut < MAX_TEXT / 2) cut = MAX_TEXT;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  out.push(rest);
  return out;
}

export async function markdownToBlocks(markdown, imageBlock) {
  const blocks = [];
  for (const raw of String(markdown).split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;

    const img = IMAGE_LINE.exec(line.trim());
    if (img) { blocks.push(await imageBlock(img[2], img[1])); continue; }

    const heading = /^(#{2,3})\s+(.*)$/.exec(line);
    if (heading) {
      const type = heading[1].length === 2 ? "heading_2" : "heading_3";
      chunks(heading[2]).forEach((c) => blocks.push({ object: "block", type, [type]: { rich_text: rich(c) } }));
      continue;
    }

    const bullet = /^\s*-\s+(.*)$/.exec(line);
    if (bullet) {
      chunks(bullet[1]).forEach((c) => blocks.push({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: rich(c) } }));
      continue;
    }

    chunks(line).forEach((c) => blocks.push({ object: "block", type: "paragraph", paragraph: { rich_text: rich(c) } }));
  }
  return blocks;
}
