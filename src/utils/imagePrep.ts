/** Browser-side prep for profile photo uploads: centre-square crop + downscale to a JPEG so any
 *  input size fits under the API's body limit. The server re-normalizes; this only bounds size. */
export const PHOTO_MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const PHOTO_CANVAS_SIZE = 512;
/** theme.css --surface3: same flatten colour the server uses for transparent images. */
export const PHOTO_BACKGROUND = "#2b2b30";
export const PHOTO_UNREADABLE_MESSAGE = "We couldn't read that image. Try a JPG, PNG, WebP or GIF under 4 MB.";

export class PhotoPrepError extends Error {}

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

async function decode(file: File): Promise<Decoded | null> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
  } catch {
    // fall through to the <img> path (older browsers / formats createImageBitmap rejects)
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("decode failed"));
      img.src = url;
    });
    if (!img.naturalWidth || !img.naturalHeight) {
      URL.revokeObjectURL(url);
      return null;
    }
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

export async function prepareProfilePhoto(file: File): Promise<Blob> {
  const decoded = await decode(file);
  if (!decoded) {
    // The browser can't read it (e.g. HEIC on Chrome): let the server try, if it's small enough.
    if (file.size <= PHOTO_MAX_UPLOAD_BYTES) return file;
    throw new PhotoPrepError(PHOTO_UNREADABLE_MESSAGE);
  }
  try {
    const side = Math.min(decoded.width, decoded.height);
    const out = Math.max(1, Math.min(PHOTO_CANVAS_SIZE, side));
    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new PhotoPrepError(PHOTO_UNREADABLE_MESSAGE);
    ctx.fillStyle = PHOTO_BACKGROUND;
    ctx.fillRect(0, 0, out, out);
    const sx = Math.floor((decoded.width - side) / 2);
    const sy = Math.floor((decoded.height - side) / 2);
    ctx.drawImage(decoded.source, sx, sy, side, side, 0, 0, out, out);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) throw new PhotoPrepError(PHOTO_UNREADABLE_MESSAGE);
    return blob;
  } finally {
    decoded.release();
  }
}
