/**
 * Project-level `[[policies]]` + `[policy]` parsing for kortix.toml.
 *
 * The canonical home for this code is now shared/policies.ts (Phase 7.0.4).
 * This file is kept as a thin re-export so existing internal consumers
 * (`./policies` imports) keep working until they're migrated. New code
 * should import from `../shared/policies` directly.
 *
 * Project policies span EVERY connector in the project — patterns are
 * fully-qualified (`<connector-slug>.<path>` or globs over that), and they're
 * evaluated before any connector-scoped rule (docs/specs/executor.md §8).
 * `[policy].default_mode` controls the fallback when no rule matches:
 *   - `risk` — read = always_run, write/destructive = require_approval
 *   - `allow_all` — every tool runs (legacy default for back-compat)
 */
export type {
  DefaultMode,
  ProjectPolicySpec,
  ProjectPolicySettings,
  LoadedProjectPolicies,
} from '../shared/policies';
export {
  extractProjectPolicies,
  projectPoliciesToTomlEntries,
  projectPolicySettingsToToml,
} from '../shared/policies';
