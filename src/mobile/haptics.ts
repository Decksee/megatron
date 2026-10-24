/**
 * Petite vibration au toucher des gestes importants (cocher, onglets, +, envoyer), comme les applis Android.
 * Un seul écouteur pour toute l'appli : aucun composant à modifier.
 */
const TARGETS = ".check, .m-tab, .m-fab, .m-send, .m-start, .m-duration, .m-head-btn";

export function installHaptics() {
  if (!("vibrate" in navigator)) return;
  document.addEventListener(
    "pointerdown",
    (e) => {
      if ((e.target as Element | null)?.closest?.(TARGETS)) navigator.vibrate(8);
    },
    { passive: true },
  );
}
