/**
 * Cloudflare R2 storage client for session file persistence.
 *
 * R2 is S3-compatible — we use the AWS S3 SDK protocol via fetch() directly
 * (no external dependency needed). This module handles:
 *   - Uploading files to R2 (text + binary)
 *   - Downloading files from R2
 *   - Listing files in a session prefix
 *   - Deleting files / session prefix
 *
 * R2 key format: sessions/<sessionId>/<path>
 * Example: sessions/abc-123/src/index.ts
 */

import { config } from '../config';
import { createHash, createHmac } from 'crypto';

// ─── Configuration ────────────────────────────────────────────────────────────

function getR2Config() {
  return {
    accountId: config.R2_ACCOUNT_ID,
    accessKeyId: config.R2_ACCESS_KEY_ID,
    secretAccessKey: config.R2_SECRET_ACCESS_KEY,
    bucket: config.R2_BUCKET_NAME || 'ainorx',
    endpoint: config.R2_ENDPOINT ||
      `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  };
}

function isR2Configured(): boolean {
  return !!(config.R2_ACCOUNT_ID && config.R2_ACCESS_KEY_ID && config.R2_SECRET_ACCESS_KEY);
}

// ─── S3-compatible auth (AWS Signature V4) ────────────────────────────────────
// R2 uses AWS Signature V4 for authentication. We implement a minimal version
// that handles PUT, GET, DELETE, and LIST operations.

function awsSignatureV4(
  method: string,
  url: URL,
  headers: Record<string, string>,
  body: Buffer | null,
  accessKeyId: string,
  secretAccessKey: string,
  region: string,
  service: string,
): Record<string, string> {
  const datetime = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const date = datetime.substring(0, 8);

  // Canonical headers (sorted, lowercase keys, trimmed values)
  const headerKeys = Object.keys(headers).map(k => k.toLowerCase()).sort();
  const canonicalHeaders = headerKeys
    .map(k => `${k}:${headers[k]!.trim()}\n`)
    .join('');
  const signedHeaders = headerKeys.join(';');

  // Canonical query string (sorted)
  const canonicalQuery = Array.from(url.searchParams.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  // Payload hash
  const payloadHash = body
    ? createHash('sha256').update(body).digest('hex')
    : createHash('sha256').digest('hex'); // empty string hash

  // Canonical request
  const canonicalRequest = [
    method,
    url.pathname,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  // String to sign
  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    datetime,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  // Signing key
  const kDate = createHmac('sha256', `AWS4${secretAccessKey}`).update(date).digest();
  const kRegion = createHmac('sha256', kDate).update(region).digest();
  const kService = createHmac('sha256', kRegion).update(service).digest();
  const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authHeader =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    ...headers,
    'Authorization': authHeader,
    'x-amz-date': datetime,
    'x-amz-content-sha256': payloadHash,
  };
}

async function r2Request(
  method: string,
  path: string,
  body: Buffer | null = null,
  extraHeaders: Record<string, string> = {},
  queryString: string = '',
): Promise<Response> {
  const r2 = getR2Config();
  const baseUrl = r2.endpoint.replace(/\/$/, '');
  const fullUrl = queryString
    ? `${baseUrl}/${r2.bucket}${path}?${queryString}`
    : `${baseUrl}/${r2.bucket}${path}`;
  const url = new URL(fullUrl);

  const headers: Record<string, string> = {
    'Host': url.host,
    ...extraHeaders,
  };

  const signedHeaders = awsSignatureV4(
    method,
    url,
    headers,
    body,
    r2.accessKeyId,
    r2.secretAccessKey,
    'auto',
    's3',
  );

  return fetch(fullUrl, {
    method,
    headers: signedHeaders,
    body: body ? new Uint8Array(body) : undefined,
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function sessionR2Key(sessionId: string, filePath: string): string {
  // Normalize: remove leading slashes, prevent path traversal
  const cleanPath = filePath.replace(/^\/+/, '').replace(/\.\.\//g, '');
  return `sessions/${sessionId}/${cleanPath}`;
}

export function sessionR2Prefix(sessionId: string): string {
  return `sessions/${sessionId}/`;
}

/** Upload a text file to R2. */
export async function uploadTextFile(
  sessionId: string,
  filePath: string,
  content: string,
  mimeType: string = 'text/plain',
): Promise<string> {
  if (!isR2Configured()) throw new Error('R2 is not configured');
  const key = sessionR2Key(sessionId, filePath);
  const body = Buffer.from(content, 'utf8');
  const res = await r2Request('PUT', `/${key}`, body, {
    'Content-Type': mimeType,
    'Content-Length': String(body.length),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`R2 upload failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return key;
}

/** Upload a binary file to R2. */
export async function uploadBinaryFile(
  sessionId: string,
  filePath: string,
  data: Buffer,
  mimeType: string = 'application/octet-stream',
): Promise<string> {
  if (!isR2Configured()) throw new Error('R2 is not configured');
  const key = sessionR2Key(sessionId, filePath);
  const res = await r2Request('PUT', `/${key}`, data, {
    'Content-Type': mimeType,
    'Content-Length': String(data.length),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`R2 upload failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return key;
}

/** Download a file from R2 as text. */
export async function downloadTextFile(
  sessionId: string,
  filePath: string,
): Promise<string | null> {
  if (!isR2Configured()) throw new Error('R2 is not configured');
  const key = sessionR2Key(sessionId, filePath);
  const res = await r2Request('GET', `/${key}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`R2 download failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.text();
}

/** Download a file from R2 as binary. */
export async function downloadBinaryFile(
  sessionId: string,
  filePath: string,
): Promise<Buffer | null> {
  if (!isR2Configured()) throw new Error('R2 is not configured');
  const key = sessionR2Key(sessionId, filePath);
  const res = await r2Request('GET', `/${key}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`R2 download failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** Delete a single file from R2. */
export async function deleteFile(
  sessionId: string,
  filePath: string,
): Promise<void> {
  if (!isR2Configured()) return;
  const key = sessionR2Key(sessionId, filePath);
  await r2Request('DELETE', `/${key}`);
}

/** Delete all files for a session (cleanup on session delete). */
export async function deleteSessionFiles(sessionId: string): Promise<void> {
  if (!isR2Configured()) return;
  const prefix = sessionR2Prefix(sessionId);
  // List all objects with this prefix, then delete in batches
  const res = await r2Request('GET', '/', null, {}, `list-type=2&prefix=${encodeURIComponent(prefix)}&max-keys=1000`);
  if (!res.ok) return;
  const xml = await res.text();
  // Extract <Key> values from the XML response
  const keys = xml.match(/<Key>([^<]+)<\/Key>/g)?.map(k => k.replace(/<\/?Key>/g, '')) ?? [];
  for (const key of keys) {
    await r2Request('DELETE', `/${key}`);
  }
}

/** List all files in a session's R2 prefix. */
export async function listSessionFiles(
  sessionId: string,
): Promise<Array<{ key: string; size: number; lastModified: string }>> {
  if (!isR2Configured()) return [];
  const prefix = sessionR2Prefix(sessionId);
  const res = await r2Request('GET', '/', null, {}, `list-type=2&prefix=${encodeURIComponent(prefix)}&max-keys=1000`);
  if (!res.ok) return [];
  const xml = await res.text();
  const results: Array<{ key: string; size: number; lastModified: string }> = [];
  const entries = xml.split('<Contents>').slice(1);
  for (const entry of entries) {
    const keyMatch = entry.match(/<Key>([^<]+)<\/Key>/);
    const sizeMatch = entry.match(/<Size>([^<]+)<\/Size>/);
    const dateMatch = entry.match(/<LastModified>([^<]+)<\/LastModified>/);
    if (keyMatch) {
      results.push({
        key: keyMatch[1],
        size: sizeMatch ? parseInt(sizeMatch[1]) : 0,
        lastModified: dateMatch ? dateMatch[1] : '',
      });
    }
  }
  return results;
}
