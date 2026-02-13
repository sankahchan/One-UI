/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        app: 'hsl(var(--color-app) / <alpha-value>)',
        panel: 'hsl(var(--color-surface) / <alpha-value>)',
        card: 'hsl(var(--color-card) / <alpha-value>)',
        foreground: 'hsl(var(--color-foreground) / <alpha-value>)',
        muted: 'hsl(var(--color-muted) / <alpha-value>)',
        line: 'hsl(var(--color-border) / <alpha-value>)',
        brand: {
          400: '#60A5FA',
          500: '#3B82F6',
          600: '#6366F1'
        },
        surface: {
          900: '#0B1216',
          800: '#10202A',
          700: '#183240'
        },
        accent: {
          400: '#22D3EE',
          500: '#1AB0B8',
          600: '#148F95'
        },
        signal: {
          success: '#2DAA7D',
          warning: '#F3A33A',
          danger: '#EB5757'
        }
      },
      boxShadow: {
        glow: '0 0 40px rgba(26, 176, 184, 0.2)',
        soft: '0 20px 55px -35px rgba(15, 23, 42, 0.6)'
      },
      fontFamily: {
        sans: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace']
      }
    }
  },
  plugins: []
};
