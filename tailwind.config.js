/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#080D1A",
          900: "#0F172A",
          850: "#1E293B",
          800: "#1E293B",
          700: "#334155",
          600: "#334155",
        },
        chrome: "#334155",
        navy: "#06B6D4",
        mist: {
          400: "#94A3B8",
          300: "#94A3B8",
          200: "#F8FAFC",
          100: "#F8FAFC",
        },
        accent: {
          DEFAULT: "#06B6D4",
          dim: "#0891B2",
          muted: "rgba(6, 182, 212, 0.22)",
          line: "rgba(6, 182, 212, 0.4)",
        },
        buy: {
          DEFAULT: "#10B981",
          dim: "#059669",
          muted: "rgba(16, 185, 129, 0.18)",
        },
        sell: {
          DEFAULT: "#F43F5E",
          dim: "#E11D48",
          muted: "rgba(244, 63, 94, 0.14)",
        },
        danger: {
          DEFAULT: "#F43F5E",
          muted: "rgba(244, 63, 94, 0.14)",
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
        glow: "0 0 80px rgba(6, 182, 212, 0.18)",
        card: "0 1px 0 rgba(51,65,85,0.45), 0 18px 40px rgba(0,0,0,0.35)",
      },
    },
  },
  plugins: [],
};
