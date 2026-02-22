import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        mono: ["var(--font-mono)", "monospace"],
        serif: ["Georgia", '"Times New Roman"', "serif"],
      },
      typography: {
        lattice: {
          css: {
            // Base settings
            '--tw-prose-body': 'hsl(var(--foreground))',
            '--tw-prose-headings': 'hsl(var(--foreground))',
            '--tw-prose-links': 'hsl(var(--primary))',
            '--tw-prose-bold': 'hsl(var(--foreground))',
            '--tw-prose-counters': 'hsl(var(--muted-foreground))',
            '--tw-prose-bullets': 'hsl(var(--muted-foreground))',
            '--tw-prose-hr': 'hsl(var(--border))',
            '--tw-prose-quotes': 'hsl(var(--foreground))',
            '--tw-prose-quote-borders': 'hsl(var(--border))',
            '--tw-prose-captions': 'hsl(var(--muted-foreground))',
            '--tw-prose-code': 'hsl(var(--foreground))',
            '--tw-prose-pre-code': 'hsl(var(--foreground))',
            '--tw-prose-pre-bg': 'hsl(var(--muted))',
            '--tw-prose-th-borders': 'hsl(var(--border))',
            '--tw-prose-td-borders': 'hsl(var(--border))',
            
            // Typography base
            fontSize: '16px',
            lineHeight: '1.6',
            
            // Headings: Serif, bold, tight tracking
            'h1, h2, h3, h4': {
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontWeight: '700',
              letterSpacing: '-0.025em',
              color: 'hsl(var(--foreground))',
            },
            'h1': {
              fontSize: '2.25rem',
              marginTop: '2rem',
              marginBottom: '1rem',
            },
            'h2': {
              fontSize: '1.75rem',
              marginTop: '1.75rem',
              marginBottom: '0.75rem',
            },
            'h3': {
              fontSize: '1.375rem',
              marginTop: '1.5rem',
              marginBottom: '0.5rem',
            },
            
            // Paragraphs
            'p': {
              marginTop: '1rem',
              marginBottom: '1rem',
            },
            
            // Tables: Borders, striped rows, compact padding
            'table': {
              borderCollapse: 'collapse',
              width: '100%',
              marginTop: '1.5rem',
              marginBottom: '1.5rem',
            },
            'thead': {
              borderBottomWidth: '2px',
              borderBottomColor: 'hsl(var(--border))',
            },
            'thead th': {
              fontWeight: '600',
              verticalAlign: 'bottom',
              padding: '0.5rem 0.75rem',
              backgroundColor: 'hsl(var(--muted) / 0.3)',
            },
            'tbody tr': {
              borderBottomWidth: '1px',
              borderBottomColor: 'hsl(var(--border))',
            },
            'tbody tr:nth-child(even)': {
              backgroundColor: 'hsl(var(--muted) / 0.5)',
            },
            'tbody td': {
              padding: '0.5rem 0.75rem',
              verticalAlign: 'top',
            },
            'th, td': {
              border: '1px solid hsl(var(--border))',
            },
            
            // Code: Monospace, rounded, distinct background
            'code': {
              fontFamily: 'var(--font-mono), ui-monospace, monospace',
              fontSize: '0.875em',
              backgroundColor: 'hsl(var(--muted))',
              borderRadius: '0.25rem',
              padding: '0.125rem 0.375rem',
              fontWeight: '400',
            },
            'code::before': {
              content: '""',
            },
            'code::after': {
              content: '""',
            },
            'pre': {
              backgroundColor: 'hsl(var(--muted))',
              borderRadius: '0.5rem',
              padding: '1rem',
              overflowX: 'auto',
            },
            'pre code': {
              backgroundColor: 'transparent',
              padding: '0',
              borderRadius: '0',
            },
            
            // Blockquotes
            'blockquote': {
              fontStyle: 'italic',
              borderLeftWidth: '4px',
              borderLeftColor: 'hsl(var(--border))',
              paddingLeft: '1rem',
              marginTop: '1.5rem',
              marginBottom: '1.5rem',
            },
            
            // Lists
            'ul, ol': {
              paddingLeft: '1.5rem',
            },
            'li': {
              marginTop: '0.25rem',
              marginBottom: '0.25rem',
            },
            
            // Links
            'a': {
              color: 'hsl(var(--primary))',
              textDecoration: 'underline',
              textUnderlineOffset: '2px',
            },
            'a:hover': {
              textDecoration: 'none',
            },
            
            // Block math: Larger font for readability
            '.katex-display': {
              fontSize: '1.1em',
              margin: '1.5rem 0',
              overflowX: 'auto',
              overflowY: 'hidden',
            },
            
            // Inline math
            '.katex': {
              fontSize: '1em',
            },
            
            // Images
            'img': {
              borderRadius: '0.5rem',
              marginTop: '1.5rem',
              marginBottom: '1.5rem',
            },
            
            // Horizontal rule
            'hr': {
              borderColor: 'hsl(var(--border))',
              marginTop: '2rem',
              marginBottom: '2rem',
            },
          },
        },
      },
    },
  },
  plugins: [typography],
};

export default config;
