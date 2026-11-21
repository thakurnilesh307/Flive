import { StrictMode } from "react";
import { applyTheme, initialTheme } from "../theme";
import { createRoot } from "react-dom/client";
import "../fonts";
import "../fonts-serif";
import "./about.css";
import About from "./About";

applyTheme(initialTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <About />
  </StrictMode>,
);
