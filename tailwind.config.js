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
        danger: {
          DEFAULT: "#fb7185",
          muted: "rgba(251, 113, 133, 0.12)",
        },
        warn: {
          DEFAULT: "#fbbf24",
          muted: "rgba(251, 191, 36, 0.12)",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        glow: "0 0 80px rgba(45, 212, 191, 0.08)",
        card: "0 1px 0 rgba(255,255,255,0.04), 0 18px 40px rgba(0,0,0,0.35)",
      },
    },
  },
  plugins: [],
};
