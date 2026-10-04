import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./favorites.css";
import "./layout-motion.css";
import "./studio-interactions.css";
import "./studio-typography.css";
import "./studio-controls.css";
import "./prompt-workbench.css";
window.addEventListener("unhandledrejection", event => {
  console.error("[unhandledrejection]", event.reason);
});

const root = createRoot(document.getElementById("root")!);
if (new URLSearchParams(window.location.search).get("view") === "prompt") {
  void import("./PromptPopup").then(({ default: PromptPopup }) => {
    root.render(<React.StrictMode><PromptPopup /></React.StrictMode>);
  });
} else {
  void Promise.all([import("./main-app"), import("./studio-agent"), import("./motion-system"), import("./completion-sound"), import("./components/AppErrorBoundary")])
    .then(([{ default: MainApp }, { installStudioAgent }, { installStudioMotion }, { unlockCompletionSound }, { AppErrorBoundary }]) => {
      installStudioAgent();
      installStudioMotion();
      document.addEventListener("pointerdown", unlockCompletionSound, { once: true });
      document.addEventListener("keydown", unlockCompletionSound, { once: true });
      root.render(<React.StrictMode><AppErrorBoundary scope="app" root><MainApp /></AppErrorBoundary></React.StrictMode>);
    });
}
