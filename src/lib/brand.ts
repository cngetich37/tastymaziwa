/**
 * The TastyMaziwa mark: a milk churn (the aluminium can a milkman carries)
 * with a wave of milk across it and a butter-yellow lid knob, on a dairy-blue
 * tile. Shared by the Logo component and scripts/make-icons.mts, so the app
 * and the home-screen icon never drift apart.
 *
 * Hex values for places that can't read CSS variables (manifest, icons,
 * emails, browser theme colour). Keep them in step with globals.css.
 */
export const BRAND = {
  /** Dairy blue, --brand / light --primary: hsl(213 82% 37%). */
  blue: '#1157ac',
  /** Fresh-milk white, --brand-milk. */
  milk: '#fffefd',
  /** Butter, --butter: hsl(41 92% 54%). */
  butter: '#f6b11e',
  /** Cream canvas, light --background: hsl(42 40% 97%). */
  cream: '#faf9f4',
  /** Midnight, dark --background: hsl(220 40% 7%). */
  midnight: '#0b0f19',
  /** Body text, light --foreground. */
  ink: '#131f35',
} as const;

export type LogoFill = 'milk' | 'blue' | 'butter';

/** The churn on a 32×32 grid; the tile behind it is the full square. */
export const LOGO_SHAPES: ReadonlyArray<{ d: string; fill: LogoFill; stroke?: boolean }> = [
  // Side handles, looping out from the shoulders.
  { d: 'M10.4 13.6c-2.4-.9-4.2.2-4.2 2.1 0 1.3.8 2.2 2.2 2.4', fill: 'milk', stroke: true },
  { d: 'M21.6 13.6c2.4-.9 4.2.2 4.2 2.1 0 1.3-.8 2.2-2.2 2.4', fill: 'milk', stroke: true },
  // Butter knob on a domed mushroom lid.
  { d: 'M14.6 4.9a1.4 1.4 0 0 1 2.8 0v.8h-2.8z', fill: 'butter' },
  { d: 'M9.6 9.4c0-2.3 2.9-3.9 6.4-3.9s6.4 1.6 6.4 3.9z', fill: 'milk' },
  { d: 'M9.6 9.9h12.8v1.6H9.6z', fill: 'milk' },
  // Neck, sloping shoulders and the can.
  {
    d: 'M12 11.2h8v1.2l2.6 2.3c.5.4.8 1.1.8 1.8V26a2.2 2.2 0 0 1-2.2 2.2H10.8A2.2 2.2 0 0 1 8.6 26v-9.5c0-.7.3-1.4.8-1.8l2.6-2.3z',
    fill: 'milk',
  },
  // The milk wave.
  { d: 'M8.6 19.4c2.5-1.5 4.9-1.5 7.4 0s4.9 1.5 7.4 0v2.9c-2.5 1.5-4.9 1.5-7.4 0s-4.9-1.5-7.4 0z', fill: 'blue' },
];
