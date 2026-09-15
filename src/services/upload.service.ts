// Where an uploaded image buffer actually ends up. Today that's the local
// filesystem, served back out by `express.static` in app.ts — fine for a
// single-server deployment or local development. The moment you deploy to
// more than one server instance (or anywhere with an ephemeral filesystem,
// like most container platforms), local disk storage stops working because
// a file saved on instance A isn't visible from instance B.
//
// This function is the ONLY place in the codebase that knows *where* files
// are stored. Swapping to S3/Cloudinary/GCS later means rewriting the body
// of this one function to `client.upload(buffer).then(r => r.url)` instead —
// every caller (auth.service.ts for KYC docs, aiProduct.service.ts for
// product photos) keeps working unchanged, because they only ever see
// `{ url }` and never touch a filesystem path directly.
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface StoredFile {
  /** Public, web-servable URL path (e.g. "/uploads/products/<uuid>.jpg"). */
  url: string;
  absolutePath: string;
}

export async function persistImageBuffer(buffer: Buffer, mimeType: string, subfolder: string): Promise<StoredFile> {
  const extension = EXTENSION_BY_MIME[mimeType] ?? 'bin';
  const filename = `${randomUUID()}.${extension}`;

  const folder = path.join(process.cwd(), env.UPLOAD_DIR, subfolder);
  await mkdir(folder, { recursive: true });

  const absolutePath = path.join(folder, filename);
  await writeFile(absolutePath, buffer);

  return {
    url: `/${env.UPLOAD_DIR}/${subfolder}/${filename}`,
    absolutePath,
  };
}
