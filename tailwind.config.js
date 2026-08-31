/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0a0c0e",
          900: "#111315",
          850: "#161a1e",
          800: "#1c2127",
          700: "#242a31",
          600: "#2a3444",
        },
        mist: {
          400: "#94a3b8",
          300: "#cbd5e1",
          200: "#e2e8f0",
          100: "#f1f5f9",
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
        card: "0 1px 0 rgba(255,255,255,0.04), 0 18px 40px rgba(0,0,0,0.35)",
      },
    },
  },
  plugins: [],
};
