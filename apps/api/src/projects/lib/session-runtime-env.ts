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
  /** Scaffold version — used by the daemon to check if it needs to fetch
   *  updated agent/skill files from the API on boot. */
  scaffoldVersion?: string;
}

export function buildSessionRuntimeEnv(input: SessionRuntimeEnvInput): Record<string, string> {
  const mode = input.sessionMode ?? 'project';

  if (mode === 'simple') {
    // Simple mode: no git, no repo URL, no branch — standalone session
    return {
      KORTIX_SESSION_ID: input.sessionId,
      KORTIX_WORKSPACE: '/workspace',
      KORTIX_WORKSPACE_MODE: 'simple',
      KORTIX_SESSION_MODE: 'simple',
      KORTIX_SERVICE_PORT: '8000',
      KORTIX_AGENT_NAME: input.agentName,
      KORTIX_API_URL: input.apiUrl,
      KORTIX_BOOTSTRAP_OPENCODE_SESSION: '1',
      ...(input.projectId ? { KORTIX_PROJECT_ID: input.projectId } : {}),
      ...(input.frontendUrl ? { KORTIX_FRONTEND_URL: input.frontendUrl } : {}),
      ...(input.initialPrompt ? { KORTIX_INITIAL_PROMPT: input.initialPrompt } : {}),
      ...(input.opencodeModel ? { KORTIX_OPENCODE_MODEL: input.opencodeModel } : {}),
      ...(input.scaffoldVersion ? { KORTIX_SCAFFOLD_VERSION: input.scaffoldVersion } : {}),
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
