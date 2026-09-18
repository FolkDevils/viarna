import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/App";
import { useStore } from "@/state/store";
import "@/styles/global.css";

// Dev affordance: reach the store from the console / automation as
// `window.viarna.getState()`. Compiled out of production (import.meta.env.DEV).
if (import.meta.env.DEV) {
  (window as unknown as { viarna: typeof useStore }).viarna = useStore;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
