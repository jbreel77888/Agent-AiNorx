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

// Manifest / Triggers — moved to shared/manifest.ts in Phase 7.0.2
export {
  MANIFEST_FILENAME,
  KNOWN_SCHEMA_VERSION,
  parseManifestString,
  readManifest,
  loadManifestForEdit,
  commitManifest,
  serializeManifest,
  type ParsedManifest,
} from './manifest';

// Secrets
export {
  encryptProjectSecret,
  decryptProjectSecret,
  getProjectSecretValue,
  isValidSecretName,
  writeSharedProjectSecret,
  listProjectSecrets,
  listProjectSecretsForUser,
  projectSecretsRevision,
  listProjectSecretsSnapshot,
  listProjectSecretsSnapshotForUser,
} from '../projects/secrets';

// Policies — moved to shared/policies.ts in Phase 7.0.4
export type {
  ProjectPolicySpec,
  ProjectPolicySettings,
  LoadedProjectPolicies,
  DefaultMode,
} from './policies';
export {
  extractProjectPolicies,
  projectPoliciesToTomlEntries,
  projectPolicySettingsToToml,
} from './policies';

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
} from '../projects/lib/sandbox-env-sync';
export {
  isReservedSandboxEnvName,
  sanitizeSandboxEnv,
} from '../projects/lib/sandbox-env-names';

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
export { ensureOpencodeSessionPin, sandboxOpencodeEndpoint } from '../projects/opencode-mapping';
export { buildSessionRuntimeEnv } from '../projects/lib/session-runtime-env';
export type { SessionRuntimeEnvInput } from '../projects/lib/session-runtime-env';

// Additional exports used by dynamic imports
export { proxyGitUrl } from '../projects/lib/sessions';
