/**
 * Palette mirrored from the Zero web mail UI (apps/mail/) so Android renders
 * with the same dark tokens. Surface = #141414, panel = #1A1A1A, offset =
 * #0A0A0A. Single source of truth — prefer these over inline hex literals.
 */

export const palette = {
  /** Page background (web: --darkBackground / .bg-darkBackground). */
  surface: '#141414',
  /** Card / panel surfaces (web: .bg-panelDark). */
  surfaceElevated: '#1A1A1A',
  /** Pressed / row-hover offset (web: .bg-offsetDark). */
  surfaceMuted: '#0A0A0A',
  /** Active drawer row + subtle hover (web: .bg-[#202020]). */
  surfaceHover: '#202020',

  divider: '#1F1F1F',
  border: '#202020',
  borderStrong: '#2A2A2A',

  textPrimary: '#FFFFFF',
  textSecondary: '#E5E5E5',
  /** Subject + body muted lines (web: .text-[#8C8C8C]). */
  textMuted: '#8C8C8C',
  /** Search placeholder + faint metadata (web: .dark:fill-[#6F6F6F]). */
  textFaint: '#6F6F6F',
  /** Sidebar icon color (web: .text-iconDark). */
  iconDark: '#898989',

  /** Primary blue used for Compose, unread dot, active highlights (web: #006FFE). */
  accent: '#006FFE',
  /** Lighter accent for soft buttons + status text. */
  accentSoft: '#3D8CFF',
  /** Tinted active background (web: bg-primary/5 ≈ rgba(0,111,254,0.08)). */
  accentBg: 'rgba(0, 111, 254, 0.10)',

  /** Unread indicator dot (web: bg-[#006FFE]). */
  unread: '#006FFE',
  /** Star color (web's yellow-400). */
  star: '#FACC15',
  /** Important / pending (web: #F59E0D). */
  important: '#F59E0D',
  /** Personal category (web: #39ae4a). */
  personal: '#39AE4A',
  /** Updates category (web: #8B5CF6). */
  updates: '#8B5CF6',
  /** Promotions + danger / trash (web: #F43F5E). */
  danger: '#F43F5E',
  success: '#39AE4A',
};

/** Category-tinted progress bar colors keyed by Gmail label. */
export const categoryProgress: Record<string, string> = {
  important: palette.important,
  personal: palette.personal,
  updates: palette.updates,
  promotions: palette.danger,
  unread: palette.danger,
  inbox: palette.accent,
  default: palette.accent,
};

/** Deterministic avatar colors (Gmail-style). Hash an email/name to pick one. */
export const avatarPalette = [
  '#5B8DEF',
  '#EC6F8A',
  '#46B58D',
  '#D59A3E',
  '#9B6AD6',
  '#3AAED8',
  '#E07857',
  '#7A8A99',
];

export function avatarColorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(h) % avatarPalette.length;
  return avatarPalette[idx]!;
}
