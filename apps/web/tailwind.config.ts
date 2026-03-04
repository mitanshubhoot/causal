import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Layer colors — each causal layer has a distinctive color
        intent:    { DEFAULT: "#7c3aed", light: "#ede9fe", border: "#c4b5fd" },
        spec:      { DEFAULT: "#2563eb", light: "#dbeafe", border: "#93c5fd" },
        reasoning: { DEFAULT: "#0891b2", light: "#cffafe", border: "#67e8f9" },
        code:      { DEFAULT: "#059669", light: "#d1fae5", border: "#6ee7b7" },
        execution: { DEFAULT: "#d97706", light: "#fef3c7", border: "#fcd34d" },
        incident:  { DEFAULT: "#dc2626", light: "#fee2e2", border: "#fca5a5" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
