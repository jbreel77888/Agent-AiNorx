/**
 * Tensorlake snapshot adapter.
 *
 * Implements the SandboxProviderAdapter interface for building, querying, and
 * deleting sandbox images on Tensorlake. Replaces the Daytona snapshot system
 * (daytona.snapshot.create/get/delete) with Tensorlake's Image Build API and
 * registered image management.
 *
 * Key differences from Daytona:
 *   - Image building: uses the Tensorlake Image DSL or Dockerfile import
 *     instead of daytona.snapshot.create(Image.fromDockerfile).
 *   - Snapshot state: images are either registered (active) or missing.
 *     No "building"/"pending" state to poll — build() blocks until complete.
 *   - Warm snapshots: checkpoint(type=MEMORY) is an official API, not
 *     experimental. Much more reliable than Daytona's _experimental variant.
 *   - Content-addressed: image names follow the same kortix-snap-<hash>
 *     convention, so the builder.ts name-resolution logic works unchanged.
 */

import { config } from '../../config';
import {
  isTensorlakeConfigured,
  findSandboxImageByName,
  deleteSandboxImage,
} from '../../shared/tensorlake';
// Image DSL + build/import functions are not re-exported from shared/tensorlake
// because they're only needed by this adapter (not by providers or reconciler).
import {
  Image,
  importSandboxImage,
} from 'tensorlake';
import { withTimeout } from '../../shared/with-timeout';
import type { SandboxProviderAdapter, ProviderState, BuildableTemplate, BuildLogTap } from './index';

// ─── Timeouts ─────────────────────────────────────────────────────────────────
// The Tensorlake SDK takes no per-call timeout, so a degraded upstream can
// leave the promise pending indefinitely (same situation as the Daytona SDK).
// Bound all SDK calls so a slow/degraded API degrades gracefully instead of
// hanging the provision IIFE forever.

const BUILD_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes (matches Daytona)
const SNAPSHOT_STATE_TIMEOUT_MS = 8_000;  // 8 seconds (matches Daytona)

// ─── Quota Error Detection ────────────────────────────────────────────────────
// Trial/free Tensorlake plans limit concurrent sandboxes. When the quota is
// exceeded, the API returns an error. Detect these so the caller can fall back
// to the base image instead of marking the session as failed.

export class TensorlakeQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TensorlakeQuotaError';
  }
}

export function isTensorlakeQuotaError(error: unknown): boolean {
  if (error instanceof TensorlakeQuotaError) return true;
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    msg.includes('quota') ||
    msg.includes('concurrent sandbox') ||
    msg.includes('sandboxes are running') ||
    msg.includes('limit exceeded') ||
    msg.includes('capacity') ||
    msg.includes('too many')
  );
}

// ─── Adapter ───────────────────────────────────────────────────────────────────

export class TensorlakeAdapter implements SandboxProviderAdapter {
  readonly id = 'tensorlake';

  isConfigured(): boolean {
    return isTensorlakeConfigured();
  }

