/**
 * Proxy helpers — shared utilities for the proxy and boot paths.
 *
 * fetchCurrentDefaultModel() fetches the admin's current default model from
 * the gateway's /models endpoint (which returns is_default:true on the
 * admin's choice). It's used by:
 *   - proxy.ts (to rewrite the model field in prompt requests so OpenCode
 *     displays the correct model in its UI)
 *   - main.ts (at boot time, BEFORE writing vaelorx.toml / opencode.jsonc /
 *     vaelorx.md, so the config files have the current default — not a
 *     stale KORTIX_DEFAULT_MODEL env var from boot time)
 *   - opencode.ts (in buildOpencodeConfigContent, for the same reason)
 *
 * The gateway is the SOURCE OF TRUTH for the default model. The daemon's
 * local KORTIX_DEFAULT_MODEL env var is set at sandbox boot time and may be
 * stale if the admin changed the default after the sandbox was created.
 *
 * fetchInstalledSkills() fetches account-scoped marketplace skills from
 * /v1/accounts/me/registry/installed. Called by main.ts at boot, after
 * materializeScaffoldSeed, to write user-installed skills into
 * .vaelorx/opencode/skills/ in the sandbox.
 */

let cachedDefaultModel: { model: string | null; fetchedAt: number } = {
  model: null,
  fetchedAt: 0,
};
const DEFAULT_MODEL_CACHE_MS = 30_000; // 30s

export async function fetchCurrentDefaultModel(): Promise<string | null> {
  const now = Date.now();
  if (
    cachedDefaultModel.model &&
    now - cachedDefaultModel.fetchedAt < DEFAULT_MODEL_CACHE_MS
  ) {
    return cachedDefaultModel.model;
  }
  const llmBaseUrl = process.env.KORTIX_LLM_BASE_URL?.trim();
  const llmApiKey = process.env.KORTIX_LLM_API_KEY?.trim();
  if (!llmBaseUrl || !llmApiKey) {
    // No gateway configured — fall back to env var
    return process.env.KORTIX_DEFAULT_MODEL?.trim() || null;
  }
  try {
    const url = `${llmBaseUrl.replace(/\/+$/, '')}/models`;
    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${llmApiKey}`,
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const body = (await res.json()) as {
      data?: Array<{ id?: string; is_default?: boolean }>;
    };
    if (Array.isArray(body.data)) {
      // Find the model with is_default=true
      const defaultEntry = body.data.find((m) => m?.is_default === true);
      if (defaultEntry?.id) {
        cachedDefaultModel = { model: defaultEntry.id, fetchedAt: now };
        return defaultEntry.id;
      }
    }
    // No is_default flag in the response — fall back to env var
    const envModel = process.env.KORTIX_DEFAULT_MODEL?.trim() || null;
    cachedDefaultModel = { model: envModel, fetchedAt: now };
    return envModel;
  } catch (err) {
    // Fall back to env var (may be stale, but better than nothing)
    const envModel = process.env.KORTIX_DEFAULT_MODEL?.trim() || null;
    cachedDefaultModel = { model: envModel, fetchedAt: now };
    return envModel;
  }
}

// ─── Installed marketplace skills (account-scoped) ──────────────────────────

export interface InstalledSkill {
  name: string;
  type: string;
  content: string;
  version: number;
}

/**
 * Fetch account-scoped marketplace skills from the API.
 *
 * Uses the sandbox token (KORTIX_TOKEN) to authenticate — the API resolves
 * the account from the token via /v1/accounts/me/registry/installed.
 *
 * Returns an empty array on any error (best-effort — the sandbox still boots
 * with the baked-in scaffold skills even if the API is unreachable).
 */
export async function fetchInstalledSkills(): Promise<InstalledSkill[]> {
  const apiUrl = process.env.KORTIX_API_URL?.trim();
  const token = process.env.KORTIX_TOKEN?.trim() || process.env.KORTIX_SANDBOX_TOKEN?.trim();
  if (!apiUrl || !token) {
    return [];
  }
  try {
    const url = `${apiUrl.replace(/\/+$/, '')}/v1/accounts/me/registry/installed`;
    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const body = (await res.json()) as { items?: InstalledSkill[] };
    return Array.isArray(body.items) ? body.items : [];
  } catch (err) {
    console.warn(
      '[proxy-helpers] fetchInstalledSkills failed (continuing with baked-in skills only):',
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

