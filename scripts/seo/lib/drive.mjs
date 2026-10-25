// Google Drive for the SEO agent's exports: put a text file into a folder through the Drive API with the owner's OAuth
// token (scope `drive`, scripts/seo/auth.mjs). A file of the same name already in the folder (the names carry the date,
// so: the same day) is replaced in place, never duplicated. Errors carry the step and the HTTP status only, never a
// token or a response body.
import { randomUUID } from 'node:crypto';
import { readJson } from './google-auth.mjs';

export const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
export const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';

/**
 * The multipart/related body of a Drive create: part 1 the JSON metadata, part 2 the content.
 * @returns {{ contentType: string, body: string }}
 */
export function multipartBody(metadata, mimeType, content, boundary = `seo-${randomUUID()}`) {
  const body = [
    `--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', JSON.stringify(metadata),
    `--${boundary}`, `Content-Type: ${mimeType}`, '', content,
    `--${boundary}--`, '',
  ].join('\r\n');
  return { contentType: `multipart/related; boundary=${boundary}`, body };
}

/** A Drive query string literal: backslashes and single quotes escaped. */
const literal = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/**
 * Uploads `body` as `name` into the folder `folderId`: finds a live file of that name there (GET files?q=…); found →
 * PATCH its content (uploadType=media), else a multipart create with parents [folderId].
 *
 * @param {{ token: { access(): Promise<string> } | string, folderId: string, name: string, mimeType: string,
 *   body: string, fetch?: typeof fetch }} opts `token` a tokenSource (or a fixed access token)
 * @returns {Promise<{ id: string, name: string }>}
 */
export async function driveUpload({ token, folderId, name, mimeType, body, fetch: fetchImpl = globalThis.fetch }) {
  const access = typeof token === 'string' ? token : await token.access();
  const call = async (what, url, init = {}) => {
    let res;
    try {
      res = await fetchImpl(url, { ...init, headers: { authorization: `Bearer ${access}`, ...init.headers } });
    } catch (e) {
      throw new Error(`drive ${what}: request failed (${e.cause?.code || e.name})`);
    }
    if (!res.ok) { await res.body?.cancel(); throw new Error(`drive ${what}: ${res.status}`); }
    return readJson(res, `drive ${what}`);
  };

  const q = `name='${literal(name)}' and '${literal(folderId)}' in parents and trashed=false`;
  const found = await call('find', `${FILES_URL}?${new URLSearchParams({ q, fields: 'files(id,name)' })}`);
  const existing = found.files?.[0];
  if (existing?.id) {
    const r = await call('update', `${UPLOAD_URL}/${encodeURIComponent(existing.id)}?uploadType=media`, {
      method: 'PATCH', headers: { 'content-type': mimeType }, body,
    });
    return { id: r.id ?? existing.id, name: r.name ?? name };
  }
  const mp = multipartBody({ name, parents: [folderId], mimeType }, mimeType, body);
  const r = await call('create', `${UPLOAD_URL}?uploadType=multipart`, {
    method: 'POST', headers: { 'content-type': mp.contentType }, body: mp.body,
  });
  return { id: r.id, name: r.name ?? name };
}
