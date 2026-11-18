import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run dev` serves the UI on :5173 and forwards the live feed and API to
// the FastAPI server on :8000, so both can run side by side during development.
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      // Two pages: the live map and the About/docs page (no map code loaded there).
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        about: resolve(import.meta.dirname, "about.html"),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/ws": { target: "ws://127.0.0.1:8000", ws: true },
      "/api": { target: "http://127.0.0.1:8000" },
    },
  },
});
