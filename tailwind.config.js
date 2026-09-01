/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#1A2B56",
          900: "#23345D",
          850: "#283860",
          800: "#2C3C64",
          700: "#314067",
          600: "#3B4A6D",
        },
        chrome: "#363737",
        mist: {
          400: "#A4A5A5",
          300: "#C8C8C8",
          200: "#E2E2E2",
          100: "#F1F1F1",
        },
        accent: {
          DEFAULT: "#00c853",
          dim: "#00b34a",
          muted: "rgba(0, 200, 83, 0.12)",
          line: "rgba(0, 200, 83, 0.28)",
        },
        buy: {
          DEFAULT: "#00c853",
          dim: "#00b34a",
          muted: "rgba(0, 200, 83, 0.12)",
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
        glow: "0 0 80px rgba(0, 200, 83, 0.08)",
        card: "0 1px 0 rgba(54,55,55,0.35), 0 18px 40px rgba(26,43,86,0.45)",
      },
    },
  },
  plugins: [],
};
