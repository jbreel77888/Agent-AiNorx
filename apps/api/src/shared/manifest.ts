/**
 * Manifest IO for `kortix.toml` — the project root manifest file.
 *
 * This is the canonical home for manifest parsing/serialization. Originally
 * lived in `projects/triggers.ts`; moved here in Phase 7.0.2 so the executor,
 * platform, and snapshots layers can consume it without depending on the
 * (deprecated) projects/ module.
 *
 * Trigger-specific parsing (the `[[triggers]]` array shape) still lives in
 * `projects/triggers.ts` for now — it's only used by the trigger CRUD path,
 * which is itself scheduled for deprecation.
 */

import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { readRepoFile, type GitBackedProject } from '../projects/git';
import { commitFileToBranch, invalidateProjectMirror } from '../projects/git';
import { commitFile, getFileSha, parseGitHubRepoUrl, type GitHubAuthContext } from '../projects/github';
import { resolveProjectGitAuth, withProjectGitAuth } from '../projects/lib/git';
import type { ProjectRow } from '../projects/lib/serializers';

/** Where the manifest lives. Same path the rest of the platform looks for. */
export const MANIFEST_FILENAME = 'kortix.toml';

/**
 * Schema version of the manifest. Bumped when we make a breaking change to
 * how the file is parsed. Manifests without `kortix_version` are treated as
 * v1 (backward compat). A higher major than KNOWN_SCHEMA_VERSION → loaders
 * refuse to interpret the file so we don't silently misread future fields.
 */
export const KNOWN_SCHEMA_VERSION = 1;

export interface ParsedManifest {
  schemaVersion: number;
  /** The raw decoded TOML object — callers shouldn't usually need this. */
  raw: Record<string, unknown>;
}

/* ─── Manifest IO ───────────────────────────────────────────────────────── */

/**
 * Read + parse the project's kortix.toml. Returns null if the file is
 * absent (so the caller can treat the repo as "not a Kortix project yet").
 * Throws on parse errors so the caller can surface them up — we don't
 * silently swallow a malformed manifest.
 */
export async function readManifest(
  project: GitBackedProject,
): Promise<ParsedManifest | null> {
  let raw: string;
  try {
    raw = await readRepoFile(project, MANIFEST_FILENAME, project.defaultBranch);
  } catch {
    return null;
  }
  return parseManifestString(raw);
}

/**
 * Synchronous parse from a TOML string. Exported so the CRUD path can
 * round-trip (read existing string, parse, mutate, serialize) without
 * touching the network.
 */
export function parseManifestString(raw: string): ParsedManifest {
  const parsed = parseToml(raw) as Record<string, unknown>;
  const version = typeof parsed.kortix_version === 'number'
    ? parsed.kortix_version
    : typeof parsed.kortix_version === 'string'
      ? Number(parsed.kortix_version)
      : KNOWN_SCHEMA_VERSION;

  if (!Number.isFinite(version) || version < 1) {
    throw new Error('kortix_version must be a positive integer');
  }
  if (Math.floor(version) > KNOWN_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported kortix.toml schema version ${version}. This platform understands up to v${KNOWN_SCHEMA_VERSION}; upgrade the platform or pin the manifest.`,
    );
  }

  return { schemaVersion: Math.floor(version), raw: parsed };
}

/** Serialize a parsed manifest back to TOML text for committing. */
export function serializeManifest(manifest: ParsedManifest): string {
  // Ensure kortix_version is the FIRST key so the resulting TOML is
  // self-describing at a glance. smol-toml emits keys in insertion order.
  const out: Record<string, unknown> = { kortix_version: manifest.schemaVersion };
  for (const [key, value] of Object.entries(manifest.raw)) {
    if (key === 'kortix_version') continue;
    out[key] = value;
  }
  return stringifyToml(out);
}

/* ─── Manifest edit / commit helpers ────────────────────────────────────── */

/**
 * Read the project's manifest. If kortix.toml doesn't exist yet (brand-new
 * repo), synthesize a minimal valid one so the first POST can scaffold it
 * on save.
 *
 * Used by the executor manifest CRUD path (connectors, policies, channels)
 * to round-trip edits through kortix.toml.
 */
export async function loadManifestForEdit(project: ProjectRow): Promise<ParsedManifest> {
  const existing = await readManifest(await withProjectGitAuth(project));
  if (existing) return existing;
  return {
    schemaVersion: KNOWN_SCHEMA_VERSION,
    raw: {
      project: { name: project.name, description: '' },
      runtime: { root: '.opencode' },
      env: { required: [], optional: [] },
    },
  };
}

/**
 * Commit a new revision of kortix.toml to the project's default branch.
 * All manifest CRUD (connectors, triggers, apps, policies) funnels through
 * this — one file, one commit per edit.
 *
 * GitHub repos use the Contents API (App / PAT auth) — the lightweight
 * single-file path that doesn't need a full clone. Any other host (GitLab,
 * generic HTTPS remote) falls back to the git CLI via commitFileToBranch.
 */
export async function commitManifest(
  project: ProjectRow,
  manifest: ParsedManifest,
  message: string,
): Promise<{ ok: true } | { error: string; status: number }> {
  const content = serializeManifest(manifest);
  const branch = project.defaultBranch;

  // GitHub repos: commit through the Contents API (App / PAT auth) — the
  // lightweight single-file path that doesn't need a full clone.
  const repo = parseGitHubRepoUrl(project.repoUrl);
  if (repo) {
    let auth: GitHubAuthContext | undefined;
    try {
      auth = (await resolveProjectGitAuth(project)).auth ?? undefined;
    } catch (err) {
      return { error: `GitHub auth unavailable: ${(err as Error).message || String(err)}`, status: 502 };
    }
    const existingSha = await getFileSha({ owner: repo.owner, repo: repo.repo, path: MANIFEST_FILENAME, branch, auth });
    try {
      await commitFile({
        owner: repo.owner,
        repo: repo.repo,
        path: MANIFEST_FILENAME,
        content,
        message,
        branch,
        existingSha: existingSha ?? undefined,
        auth,
      });
    } catch (err) {
      return { error: `Failed to commit ${MANIFEST_FILENAME}: ${(err as Error).message || String(err)}`, status: 502 };
    }
    invalidateProjectMirror(project.projectId);
    return { ok: true };
  }

  // Any other host (GitLab, generic HTTPS remote): commit via the git CLI.
  let gitProject: ProjectRow & { gitAuthToken: string | null };
  try {
    gitProject = await withProjectGitAuth(project);
  } catch (err) {
    return { error: `Git auth unavailable: ${(err as Error).message || String(err)}`, status: 502 };
  }
  if (!gitProject.gitAuthToken) {
    return { error: 'No git credentials available to write to the project repo', status: 502 };
  }

  try {
    await commitFileToBranch(gitProject, {
      path: MANIFEST_FILENAME,
      content,
      message,
      branch,
      authorName: 'Kortix',
      authorEmail: 'noreply@kortix.ai',
    });
  } catch (err) {
    return { error: `Failed to commit ${MANIFEST_FILENAME}: ${(err as Error).message || String(err)}`, status: 502 };
  }

  invalidateProjectMirror(project.projectId);
  return { ok: true };
}
