import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#111111",
        cream: "#f5f5f5",
        forest: "#c41429",
        lime: "#ffd700",
        sand: "#e0e0e0",
      },
      boxShadow: { soft: "0 20px 50px rgba(0,0,0,.10)" },
    },
  },
  plugins: [],
} satisfies Config;
