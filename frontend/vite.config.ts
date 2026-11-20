import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run dev` serves the UI on :5173 and forwards the live feed and API to
// the FastAPI server on :8000, so both can run side by side during development.
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      // Three pages: the live map, the About/docs page and the Results page (no map code on the last two).
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        about: resolve(import.meta.dirname, "about.html"),
        results: resolve(import.meta.dirname, "results.html"),
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
