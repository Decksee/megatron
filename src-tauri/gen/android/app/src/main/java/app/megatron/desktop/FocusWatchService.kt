package app.megatron.desktop

import android.app.AppOpsManager
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.Process
import android.provider.Settings
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Blocage d'applis pendant un focus, sans service d'accessibilité (refusé par Play Protect hors Play Store).
 * Ne tourne que pendant un focus et écran allumé : une fois par seconde, il regarde quelle appli est au premier
 * plan (accès à l'utilisation) ; si elle est bloquée, l'écran « Focus en cours » passe devant (affichage par-dessus).
 */
class FocusWatchService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private var lastQuery = 0L
  private var current: String? = null

  private val tick = object : Runnable {
    override fun run() {
      check()
      handler.postDelayed(this, 1000)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (!FocusCtl.active(this)) {
      stopSelf()
      return START_NOT_STICKY
    }
    // Même notification que le compte à rebours du focus : pas de notification en plus.
    ServiceCompat.startForeground(
      this, FocusCtl.ID_FOCUS, FocusCtl.notification(this, FocusCtl.endsAt(this)),
      if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0,
    )
    lastQuery = System.currentTimeMillis() - 10_000
    handler.removeCallbacks(tick)
    handler.post(tick)
    return START_STICKY
  }

  override fun onDestroy() {
    handler.removeCallbacks(tick)
    super.onDestroy()
  }

  private fun check() {
    if (!FocusCtl.active(this)) {
      stopSelf()
      return
    }
    if (!getSystemService(PowerManager::class.java).isInteractive) return
    val now = System.currentTimeMillis()
    val events = getSystemService(UsageStatsManager::class.java).queryEvents(lastQuery, now)
    lastQuery = now
    val e = UsageEvents.Event()
    while (events.hasNextEvent()) {
      events.getNextEvent(e)
      if (e.eventType == UsageEvents.Event.ACTIVITY_RESUMED) current = e.packageName
    }
    val pkg = current ?: return
    if (pkg != packageName && pkg in FocusCtl.blocked(this)) {
      current = packageName
      startActivity(Intent(this, BlockActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP))
    }
  }

  companion object {
    fun usageAccess(context: Context): Boolean {
      val ops = context.getSystemService(AppOpsManager::class.java)
      val mode = if (Build.VERSION.SDK_INT >= 29) {
        ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
      } else {
        @Suppress("DEPRECATION")
        ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
      }
      return mode == AppOpsManager.MODE_ALLOWED
    }

    fun overlay(context: Context) = Settings.canDrawOverlays(context)

    fun allowed(context: Context) = usageAccess(context) && overlay(context)

    fun usageSettings(context: Context) = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)

    fun overlaySettings(context: Context) =
      Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))

    fun start(context: Context) {
      try {
        ContextCompat.startForegroundService(context, Intent(context, FocusWatchService::class.java))
      } catch (e: Exception) {
        // Android refuse parfois un démarrage en arrière-plan : le focus continue, sans blocage.
      }
    }

    fun stop(context: Context) = context.stopService(Intent(context, FocusWatchService::class.java))
  }
}
