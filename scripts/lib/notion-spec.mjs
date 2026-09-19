// Pure spec assembly for a Notion task card: body blocks + Attachments property + comments.
// `download(url, index)` is injected so this stays testable; it returns a local path or null.
const FAILED = "[Image attached: DOWNLOAD FAILED — an image exists on this card but could not be fetched; ask the owner to re-upload it directly in Notion before building]";
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)(\?|$)/i;

const plain = (rich) => (rich || []).map((t) => t.plain_text).join("");
const fileUrl = (f) => (f.type === "external" ? f.external?.url : f.file?.url);

export async function assembleSpec({ blocks = [], files = [], comments = [], botId, download }) {
  let index = 0;
  const out = [];
  const grab = async (url, label) => {
    const path = await download(url, index++);
    if (!path) return FAILED;
    return label ? `[File attached: ${path} (${label})]` : `[Image attached: ${path}]`;
  };

  for (const b of blocks) {
    if (b.type === "image") { out.push(await grab(fileUrl(b.image))); continue; }
    const rich = b[b.type]?.rich_text;
    if (!rich) continue;
    const prefix = b.type.startsWith("heading") ? "## " : b.type === "bulleted_list_item" ? "- " : "";
    out.push(prefix + plain(rich));
  }

  for (const f of files) {
    const url = fileUrl(f);
    const isImage = IMAGE_EXT.test(f.name || "") || IMAGE_EXT.test(url || "");
    out.push(await grab(url, isImage ? null : f.name || "file"));
  }

  for (const c of comments) {
    if (c.created_by?.id === botId) continue;
    const who = c.created_by?.name || "owner";
    out.push(`## Comment (${who}, ${String(c.created_time || "").slice(0, 10)})`);
    const body = plain(c.rich_text);
    if (body) out.push(body);
    for (const a of c.attachments || []) {
      const isImage = a.category === "image";
      out.push(await grab(a.file?.url, isImage ? null : a.category || "file"));
    }
  }
  return out.join("\n");
}
