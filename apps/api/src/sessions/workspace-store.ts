/**
 * Session workspace store — high-level CRUD for session files.
 *
 * Combines R2 (binary/large file storage) with PostgreSQL (metadata, small
 * text content inline for fast listing). This is the replacement for the
 * Git-based file system when KORTIX_SESSION_MODE=simple.
 */

import { eq } from 'drizzle-orm';
import { db } from '../shared/db';
import { sessionWorkspaces, sessionFiles } from '@kortix/db';
import { uploadTextFile, uploadBinaryFile, downloadTextFile, downloadBinaryFile, deleteFile, deleteSessionFiles, listSessionFiles, sessionR2Prefix } from './r2-storage';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileInfo {
  path: string;
  sizeBytes: number;
  isBinary: boolean;
  mimeType: string | null;
  updatedAt: string;
}

export interface FileContent {
  path: string;
  content: string | Buffer;
  isBinary: boolean;
  mimeType: string | null;
  sizeBytes: number;
}

// ─── Workspace lifecycle ─────────────────────────────────────────────────────

/** Create a workspace record for a new session. */
export async function createWorkspace(
  sessionId: string,
  accountId: string,
): Promise<void> {
  await db.insert(sessionWorkspaces).values({
    sessionId,
    accountId,
    r2Prefix: sessionR2Prefix(sessionId),
  }).onConflictDoNothing();
}

/** Delete a workspace and all its files (R2 + DB). */
export async function deleteWorkspace(sessionId: string): Promise<void> {
  // Delete from R2 first (best-effort)
  await deleteSessionFiles(sessionId).catch(() => {});
  // Delete DB records (cascade handles session_files)
  await db.delete(sessionWorkspaces).where(eq(sessionWorkspaces.sessionId, sessionId));
}

// ─── File operations ─────────────────────────────────────────────────────────

/** List all files in a session workspace. */
export async function listFiles(sessionId: string): Promise<FileInfo[]> {
  const rows = await db
    .select({
      path: sessionFiles.path,
      sizeBytes: sessionFiles.sizeBytes,
      isBinary: sessionFiles.isBinary,
      mimeType: sessionFiles.mimeType,
      updatedAt: sessionFiles.updatedAt,
    })
    .from(sessionFiles)
    .where(eq(sessionFiles.sessionId, sessionId));

  return rows.map(r => ({
    path: r.path,
    sizeBytes: r.sizeBytes,
    isBinary: r.isBinary,
    mimeType: r.mimeType,
    updatedAt: r.updatedAt?.toISOString() ?? new Date().toISOString(),
  }));
}

/** Read a file's content from a session workspace. */
export async function readFile(
  sessionId: string,
  filePath: string,
): Promise<FileContent | null> {
  const [row] = await db
    .select()
    .from(sessionFiles)
    .where(eq(sessionFiles.sessionId, sessionId))
    .limit(1);

  // Try DB first for inline text content
  const [fileRow] = await db
    .select()
    .from(sessionFiles)
    .where(eq(sessionFiles.sessionId, sessionId))
    .limit(1);

  // Find by path
  const allFiles = await db
    .select()
    .from(sessionFiles)
    .where(eq(sessionFiles.sessionId, sessionId));

  const file = allFiles.find(f => f.path === filePath);
  if (!file) return null;

  if (file.isBinary || file.content === null) {
    // Download from R2
    const content = await downloadBinaryFile(sessionId, filePath);
    if (content === null) return null;
    return {
      path: filePath,
      content,
      isBinary: true,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    };
  }

  return {
    path: filePath,
    content: file.content,
    isBinary: false,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
  };
}

/** Write (create or update) a file in a session workspace. */
export async function writeFile(
  sessionId: string,
  filePath: string,
  content: string | Buffer,
  mimeType?: string,
): Promise<void> {
  const isBinary = Buffer.isBuffer(content);
  const sizeBytes = isBinary ? (content as Buffer).length : Buffer.byteLength(content as string, 'utf8');

  // For small text files (< 512KB), store content inline in DB for fast listing.
  // For larger files or binary, store in R2 and keep only metadata in DB.
  const INLINE_THRESHOLD = 512 * 1024; // 512KB
  let inlineContent: string | null = null;
  let r2Key: string | null = null;

  if (!isBinary && sizeBytes <= INLINE_THRESHOLD) {
    inlineContent = content as string;
  } else {
    // Upload to R2
    if (isBinary) {
      r2Key = await uploadBinaryFile(sessionId, filePath, content as Buffer, mimeType ?? 'application/octet-stream');
    } else {
      r2Key = await uploadTextFile(sessionId, filePath, content as string, mimeType ?? 'text/plain');
    }
  }

  // Upsert the file record
  const existing = await db
    .select()
    .from(sessionFiles)
    .where(eq(sessionFiles.sessionId, sessionId));

  const fileRow = existing.find(f => f.path === filePath);

  if (fileRow) {
    // Update — also delete old R2 object if switching from R2 to inline
    if (fileRow.r2Key && !r2Key) {
      await deleteFile(sessionId, filePath).catch(() => {});
    }
    await db
      .update(sessionFiles)
      .set({
        content: inlineContent,
        r2Key,
        isBinary,
        sizeBytes,
        mimeType: mimeType ?? null,
        updatedAt: new Date(),
      })
      .where(eq(sessionFiles.fileId, fileRow.fileId));
  } else {
    await db.insert(sessionFiles).values({
      sessionId,
      path: filePath,
      content: inlineContent,
      r2Key,
      isBinary,
      sizeBytes,
      mimeType: mimeType ?? null,
    });
  }

  // Update workspace metadata
  await updateWorkspaceMetadata(sessionId);
}

/** Delete a file from a session workspace. */
export async function removeFile(
  sessionId: string,
  filePath: string,
): Promise<void> {
  // Delete from R2 if it was stored there
  const allFiles = await db
    .select()
    .from(sessionFiles)
    .where(eq(sessionFiles.sessionId, sessionId));

  const file = allFiles.find(f => f.path === filePath);
  if (file?.r2Key) {
    await deleteFile(sessionId, filePath).catch(() => {});
  }

  // Delete DB record
  if (file) {
    await db
      .delete(sessionFiles)
      .where(eq(sessionFiles.fileId, file.fileId));
  }

  await updateWorkspaceMetadata(sessionId);
}

// ─── Internal helpers ────────────────────────────────────────────────────────

async function updateWorkspaceMetadata(sessionId: string): Promise<void> {
  const files = await db
    .select({ sizeBytes: sessionFiles.sizeBytes })
    .from(sessionFiles)
    .where(eq(sessionFiles.sessionId, sessionId));

  const fileCount = files.length;
  const totalSizeBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);

  await db
    .update(sessionWorkspaces)
    .set({
      fileCount,
      totalSizeBytes,
      updatedAt: new Date(),
    })
    .where(eq(sessionWorkspaces.sessionId, sessionId));
}
