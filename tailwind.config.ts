import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#10221b",
          soft: "#33473f",
          faint: "#6b7d76",
        },
        paper: "#f7f5ef",
        card: "#ffffff",
        line: "#e6e2d8",
        brand: {
          DEFAULT: "#0f7b5f",
          dark: "#0a5c47",
          light: "#1aa37c",
          wash: "#e6f4ee",
        },
        money: {
          in: "#0f7b5f",
          out: "#c0492f",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,34,27,0.04), 0 1px 12px rgba(16,34,27,0.04)",
        pop: "0 8px 30px rgba(16,34,27,0.12)",
      },
      borderRadius: {
        xl: "0.875rem",
      },
    },
  },
  plugins: [],
} satisfies Config;
