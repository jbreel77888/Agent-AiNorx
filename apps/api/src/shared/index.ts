/**
 * Shared module — re-exports project-agnostic types and functions
 * that were originally in projects/ but are used by executor/,
 * platform/, sessions/, channels/, etc.
 *
 * This is a transitional barrel: it re-exports from projects/ for now.
 * In Phase 7.1, the actual files will be moved here and projects/ deleted.
 */

// Connectors
export type {
  ConnectorProvider,
  ChannelPlatform,
  ConnectorPolicyAction,
  ConnectorPolicySpec,
  ConnectorSpec,
} from '../projects/connectors';
export {
  RESERVED_SLUG_PROVIDERS,
  SLACK_RESERVED_SLUG,
  RESERVED_CONNECTOR_SLUGS,
  extractConnectors,
  connectorSpecToTomlEntry,
  manifestHashForConnector,
} from '../projects/connectors';

// Manifest / Triggers
export {
  MANIFEST_FILENAME,
  KNOWN_SCHEMA_VERSION,
  parseManifestString,
  readManifest,
  loadManifestForEdit,
  commitManifest,
  type ParsedManifest,
} from '../projects/triggers';

// Secrets
export {
  encryptProjectSecret,
  decryptProjectSecret,
  getProjectSecretValue,
  isValidSecretName,
  writeSharedProjectSecret,
} from '../projects/secrets';

// Policies
export type { ProjectPolicySpec } from '../projects/policies';
export { extractProjectPolicies } from '../projects/policies';

// Git
export type { GitBackedProject } from '../projects/git';
export {
  resolveCommitSha,
  readRepoFile,
  listRepoFiles,
  loadProjectConfig,
} from '../projects/git';
export {
  withProjectGitAuth,
  resolveProjectGitAuth,
  resolveProjectUpstream,
} from '../projects/lib/git';

// Agents
export {
  resolveAgentGrant,
  extractAgents,
  grantFromLoadedAgents,
  loadProjectAgents,
} from '../projects/agents';

// Starter
export {
  buildStarterFiles,
  DEFAULT_STARTER_TEMPLATE_ID,
} from '../projects/starter';

// Session env
export {
  buildSpareSandboxEnvVars,
  buildSessionSandboxEnvVars,
  createProjectSession,
} from '../projects/lib/sessions';

// Sandbox env sync
export {
  syncSandboxEnvForPrompt,
  propagateProjectSecretsToActiveSandboxes,
  isReservedSandboxEnvName,
  sanitizeSandboxEnv,
} from '../projects/lib/sandbox-env-sync';

// Access
export {
  loadProjectForUser,
  isUuid,
} from '../projects/lib/access';

// Sandbox reaper
export {
  reconcileSandboxStoppedByExternalId,
  reconcileSandboxRemovedByExternalId,
  reconcileStuckActiveSessions,
} from '../projects/sandbox-reaper';

// Session lifecycle
export {
  createSession,
  startSession,
  continueSession,
  drainSessionLifecycleQueue,
  deleteSession,
  restartSession,
  resolveProjectAutomationActor,
  sessionBackpressureState,
  triggerBackpressureLimit,
} from '../projects/session-lifecycle';
export type {
  ContinueSessionCommand,
  CreateSessionCommand,
  QueuePolicy,
  SessionDeliveryOutcome,
  SessionInvocationSource,
  SessionLifecyclePostCreateAction,
  SessionLifecycleResult,
  SessionLifecycleStatus,
  StartSessionCommand,
} from '../projects/session-lifecycle';

// Opencode mapping
export { ensureOpencodeSessionPin } from '../projects/opencode-mapping';
export { buildSessionRuntimeEnv } from '../projects/lib/session-runtime-env';
export type { SessionRuntimeEnvInput } from '../projects/lib/session-runtime-env';

// Additional exports used by dynamic imports
export { resolveProjectGitAuth, resolveProjectUpstream } from '../projects/lib/git';
export { proxyGitUrl } from '../projects/lib/sessions';
export { sandboxOpencodeEndpoint } from '../projects/opencode-mapping';