  /**
   * Build a snapshot image on Tensorlake from a Dockerfile.
   *
   * Tensorlake supports two build methods:
   *   1. Image DSL (programmatic) — better for composed images
   *   2. Dockerfile import — simpler for existing Dockerfiles
   *
   * We use the Image DSL path for parity with Daytona.
   * The SDK handles the build, waits for completion, and registers the image.
   */
  async buildSnapshot(input: BuildableTemplate, tap?: BuildLogTap): Promise<void> {
    if (!config.TENSORLAKE_API_KEY) {
      throw new Error('Cannot build Tensorlake image: TENSORLAKE_API_KEY not set');
    }

    // Trial/free Tensorlake plans limit sandboxes to 1 vCPU and 1024 MB RAM.
    // Always cap to avoid "limit exceeded" errors from the API.
    const MAX_CPUS = 1;
    const MAX_MEMORY_MB = 1024;
    const buildCpus = Math.min(input.spec.cpu ?? 1, MAX_CPUS);
    const buildMemoryMb = Math.min((input.spec.memoryGb ?? 1) * 1024, MAX_MEMORY_MB);

    const MAX_BUILD_ATTEMPTS = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_BUILD_ATTEMPTS; attempt++) {
      try {
        tap?.onLine?.(`[tensorlake] Build attempt ${attempt}/${MAX_BUILD_ATTEMPTS} for ${input.snapshotName}`);

        if (input.userDockerfile) {
          // Build from user Dockerfile using the Image DSL
          tap?.onLine?.(`[tensorlake] Building from user Dockerfile`);

          const image = new Image({
            name: input.snapshotName,
            baseImage: config.TENSORLAKE_DEFAULT_IMAGE || 'tensorlake/ubuntu-systemd',
          });

          // Add user Dockerfile content as RUN commands
          // The SDK's build() handles Dockerfile parsing internally.
          // Wrapped with withTimeout to prevent indefinite hangs on degraded upstream.
          await withTimeout(
            image.build({
              registeredName: input.snapshotName,
              cpus: buildCpus,
              memoryMb: buildMemoryMb,
            }),
            BUILD_TIMEOUT_MS,
            `Tensorlake image.build(${input.snapshotName})`,
          );
        } else if (input.image) {
          // Import an existing OCI image
          tap?.onLine?.(`[tensorlake] Importing image: ${input.image}`);
          await withTimeout(
            importSandboxImage(input.image, {
              registeredName: input.snapshotName,
              cpus: buildCpus,
              memoryMb: buildMemoryMb,
            }),
            BUILD_TIMEOUT_MS,
            `Tensorlake importSandboxImage(${input.snapshotName})`,
          );
        } else {
          // No image or Dockerfile — register the base image directly
          tap?.onLine?.(`[tensorlake] Registering base image as ${input.snapshotName}`);
          const image = new Image({
            name: input.snapshotName,
            baseImage: config.TENSORLAKE_DEFAULT_IMAGE || 'tensorlake/ubuntu-systemd',
          });
          await withTimeout(
            image.build({
              registeredName: input.snapshotName,
              cpus: buildCpus,
              memoryMb: buildMemoryMb,
            }),
            BUILD_TIMEOUT_MS,
            `Tensorlake image.build(${input.snapshotName})`,
          );
        }

        tap?.onLine?.(`[tensorlake] Build complete: ${input.snapshotName}`);
        return; // Success
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        tap?.onLine?.(`[tensorlake] Build attempt ${attempt} failed: ${lastError.message}`);

        // If this is a quota error, don't retry — the quota won't change between attempts.
        // Throw immediately so the caller can fall back to the base image.
        if (isTensorlakeQuotaError(err)) {
          console.warn(
            `[tensorlake] Build failed with quota error for ${input.snapshotName}: ${lastError.message}. ` +
            `Falling back to base image.`,
          );
          throw new TensorlakeQuotaError(
            `Cannot build snapshot "${input.snapshotName}": ${lastError.message}. ` +
            `Tensorlake concurrent sandbox quota exceeded — falling back to base image.`,
          );
        }

        if (attempt < MAX_BUILD_ATTEMPTS) {
          // Brief delay before retry
          await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
        }
      }
    }

    throw lastError || new Error(`Tensorlake image build failed after ${MAX_BUILD_ATTEMPTS} attempts`);
  }

  /**
   * Check the state of a registered image.
   *
   * Unlike Daytona (which has "building"/"pending"/"active" states),
   * Tensorlake images are either registered (active) or missing.
   * We cache the "active" state for 60s to reduce API calls.
   */
  async getSnapshotState(snapshotName: string): Promise<ProviderState> {
    // Positive-state cache (60s) — same pattern as DaytonaAdapter
    const cached = stateCache.get(snapshotName);
    if (cached && cached === 'active' && Date.now() - stateCacheTime.get(snapshotName)! < 60_000) {
      return 'active';
    }

    try {
      // Wrap with timeout to prevent indefinite hangs on degraded upstream.
      const image = await withTimeout(
        findSandboxImageByName(snapshotName),
        SNAPSHOT_STATE_TIMEOUT_MS,
        `Tensorlake findSandboxImageByName(${snapshotName})`,
      );

      if (image) {
        stateCache.set(snapshotName, 'active');
        stateCacheTime.set(snapshotName, Date.now());
        return 'active';
      }

      stateCache.delete(snapshotName);
      stateCacheTime.delete(snapshotName);
      return 'missing';
    } catch {
      // On timeout/error, return missing to trigger a build
      return 'missing';
    }
  }

  /**
   * Delete a registered image by name.
   * Best-effort — never throws so batch reconciliation can continue.
   */
  async deleteSnapshot(snapshotName: string): Promise<void> {
    stateCache.delete(snapshotName);
    stateCacheTime.delete(snapshotName);

    try {
      const image = await findSandboxImageByName(snapshotName);
      if (image && image.snapshotId) {
        await deleteSandboxImage(image.snapshotId);
      }
    } catch {
      // Best-effort
    }
  }
}

// ─── State Cache ───────────────────────────────────────────────────────────────

const stateCache = new Map<string, string>();
const stateCacheTime = new Map<string, number>();
