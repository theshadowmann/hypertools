/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#242525",
          900: "#2a2b2b",
          850: "#2e2f2f",
          800: "#323333",
          700: "#363737",
          600: "#3e3f3f",
        },
        chrome: "#363737",
        navy: "#1A2B56",
        mist: {
          400: "#A4A5A5",
          300: "#C8C8C8",
          200: "#E2E2E2",
          100: "#F1F1F1",
        },
        accent: {
          DEFAULT: "#1A2B56",
          dim: "#243562",
          muted: "rgba(26, 43, 86, 0.22)",
          line: "rgba(26, 43, 86, 0.4)",
        },
        buy: {
          DEFAULT: "#1A2B56",
          dim: "#243562",
          muted: "rgba(26, 43, 86, 0.22)",
        },
        sell: {
          DEFAULT: "#e57373",
          dim: "#c62828",
          muted: "rgba(229, 115, 115, 0.12)",
        },
        danger: {
          DEFAULT: "#e57373",
          muted: "rgba(229, 115, 115, 0.12)",
        },
        warn: {
          DEFAULT: "#fbbf24",
          muted: "rgba(251, 191, 36, 0.12)",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "Segoe UI", "Helvetica Neue", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      boxShadow: {
        glow: "0 0 80px rgba(26, 43, 86, 0.18)",
        card: "0 1px 0 rgba(54,55,55,0.45), 0 18px 40px rgba(0,0,0,0.35)",
      },
    },
  },
  plugins: [],
};
