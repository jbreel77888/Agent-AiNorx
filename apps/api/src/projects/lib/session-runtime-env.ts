export interface SessionRuntimeEnvInput {
  projectId?: string;          // optional in simple mode
  sessionId: string;
  repoUrl?: string;            // optional in simple mode
  baseRef?: string;            // optional in simple mode
  agentName: string;
  apiUrl: string;
  /** Frontend base URL (no /v1) the sandbox surfaces as user-facing links. */
  frontendUrl?: string;
  initialPrompt?: string | null;
  opencodeModel?: string | null;
  /** 'simple' = no GitHub, 'project' = legacy git-backed */
  sessionMode?: 'simple' | 'project';
}

export function buildSessionRuntimeEnv(input: SessionRuntimeEnvInput): Record<string, string> {
  const mode = input.sessionMode ?? 'project';

  if (mode === 'simple') {
    // Simple mode: no git, no repo URL, no branch — standalone session
    // NOTE: KORTIX_BOOTSTRAP_OPENCODE_SESSION is intentionally NOT set here.
    // When enabled, the daemon creates a session at boot with body={} which
    // OpenCode defaults to agent='general' (the 'I'm opencode' prompt) and
    // model='north-mini-code-free'. Instead, the API proxy intercepts
    // POST /session and forces agent='vaelorx' + model='deepseek-v4-flash-free'.
    return {
      KORTIX_SESSION_ID: input.sessionId,
      KORTIX_WORKSPACE: '/workspace',
      KORTIX_WORKSPACE_MODE: 'simple',
      KORTIX_SESSION_MODE: 'simple',
      KORTIX_SERVICE_PORT: '8000',
      KORTIX_AGENT_NAME: input.agentName,
      KORTIX_API_URL: input.apiUrl,
      ...(input.projectId ? { KORTIX_PROJECT_ID: input.projectId } : {}),
      ...(input.frontendUrl ? { KORTIX_FRONTEND_URL: input.frontendUrl } : {}),
      ...(input.initialPrompt ? { KORTIX_INITIAL_PROMPT: input.initialPrompt } : {}),
      ...(input.opencodeModel ? { KORTIX_OPENCODE_MODEL: input.opencodeModel } : {}),
    };
  }

  // Project mode (legacy): full git-backed session
  return {
    KORTIX_REPO_URL: input.repoUrl!,
    KORTIX_DEFAULT_BRANCH: input.baseRef!,
    KORTIX_BASE_REF: input.baseRef!,
    KORTIX_BRANCH_NAME: input.sessionId,
    KORTIX_PROJECT_ID: input.projectId!,
    KORTIX_SESSION_ID: input.sessionId,
    KORTIX_SESSION_MODE: 'project',
    KORTIX_SERVICE_PORT: '8000',
    KORTIX_AGENT_NAME: input.agentName,
    KORTIX_API_URL: input.apiUrl,
    ...(input.frontendUrl ? { KORTIX_FRONTEND_URL: input.frontendUrl } : {}),
    KORTIX_BOOTSTRAP_OPENCODE_SESSION: '1',
    ...(input.initialPrompt ? { KORTIX_INITIAL_PROMPT: input.initialPrompt } : {}),
    ...(input.opencodeModel ? { KORTIX_OPENCODE_MODEL: input.opencodeModel } : {}),
  };
}
