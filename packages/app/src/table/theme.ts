// Placeholder styling: flat colours, no artwork.

import { COUNTRIES } from '@atlas/engine';

export const colors = {
  background: '#f3efe6',
  surface: '#ffffff',
  ink: '#1f2933',
  muted: '#667085',
  line: '#d5cfc2',
  accent: '#1d4ed8',
  coin: '#b7791f',
  action: '#374151',
  /** A perk in force. */
  active: '#fde68a',
};

/** One colour per country, in the order of the card data. All dark enough for white text. */
const PALETTE = [
  '#b45309', '#0f766e', '#1d4ed8', '#7c3aed', '#15803d',
  '#be123c', '#a16207', '#0e7490', '#b91c1c', '#c2410c',
];

const countryColors = new Map<string, string>(
  COUNTRIES.map((country, i) => [country.id, PALETTE[i % PALETTE.length]!]),
);

export function countryColor(country: string): string {
  return countryColors.get(country) ?? colors.muted;
}
