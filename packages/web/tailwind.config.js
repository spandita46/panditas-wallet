import colors from "tailwindcss/colors.js";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Semantic aliases: asset/positive (money you have) reads green,
        // liability/negative (money you owe/spend) reads red, accent replaces
        // bare slate-900 as the sole interactive/focus color.
        asset: colors.emerald,
        positive: colors.emerald,
        liability: colors.rose,
        negative: colors.rose,
        accent: colors.indigo,
      },
    },
  },
  plugins: [],
};
