import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./index.html",
    "./app.ts",
    "./src/**/*.{ts,tsx,js,jsx,html}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
