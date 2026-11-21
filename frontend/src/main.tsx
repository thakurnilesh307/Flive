import { StrictMode } from "react";
import { applyTheme, initialTheme } from "./theme";
import { createRoot } from "react-dom/client";
import "./fonts";
import "./styles.css";
import App from "./App";

applyTheme(initialTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
