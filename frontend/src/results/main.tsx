import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../fonts";
import "../fonts-serif";
import { applyTheme, initialTheme } from "../theme";
import "../about/about.css";
import "./results.css";
import ResultsPage from "./Results";

applyTheme(initialTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ResultsPage />
  </StrictMode>,
);
