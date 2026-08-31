import type { Config } from "tailwindcss";

// Deliberately not the books palette.
//
// This console and the customer app read the same database, and the one mistake
// that matters here is not knowing which one you are looking at before you click
// something destructive. So: slate rather than paper, a warning-red accent
// rather than the brand green, and denser type. Looking different is a safety
// feature, not a style preference.
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#0d1117",
          soft: "#3d4854",
          faint: "#6e7b8a",
        },
        paper: "#eef1f5",
        card: "#ffffff",
        line: "#d8dee7",
        accent: {
          DEFAULT: "#9a3412",
          dark: "#7c2d12",
          wash: "#fdf0e8",
        },
        ok: "#0f7b5f",
        warn: "#b45309",
        danger: "#b91c1c",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(13,17,23,0.05), 0 1px 10px rgba(13,17,23,0.04)",
      },
    },
  },
  plugins: [],
} satisfies Config;
