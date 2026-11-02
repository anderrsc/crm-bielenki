import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "rgb(var(--text-rgb) / <alpha-value>)",
        cream: "rgb(var(--surface-2-rgb) / <alpha-value>)",
        forest: "rgb(var(--brand-text-rgb) / <alpha-value>)",
        lime: "rgb(var(--brand-rgb) / <alpha-value>)",
        sand: "rgb(var(--border-rgb) / <alpha-value>)",
        surface: "rgb(var(--surface-rgb) / <alpha-value>)",
        brand: "rgb(var(--brand-text-rgb) / <alpha-value>)",
        "brand-strong": "rgb(var(--brand-strong-rgb) / <alpha-value>)",
      },
      boxShadow: { soft: "var(--shadow-card)" },
    },
  },
  plugins: [],
} satisfies Config;
