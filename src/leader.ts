import { getAllWebviewWindows, getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

/**
 * Il y a une fenêtre par écran : les tâches de fond (pause auto, surveillance du focus)
 * ne tournent que dans la première, pour ne pas être faites en double.
 */
export async function isLeader() {
  const labels = (await getAllWebviewWindows()).map((w) => w.label).sort();
  return labels[0] === getCurrentWebviewWindow().label;
}
