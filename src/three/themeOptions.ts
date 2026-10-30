/**
 * Scene themes. Kept free of three.js imports so the app shell can list them
 * without downloading the 3D code.
 */
export type ThemeId = 'classroom' | 'forest';

export const THEMES: ReadonlyArray<{ readonly id: ThemeId; readonly label: string }> = [
  { id: 'classroom', label: 'Classroom' },
  { id: 'forest', label: 'Forest' },
];

export const DEFAULT_THEME: ThemeId = 'classroom';
