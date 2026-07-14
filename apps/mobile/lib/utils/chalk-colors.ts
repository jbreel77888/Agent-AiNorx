/**
 * Local copy of @kortix/shared's chalkColors — inlined to avoid the monorepo
 * workspace dependency on @kortix/shared during EAS Build (which doesn't
 * support TS-source workspace packages without a build step).
 *
 * Kept identical to packages/shared/src/utils/chalk-colors.ts so behavior
 * matches the web app.
 */

export interface ChalkColors {
  background: string;
  foreground: string;
  border: string;
}

// FNV-1a-ish string hash → stable 32-bit int. Same label always hashes the same,
// so an entity keeps its color across renders/sessions.
function hashLabel(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function chalkColors(label: string): ChalkColors {
  const hash = hashLabel(label || "?");
  const hue = hash % 360;
  const sat = 35 + (hash % 12);
  const lift = (hash >> 3) % 10;
  return {
    background: `hsl(${hue} ${sat}% ${77 + lift}%)`,
    foreground: `hsl(${hue} ${Math.min(sat + 10, 82)}% 27%)`,
    border: `hsl(${hue} ${sat}% ${65 + lift}%)`,
  };
}
