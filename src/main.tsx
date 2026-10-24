import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/outfit";
import { App } from "./App";
import { SettingsApp } from "./SettingsApp";
import { WispGallery } from "./dev/WispGallery";
import { MobileApp } from "./mobile/MobileApp";
import "./mobile/mobile.css";
import "./styles.css";

const params = new URLSearchParams(location.search);
const isSettings = params.get("window") === "settings";
// Application Android (fenêtre unique ouverte par Rust avec ?window=mobile).
const isMobile = params.get("window") === "mobile";
const showGallery = import.meta.env.DEV && params.has("wisp");
document.documentElement.dataset.window = isMobile ? "mobile" : isSettings ? "settings" : "notch";

createRoot(document.getElementById("root")!).render(
  <StrictMode>{showGallery ? <WispGallery /> : isMobile ? <MobileApp /> : isSettings ? <SettingsApp /> : <App />}</StrictMode>,
);
