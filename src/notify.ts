import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

let granted: boolean | null = null;

/** Notification Windows (demande la permission la première fois). */
export async function notify(title: string, body: string) {
  try {
    granted ??= (await isPermissionGranted()) || (await requestPermission()) === "granted";
    if (granted) sendNotification({ title, body });
  } catch (e) {
    console.error(e);
  }
}
