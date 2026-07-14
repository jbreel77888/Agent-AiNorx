function parseEnvBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value == null) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

export const featureFlags = {
  /**
   * When true, hide any mobile app download / install advertising across the web app.
   *
   * Default: false (shown)
   * Set NEXT_PUBLIC_DISABLE_MOBILE_ADVERTISING=true to hide.
   */
  disableMobileAdvertising: parseEnvBoolean(
    process.env.NEXT_PUBLIC_DISABLE_MOBILE_ADVERTISING,
    false,
  ),
  /** When true, show the dino game easter egg during provisioning. Default: false. */
  enableDinoGame: parseEnvBoolean(
    process.env.NEXT_PUBLIC_ENABLE_DINO_GAME,
    false,
  ),
  /**
   * Multi-project paradigm — REMOVED in Phase 7.2.6.
   *
   * The product now ships in session-only mode. This flag is kept as a
   * constant `false` so existing call sites keep compiling; the dead
   * branches will be removed in a follow-up cleanup.
   */
  enableProjects: false,
  /**
   * Simple session mode — always true in session-only mode (Phase 7.2.6).
   *
   * The app now exclusively uses /v1/sessions API + /sessions routes.
   * The flag is kept as a constant `true` so existing call sites keep
   * compiling; the dead project-mode branches will be removed later.
   */
  isSimpleMode: true,
} as const;

/** Convenience function — always true in session-only mode. */
export function isSimpleMode(): boolean {
  return true;
}

// Debug: uncomment to inspect feature flags during development
// if (process.env.NODE_ENV !== 'production') {
//   console.log('[featureFlags]', featureFlags);
// }
