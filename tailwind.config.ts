import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#18221e",
        cream: "#f4f1e9",
        forest: "#234d3c",
        lime: "#b9d349",
        sand: "#ded7c7",
      },
      boxShadow: { soft: "0 20px 50px rgba(24,34,30,.08)" },
    },
  },
  plugins: [],
} satisfies Config;
