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
        brand: {
          blue: "#1E3A5F",
          purple: "#6366F1",
          deepBlue: "#1E3A5F",
          stellarPurple: "#6366F1",
        },
        logo: {
          deepSpaceBlue: "#1E3A5F",
          stellarPurple: "#6366F1",
        },
      },
      backgroundImage: {
        "stellar-gradient": "linear-gradient(135deg, #1E3A5F 0%, #6366F1 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
