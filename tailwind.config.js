/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#05070a",
          900: "#0b1018",
          850: "#10161f",
          800: "#161d28",
          700: "#1e2734",
          600: "#2a3444",
        },
        mist: {
          400: "#94a3b8",
          300: "#cbd5e1",
          200: "#e2e8f0",
          100: "#f1f5f9",
        },
        accent: {
          DEFAULT: "#2dd4bf",
          dim: "#14b8a6",
          muted: "rgba(45, 212, 191, 0.12)",
          line: "rgba(45, 212, 191, 0.28)",
        },
        buy: {
          DEFAULT: "#0ecb81",
          dim: "#0bb36f",
          muted: "rgba(14, 203, 129, 0.12)",
        },
        sell: {
          DEFAULT: "#f6465d",
          dim: "#dc3349",
          muted: "rgba(246, 70, 93, 0.12)",
        },
        danger: {
          DEFAULT: "#f6465d",
          muted: "rgba(246, 70, 93, 0.12)",
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
        glow: "0 0 80px rgba(45, 212, 191, 0.08)",
        card: "0 1px 0 rgba(255,255,255,0.04), 0 18px 40px rgba(0,0,0,0.35)",
      },
    },
  },
  plugins: [],
};
