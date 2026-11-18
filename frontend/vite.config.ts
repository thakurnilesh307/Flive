import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run dev` serves the UI on :5173 and forwards the live feed to the
// FastAPI server on :8000, so both can run side by side during development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/ws": { target: "ws://127.0.0.1:8000", ws: true },
    },
  },
});
