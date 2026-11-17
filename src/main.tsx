import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Tauri's own drag-drop is off (so the chat can take dropped files); without this, a file dropped
// anywhere else would make the webview navigate to it and replace the app
for (const type of ["dragover", "drop"] as const)
  window.addEventListener(type, (e) => e.dataTransfer?.types.includes("Files") && e.preventDefault());

/** a render error shows this instead of a blank window */
class Crash extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error(error);
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <div className="max-w-md space-y-3">
          <h1 className="text-xl font-semibold">Algo deu errado</h1>
          <p className="text-sm text-dim">O Luma encontrou um erro. Recarregar costuma resolver.</p>
          <pre className="selectable max-h-40 overflow-auto rounded-md bg-raised p-3 text-left text-xs text-dim">{error.message}</pre>
          <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:brightness-110" onClick={() => location.reload()}>
            Recarregar
          </button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Crash>
      <App />
    </Crash>
  </StrictMode>,
);
