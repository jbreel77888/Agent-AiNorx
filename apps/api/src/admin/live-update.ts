/**
 * Live Update Mechanism — pushes agent/skill updates to active sandboxes.
 *
 * When the admin publishes an update (POST /v1/admin/platform/publish),
 * this module:
 *   1. Reads the latest agents + skills from the DB
 *   2. Finds all active sandboxes
 *   3. Writes the updated files to each sandbox via the Tensorlake SDK
 *   4. Triggers opencode to rescan (USR1 signal or /kortix/refresh)
 *
 * This ensures that admin changes take effect immediately on active sessions,
 * not just on new sessions.
 */
import { db } from '../shared/db';
import {
  platformAgents,
  platformSkills,
  platformSettings,
  sessionSandboxes,
} from '@kortix/db';
import { eq, and } from 'drizzle-orm';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PublishResult {
  totalSandboxes: number;
  updated: number;
  failed: number;
  errors: string[];
  version: string;
}

interface AgentFile {
  name: string;
  content: string;
}

interface SkillFile {
  slug: string;
  content: string;
}

// ─── File Generation ──────────────────────────────────────────────────────────

/**
 * Build the .md file content for an agent from the DB record.
 * Format: YAML frontmatter + system prompt body.
 */
function buildAgentFile(agent: typeof platformAgents.$inferSelect): string {
  const frontmatter = [
    '---',
    `description: ${agent.description || `${agent.name} agent`}`,
    `mode: ${agent.mode || 'primary'}`,
    ...(agent.isDefault ? [''] : []), // model comes from config, not agent file
    'permission:',
    '  "*": "allow"',
    '---',
    '',
  ].join('\n');

  return frontmatter + agent.systemPrompt + '\n';
}

/**
 * Build the SKILL.md content for a skill from the DB record.
 */
function buildSkillFile(skill: typeof platformSkills.$inferSelect): string {
  return skill.skillContent;
}

/**
 * Get all active agents and skills from the DB, formatted as files.
 */
async function getLatestScaffoldFiles(): Promise<{
  agents: AgentFile[];
  skills: SkillFile[];
}> {
  const [activeAgents, activeSkills] = await Promise.all([
    db.select().from(platformAgents).where(eq(platformAgents.isActive, true)),
    db.select().from(platformSkills).where(eq(platformSkills.isActive, true)),
  ]);

  return {
    agents: activeAgents.map((a) => ({
      name: a.name,
      content: buildAgentFile(a),
    })),
    skills: activeSkills.map((s) => ({
      slug: s.slug,
      content: buildSkillFile(s),
    })),
  };
}

// ─── Active Sandbox Discovery ─────────────────────────────────────────────────

async function getActiveSandboxes(): Promise<Array<{
  externalId: string;
  sessionId: string;
}>> {
  const rows = await db
    .select({
      externalId: sessionSandboxes.externalId,
      sessionId: sessionSandboxes.sessionId,
    })
    .from(sessionSandboxes)
    .where(
      and(
        eq(sessionSandboxes.provider, 'tensorlake'),
        eq(sessionSandboxes.status, 'active'),
      ),
    );

  return rows.filter((r: any) => r.externalId);
}

// ─── Live Update (push to active sandboxes) ───────────────────────────────────

/**
 * Push updated agent/skill files to a single sandbox.
 * Uses the Tensorlake SDK to write files and trigger opencode rescan.
 */
