import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/outfit";
import { App } from "./App";
import { SettingsApp } from "./SettingsApp";
import { WispGallery } from "./dev/WispGallery";
import "./styles.css";

const params = new URLSearchParams(location.search);
const isSettings = params.get("window") === "settings";
const showGallery = import.meta.env.DEV && params.has("wisp");
document.documentElement.dataset.window = isSettings ? "settings" : "notch";

createRoot(document.getElementById("root")!).render(
  <StrictMode>{showGallery ? <WispGallery /> : isSettings ? <SettingsApp /> : <App />}</StrictMode>,
);
