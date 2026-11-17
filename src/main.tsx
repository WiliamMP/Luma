import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Tauri's own drag-drop is off (so the chat can take dropped files); without this, a file dropped
// anywhere else would make the webview navigate to it and replace the app
for (const type of ["dragover", "drop"] as const)
  window.addEventListener(type, (e) => e.dataTransfer?.types.includes("Files") && e.preventDefault());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
