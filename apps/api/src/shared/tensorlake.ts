/**
 * Tensorlake SDK client factory.
 *
 * Singleton pattern matching the existing Daytona client factory.
 * Tensorlake's TypeScript SDK is imported from the 'tensorlake' package.
 * Unlike Daytona, Tensorlake does not require a separate "warm target" —
 * MEMORY checkpoints work on the default region (official API, not experimental).
 */

import {
  Sandbox as TensorlakeSandbox,
  findSandboxImageByName,
  listSandboxImages,
  deleteSandboxImage,
  SandboxStatus,
} from 'tensorlake';
import { config, type SandboxProviderName } from '../config';
import { warmSnapshotSetting } from '../platform/services/runtime-settings';

// Re-export the Sandbox class for direct use by the provider
export { TensorlakeSandbox as Sandbox, SandboxStatus };

// Re-export image management functions so adapters can import from here
// instead of reaching into the SDK directly (consistent import path).
export { findSandboxImageByName, listSandboxImages, deleteSandboxImage };

// ─── Configuration ──────────────────────────────────────────────────────────────

/**
 * Check if Tensorlake is configured (API key is set).
 */
export function isTensorlakeConfigured(): boolean {
  return !!config.TENSORLAKE_API_KEY;
}

/**
 * True when warm (memory-state) snapshots are turned on AND Tensorlake is configured.
 * Tensorlake MEMORY checkpoints are an official API (not experimental like Daytona's
 * _experimental_createSnapshot), so no special "warm target" is needed.
 */
export function tensorlakeWarmSnapshotsEnabled(): boolean {
  return warmSnapshotSetting().enabled && isTensorlakeConfigured();
}

/**
 * Provider-aware warm-snapshot gate — mirrors warmSnapshotsEnabledFor() in daytona.ts.
 * Tensorlake needs no warm target (MEMORY checkpoints are first-class), so only the
 * master toggle + API key are required.
 */
export function warmSnapshotsEnabledForTensorlake(provider: SandboxProviderName): boolean {
  if (!warmSnapshotSetting().enabled) return false;
  if (provider === 'tensorlake') return isTensorlakeConfigured();
  return false;
}

// ─── Name-based scoping (replaces Daytona labels) ─────────────────────────────
//
// Tensorlake does not support arbitrary labels. Instead, we use a name prefix
// convention: `vaelorx-{env}-{slug}`. This allows the orphan reaper to identify
// managed sandboxes by name pattern instead of by label.

/**
 * Build a Tensorlake-safe sandbox name from a session name.
 * Must be lowercase letters, digits, and hyphens only (Tensorlake slug constraint).
 * Includes the KORTIX_ENV so the reaper can scope its sweep.
 */
export function buildTensorlakeName(accountId: string, sessionName: string): string {
  const env = config.INTERNAL_KORTIX_ENV;
  const raw = `vaelorx-${env}-${accountId.slice(0, 8)}-${sessionName}`;
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60); // Tensorlake name length limit
}

/**
 * Check if a sandbox name matches our managed pattern.
 * Used by the orphan reaper to scope its sweep (replaces Daytona label filtering).
 */
export function isManagedTensorlakeName(name: string | null): boolean {
  if (!name) return false;
  const env = config.INTERNAL_KORTIX_ENV;
  return name.startsWith(`vaelorx-${env}-`);
}

// ─── Snapshot Helpers ──────────────────────────────────────────────────────────
//
// Tensorlake uses "registered images" instead of Daytona's "snapshots".
// Images are looked up by name via findSandboxImageByName().

export interface TensorlakeImageSummary {
  id: string;
  snapshotId: string;
  name: string;
  isPublic: boolean;
  createdAt: string | null;
}

/**
 * List all registered images in the current project/namespace.
 */
export async function listTensorlakeImages(): Promise<TensorlakeImageSummary[]> {
  if (!config.TENSORLAKE_API_KEY) throw new Error('Missing TENSORLAKE_API_KEY');
  try {
    const images = await listSandboxImages();
    return (images as any[]).map((img: any) => ({
      id: img.id,
      snapshotId: img.snapshotId,
      name: img.name,
      isPublic: img.isPublic ?? false,
      createdAt: img.createdAt ?? null,
    }));
  } catch (err) {
    throw new Error(`Tensorlake list images failed: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Delete a registered image by name. Returns true on success or when
 * the image is already gone. Best-effort — never throws.
 */
export async function deleteTensorlakeImageByName(name: string): Promise<boolean> {
  if (!config.TENSORLAKE_API_KEY) return false;
  try {
    const image = await findSandboxImageByName(name);
    if (!image) return true; // Already gone
    if (image.snapshotId) {
      await deleteSandboxImage(image.snapshotId);
    }
    return true;
  } catch {
    return false;
  }
}
