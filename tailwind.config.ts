import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        forge: {
          50: "#f4f6f9",
          100: "#e6eaf1",
          200: "#cbd4e2",
          300: "#a3b4cd",
          400: "#7490b3",
          500: "#52739c",
          600: "#3f5b81",
          700: "#354a68",
          800: "#2f3f58",
          900: "#2a374b",
          950: "#1b2432",
        },
        ember: {
          200: "#fed7aa",
          300: "#fdba74",
          400: "#fb923c",
          500: "#f97316",
          600: "#ea580c",
          700: "#c2410c",
          800: "#9a3412",
          950: "#431407",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
