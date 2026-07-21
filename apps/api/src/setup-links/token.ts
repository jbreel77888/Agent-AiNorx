/**
 * Setup-link tokens — the opaque, short-lived handle behind every agent-minted
 * "fill this in" link (a secret, or a Pipedream Quick Connect).
 *
 * Two token formats coexist:
 *
 *   • `ksl_<base64url(projectId "." envelope)>` — LEGACY project-scoped token.
 *     Uses encryptProjectSecret(projectId, ...) with HKDF info='kortix-project-secret-v1'.
 *     Still supported for backward compatibility (existing tokens expire within 24h).
 *
 *   • `ksa_<base64url(accountId "." envelope)>` — NEW account-scoped token.
 *     Uses encryptAccountSecret(accountId, ...) with HKDF info='kortix-account-secret-v1'.
 *     Used in session-only mode where there's no project.
 *
 * Both are STATELESS — there is no `setup_requests` table. The token IS the
 * request: an AEAD envelope encrypted with the scope's key, so a token from
 * one scope can't be decrypted by another, and a tampered token simply fails
 * to decrypt.
 *
 * VALUE-ONLY by construction: the field NAMES are fixed at mint time, so a
 * leaked token can only SET the named keys before it expires — it can never
 * read an existing secret or target another key.
 */
import { randomBytes } from 'node:crypto';
import {
  decryptProjectSecret,
  encryptProjectSecret,
  decryptAccountSecret,
  encryptAccountSecret,
} from '../shared';

const TOKEN_PREFIX_LEGACY = 'ksl_'; // project-scoped
const TOKEN_PREFIX_ACCOUNT = 'ksa_'; // account-scoped
const DEFAULT_TTL_MINUTES = 30;
const MIN_TTL_MINUTES = 1;
const MAX_TTL_MINUTES = 24 * 60;

export interface SecretFieldSpec {
  name: string;
  label?: string;
  description?: string;
}

export type SecretScope = 'runtime' | 'connector';

interface BasePayload {
  exp: number;
  nonce: string;
  /** Scope ID sealed inside the envelope; cross-checked against the outer id.
   *  For ksl_ tokens this is projectId; for ksa_ tokens this is accountId. */
  pid: string;
  /** The member who minted the link (the session owner). Recorded as created_by. */
  uid: string | null;
}

export type SetupLinkPayload =
  | (BasePayload & { kind: 'secret'; fields: SecretFieldSpec[]; scope: SecretScope })
  | (BasePayload & { kind: 'connector'; slug: string; app: string | null; mode: 'shared' | 'per_user' });

export function clampTtlMinutes(minutes?: number | null): number {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return DEFAULT_TTL_MINUTES;
  return Math.min(MAX_TTL_MINUTES, Math.max(MIN_TTL_MINUTES, Math.floor(minutes)));
}

type SecretSpec = { kind: 'secret'; fields: SecretFieldSpec[]; scope?: SecretScope; uid?: string | null };
type ConnectorSpec = {
  kind: 'connector';
  slug: string;
  app?: string | null;
  mode?: 'shared' | 'per_user';
  uid?: string | null;
};

// ─── Legacy project-scoped mint (backward compat) ───────────────────────────

export function mintSetupLink(
  projectId: string,
  spec: SecretSpec | ConnectorSpec,
  opts?: { expiresInMinutes?: number | null },
): { token: string; expiresAt: number } {
  const exp = Date.now() + clampTtlMinutes(opts?.expiresInMinutes) * 60_000;
  const nonce = randomBytes(9).toString('base64url');
  const base: BasePayload = { exp, nonce, pid: projectId, uid: spec.uid ?? null };

  const payload: SetupLinkPayload =
    spec.kind === 'secret'
      ? { ...base, kind: 'secret', fields: spec.fields, scope: spec.scope ?? 'runtime' }
      : { ...base, kind: 'connector', slug: spec.slug, app: spec.app ?? null, mode: spec.mode ?? 'shared' };

  const envelope = encryptProjectSecret(projectId, JSON.stringify(payload));
  const token = TOKEN_PREFIX_LEGACY + Buffer.from(`${projectId}.${envelope}`, 'utf8').toString('base64url');
  return { token, expiresAt: exp };
}

