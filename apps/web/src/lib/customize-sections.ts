/**
 * Customize section identifiers + helpers — STUB (Phase 7.2.8).
 *
 * The original module managed the section enum for the project-scoped
 * Customize overlay. Session-only mode has no Customize overlay, so this
 * is now dead code.
 *
 * The type + parser are kept so legacy callers (command-palette) keep
 * compiling.
 */

export type CustomizeSection =
  | 'changes'
  | 'files'
  | 'skills'
  | 'agents'
  | 'commands'
  | 'marketplace'
  | 'secrets'
  | 'connectors'
  | 'computers'
  | 'members'
  | 'schedules'
  | 'webhooks'
  | 'channels'
  | 'sandbox'
  | 'dev'
  | 'settings';

export const DEFAULT_CUSTOMIZE_SECTION: CustomizeSection = 'files';

export const CUSTOMIZE_SECTIONS: readonly CustomizeSection[] = [
  'changes',
  'files',
  'skills',
  'agents',
  'commands',
  'marketplace',
  'secrets',
  'connectors',
  'computers',
  'members',
  'schedules',
  'webhooks',
  'channels',
  'sandbox',
  'dev',
  'settings',
];

/** Parse a section slug from a URL path segment. Returns null if invalid. */
export function parseCustomizeSection(value: string | null | undefined): CustomizeSection | null {
  if (!value) return null;
  return CUSTOMIZE_SECTIONS.includes(value as CustomizeSection)
    ? (value as CustomizeSection)
    : null;
}
