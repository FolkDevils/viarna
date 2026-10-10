import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/App";
import { useStore } from "@/state/store";
import { useOrbit } from "@/state/orbit";
import { useGlass } from "@/state/glass";
import "@/styles/global.css";

// Dev affordance: reach the store from the console / automation as
// `window.viarna.getState()`. Compiled out of production (import.meta.env.DEV).
if (import.meta.env.DEV) {
  (window as unknown as { viarna: typeof useStore }).viarna = useStore;
  (window as unknown as { viarnaOrbit: typeof useOrbit }).viarnaOrbit = useOrbit;
  (window as unknown as { viarnaGlass: typeof useGlass }).viarnaGlass = useGlass;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