// ─── Account-scoped mint (session-only mode) ────────────────────────────────

export function mintAccountSetupLink(
  accountId: string,
  spec: SecretSpec | ConnectorSpec,
  opts?: { expiresInMinutes?: number | null },
): { token: string; expiresAt: number } {
  const exp = Date.now() + clampTtlMinutes(opts?.expiresInMinutes) * 60_000;
  const nonce = randomBytes(9).toString('base64url');
  const base: BasePayload = { exp, nonce, pid: accountId, uid: spec.uid ?? null };

  const payload: SetupLinkPayload =
    spec.kind === 'secret'
      ? { ...base, kind: 'secret', fields: spec.fields, scope: spec.scope ?? 'runtime' }
      : { ...base, kind: 'connector', slug: spec.slug, app: spec.app ?? null, mode: spec.mode ?? 'shared' };

  const envelope = encryptAccountSecret(accountId, JSON.stringify(payload));
  const token = TOKEN_PREFIX_ACCOUNT + Buffer.from(`${accountId}.${envelope}`, 'utf8').toString('base64url');
  return { token, expiresAt: exp };
}

// ─── Unified resolve (handles both ksl_ and ksa_ prefixes) ──────────────────

export type ResolvedSetupLink =
  | { ok: true; scope: 'project' | 'account'; scopeId: string; payload: SetupLinkPayload }
  | { ok: false; status: 404 | 410; error: string };

export function resolveSetupLink(token: string | undefined | null): ResolvedSetupLink {
  if (!token) {
    return { ok: false, status: 404, error: 'Invalid or unknown link' };
  }

  // Determine scope by prefix
  let prefix: string;
  let scope: 'project' | 'account';
  if (token.startsWith(TOKEN_PREFIX_LEGACY)) {
    prefix = TOKEN_PREFIX_LEGACY;
    scope = 'project';
  } else if (token.startsWith(TOKEN_PREFIX_ACCOUNT)) {
    prefix = TOKEN_PREFIX_ACCOUNT;
    scope = 'account';
  } else {
    return { ok: false, status: 404, error: 'Invalid or unknown link' };
  }

  let scopeId: string;
  let envelope: string;
  try {
    // Reject non-canonical base64url spellings before decrypting the envelope.
    const encoded = token.slice(prefix.length);
    const decodedBytes = Buffer.from(encoded, 'base64url');
    if (decodedBytes.toString('base64url') !== encoded) {
      return { ok: false, status: 404, error: 'Invalid or unknown link' };
    }
    const decoded = decodedBytes.toString('utf8');
    const dot = decoded.indexOf('.');
    if (dot <= 0) return { ok: false, status: 404, error: 'Invalid or unknown link' };
    scopeId = decoded.slice(0, dot);
    envelope = decoded.slice(dot + 1);
  } catch {
    return { ok: false, status: 404, error: 'Invalid or unknown link' };
  }

  let payload: SetupLinkPayload;
  try {
    if (scope === 'project') {
      payload = JSON.parse(decryptProjectSecret(scopeId, envelope)) as SetupLinkPayload;
    } else {
      payload = JSON.parse(decryptAccountSecret(scopeId, envelope)) as SetupLinkPayload;
    }
  } catch {
    // Wrong key, tampered ciphertext, or garbage → indistinguishable from "never existed".
    return { ok: false, status: 404, error: 'Invalid or unknown link' };
  }

  if (payload.pid !== scopeId) return { ok: false, status: 404, error: 'Invalid or unknown link' };
  if (typeof payload.exp !== 'number' || Date.now() > payload.exp) {
    return { ok: false, status: 410, error: 'This link has expired — ask the agent for a fresh one' };
  }
  return { ok: true, scope, scopeId, payload };
}

// Backward compat: projectId field for legacy consumers
export function resolveSetupLinkLegacy(token: string | undefined | null): 
  | { ok: true; projectId: string; payload: SetupLinkPayload }
  | { ok: false; status: 404 | 410; error: string } 
{
  const result = resolveSetupLink(token);
  if (!result.ok) return result;
  if (result.scope !== 'project') {
    return { ok: false, status: 404, error: 'This link is account-scoped, not project-scoped' };
  }
  return { ok: true, projectId: result.scopeId, payload: result.payload };
}
