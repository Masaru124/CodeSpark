import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#f5f7fa",
          100: "#e9edf3",
          200: "#cfd8e3",
          300: "#a9b6c6",
          400: "#77889e",
          500: "#556781",
          600: "#425167",
          700: "#364354",
          800: "#2b3542",
          900: "#1d242e",
        },
        spark: {
          50: "#fff8ed",
          100: "#ffefd4",
          200: "#ffdba8",
          300: "#ffc171",
          400: "#ff9c38",
          500: "#fe7d12",
          600: "#ef6208",
          700: "#c64909",
          800: "#9d3910",
          900: "#7e3110",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
