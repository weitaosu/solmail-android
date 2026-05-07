/**
 * Gmail-dark inspired palette. Single source of truth for screen colors.
 * Hex literals were inlined across screens before — prefer these tokens going forward.
 */

export const palette = {
  surface: '#0b0d11',
  surfaceElevated: '#151923',
  surfaceMuted: '#12151c',
  surfaceHover: '#1d222d',

  divider: '#1a1f2a',
  border: '#252b38',
  borderStrong: '#2d3444',

  textPrimary: '#f1f3f7',
  textSecondary: '#cfd3db',
  textMuted: '#9ca4b4',
  textFaint: '#727d90',

  accent: '#1877f2',
  accentSoft: '#6b9ef5',
  accentBg: '#0e2a4d',

  unread: '#1877f2',
  star: '#f5c518',
  danger: '#ff9b9b',
  success: '#5fd28b',
};

/** Deterministic avatar colors (Gmail-style). Hash an email/name to pick one. */
export const avatarPalette = [
  '#5b8def',
  '#ec6f8a',
  '#46b58d',
  '#d59a3e',
  '#9b6ad6',
  '#3aaed8',
  '#e07857',
  '#7a8a99',
];

export function avatarColorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(h) % avatarPalette.length;
  return avatarPalette[idx]!;
}