async function updateSandboxFiles(
  externalId: string,
  agents: AgentFile[],
  skills: SkillFile[],
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { Sandbox } = await import('../shared/tensorlake');
    const sandbox = await Sandbox.connect({ sandboxId: externalId });

    // 1. Write agent files
    for (const agent of agents) {
      const path = `/workspace/.vaelorx/opencode/agents/${agent.name}.md`;
      await sandbox.writeFile(path, Buffer.from(agent.content, 'utf-8'));
    }

    // 2. Write skill files
    for (const skill of skills) {
      const path = `/workspace/.vaelorx/opencode/skills/${skill.slug}/SKILL.md`;
      try {
        // Check if the skill directory exists
        await sandbox.run('bash', {
          args: ['-c', `mkdir -p /workspace/.vaelorx/opencode/skills/${skill.slug}`],
          timeout: 5,
        });
      } catch { /* ignore */ }
      await sandbox.writeFile(path, Buffer.from(skill.content, 'utf-8'));
    }

    // 3. Trigger opencode rescan via /kortix/refresh
    try {
      const { encodeKortixUserContext } = await import('../shared/kortix-user-context');
      const { resolveServiceKey } = await import('../shared/service-key');
      const serviceKey = await resolveServiceKey(externalId);
      if (serviceKey) {
        const ctx = {
          userId: 'system',
          sandboxId: externalId,
          sandboxRole: 'owner' as const,
          scopes: ['*'],
        };
        const header = encodeKortixUserContext(ctx as any, serviceKey);
        await sandbox.run('bash', {
          args: ['-c', `curl -s -X POST -H "X-Kortix-User-Context: ${header}" http://127.0.0.1:8000/kortix/refresh`],
          timeout: 10,
        });
      }
    } catch {
      // /kortix/refresh might not be available — try USR1 signal as fallback
      try {
        await sandbox.run('bash', {
          args: ['-c', 'kill -USR1 $(pgrep -f opencode) 2>/dev/null || true'],
          timeout: 5,
        });
      } catch { /* best-effort */ }
    }

    // 4. Write scaffold version stamp
    const version = Date.now().toString();
    await sandbox.writeFile(
      '/workspace/.vaelorx/scaffold-version',
      Buffer.from(version, 'utf-8'),
    );

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Main Publish Function ────────────────────────────────────────────────────

/**
 * Publish scaffold updates to all active sandboxes + bump the version.
 *
 * Called by: POST /v1/admin/platform/publish
 *
 * Flow:
 *   1. Read latest agents + skills from DB
 *   2. Find all active Tensorlake sandboxes
 *   3. Write updated files to each sandbox
 *   4. Trigger opencode rescan
 *   5. Bump scaffold_version in platform_settings
 */
export async function publishScaffoldUpdate(): Promise<PublishResult> {
  const version = Date.now().toString();
  const errors: string[] = [];

  // 1. Get latest scaffold files from DB
  const { agents, skills } = await getLatestScaffoldFiles();

  if (agents.length === 0 && skills.length === 0) {
    return {
      totalSandboxes: 0,
      updated: 0,
      failed: 0,
      errors: ['No active agents or skills found in DB'],
      version,
    };
  }

  // 2. Find all active sandboxes
  const activeSandboxes = await getActiveSandboxes();

  if (activeSandboxes.length === 0) {
    // No active sandboxes — just bump the version for new sessions
    await db.update(platformSettings)
      .set({ value: JSON.stringify(version), updatedAt: new Date() })
      .where(eq(platformSettings.key, 'scaffold_version'));

    return {
      totalSandboxes: 0,
      updated: 0,
      failed: 0,
      errors: [],
      version,
    };
  }

  // 3. Push updates to each sandbox (with concurrency limit)
  const CONCURRENCY = 5;
  let updated = 0;
  let failed = 0;

  for (let i = 0; i < activeSandboxes.length; i += CONCURRENCY) {
    const batch = activeSandboxes.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (sb) => {
        const result = await updateSandboxFiles(sb.externalId, agents, skills);
        if (!result.ok) {
          throw new Error(`Sandbox ${sb.externalId}: ${result.error}`);
        }
        return sb.externalId;
      }),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        updated++;
        console.log(`[live-update] Updated sandbox: ${result.value}`);
      } else {
        failed++;
        errors.push(result.reason?.message || 'Unknown error');
        console.warn(`[live-update] Failed: ${result.reason?.message}`);
      }
    }
  }

  // 4. Bump scaffold_version in DB
  await db.update(platformSettings)
    .set({ value: JSON.stringify(version), updatedAt: new Date() })
    .where(eq(platformSettings.key, 'scaffold_version'));

  console.log(`[live-update] Publish complete: ${updated}/${activeSandboxes.length} sandboxes updated (version ${version})`);

  return {
    totalSandboxes: activeSandboxes.length,
    updated,
    failed,
    errors,
    version,
  };
}

/**
 * Get the current scaffold version from DB.
 * Used by session-sandbox.ts to inject KORTIX_SCAFFOLD_VERSION env var.
 */
export async function getScaffoldVersion(): Promise<string> {
  try {
    const [row] = await db
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(eq(platformSettings.key, 'scaffold_version'))
      .limit(1);

    if (!row?.value) return '0';

    // Value might be JSON-quoted
    const val = typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
    return val.replace(/^"|"$/g, '');
  } catch {
    return '0';
  }
}
