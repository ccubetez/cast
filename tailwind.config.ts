import type { Config } from 'tailwindcss';

/**
 * SANCTUM-84 — техно-готика, строгий grayscale.
 * Семантика имён сохранена (phos/amber/cy/violet/danger),
 * значения — оттенки кости и пепла:
 *   bone  — primary, прибыль, акценты (яркая кость)
 *   ash   — убыток, danger, приглушённый (пепел + ☠)
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        abyss: '#0A0A0B',
        panel: '#131315',
        line: 'rgba(232,230,225,0.10)',
        phos: '#FFFFFF', // bone — primary (+30% яркости)
        amber: '#FFFFFF', // bone — CAST/primary action
        cy: '#FAFAFE', // silver — данные
        violet: '#B5B5BA', // ash — риск
        danger: '#C8C8CE', // ash — убыток/danger
        profit: '#33FF66', // PnL green — только в финансовом контексте
        loss: '#FF4444', // PnL red — только в финансовом контексте
        muted: '#DDDFDC',
        dim: '#9F9FA5',
      },
      fontFamily: {
        mono: ['var(--font-plex)', 'ui-monospace', 'Menlo', 'monospace'],
        gothic: ['var(--font-gothic)', 'serif'],
        term: ['var(--font-vt323)', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
