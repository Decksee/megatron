package app.megatron.desktop

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import android.widget.Toast

/**
 * Blocage d'applis pendant un focus. Android ne réveille ce service que quand une fenêtre change
 * (une appli s'ouvre) : aucune vérification en boucle. Hors focus, il ne fait rien.
 * Si l'appli ouverte est dans la liste, on revient à l'écran d'accueil avec un petit message.
 */
class FocusBlockService : AccessibilityService() {
  private var lastToast = 0L

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
    val pkg = event.packageName?.toString() ?: return
    if (pkg == packageName) return
    if (!FocusCtl.active(this) || !FocusCtl.blocking(this)) return
    if (pkg !in FocusCtl.blocked(this)) return

    performGlobalAction(GLOBAL_ACTION_HOME)
    val now = System.currentTimeMillis()
    if (now - lastToast > 3000) {
      lastToast = now
      val minutes = ((FocusCtl.endsAt(this) - now) / 60_000L).coerceAtLeast(1)
      Toast.makeText(this, "🎯 Focus en cours : encore $minutes min", Toast.LENGTH_SHORT).show()
    }
  }

  override fun onInterrupt() {}
}
