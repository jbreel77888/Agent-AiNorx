export type WallpaperType = 'svg' | 'symbol' | 'aurora' | 'shader' | 'image';

export interface Wallpaper {
  id: "brandmark" | "symbol" | "aurora" | "ascii-tunnel" | "matrix" | "nebula";
  name: string;
  type: WallpaperType;
  /** For 'svg' wallpapers — path to the SVG file */
  svgUrl?: string;
  /** For 'symbol' wallpapers — path to the symbol SVG shown centered at low opacity */
  symbolUrl?: string;
  /** For 'image' wallpapers — path to the light-mode image */
  lightUrl?: string;
  /** For 'image' wallpapers — path to the dark-mode image */
  darkUrl?: string;
  /** Small thumbnail for the picker */
  thumbnailUrl: string;
}

export const DEFAULT_WALLPAPER_ID = 'brandmark';

export const WALLPAPERS: Wallpaper[] = [
  {
    id: 'brandmark',
    name: 'Brandmark',
    type: 'svg',
    svgUrl: '/vaelonx-brandmark-bg.png',
    thumbnailUrl: '/vaelonx-brandmark-bg.png',
  },
  {
    id: 'symbol',
    name: 'Symbol',
    type: 'symbol',
    symbolUrl: '/favicon.png',
    thumbnailUrl: '/favicon.png',
  },
  {
    id: 'aurora',
    name: 'Aurora',
    type: 'aurora',
    svgUrl: '/vaelonx-logomark-white.png',
    thumbnailUrl: '/vaelonx-logomark-white.png',
  },
  {
    id: 'nebula',
    name: 'Pixel Beams',
    type: 'shader',
    svgUrl: '/vaelonx-logomark-white.png',
    thumbnailUrl: '/vaelonx-logomark-white.png',
  },
  {
    id: 'ascii-tunnel',
    name: 'ASCII Tunnel',
    type: 'shader',
    svgUrl: '/vaelonx-logomark-white.png',
    thumbnailUrl: '/vaelonx-logomark-white.png',
  },
  {
    id: 'matrix',
    name: 'Enter the Matrix',
    type: 'shader',
    svgUrl: '/vaelonx-logomark-white.png',
    thumbnailUrl: '/vaelonx-logomark-white.png',
  },
];

export function getWallpaperById(id: string): Wallpaper {
  return WALLPAPERS.find((w) => w.id === id) ?? WALLPAPERS[0];
}
