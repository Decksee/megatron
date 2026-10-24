package app.megatron.desktop

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray

/**
 * Focus sur téléphone : compte à rebours affiché par Android dans une notification (aucun code ne tourne),
 * alarme à l'heure de fin (session enregistrée même appli fermée), et liste des applis à bloquer
 * que le surveillant de focus (FocusWatchService) consulte.
 */
object FocusCtl {
  private const val PREFS = "megatron"
  private const val CH_FOCUS = "focus"
  const val ID_FOCUS = 3

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /** Fin du focus en cours (ms), ou 0. */
  fun endsAt(context: Context): Long = prefs(context).getLong("focus_until", 0)
  fun blocking(context: Context): Boolean = prefs(context).getBoolean("focus_block", false)
  fun blocked(context: Context): Set<String> = prefs(context).getStringSet("focus_apps", emptySet()) ?: emptySet()
  fun active(context: Context) = endsAt(context) > System.currentTimeMillis()

  private fun endIntent(context: Context): PendingIntent =
    PendingIntent.getBroadcast(
      context, 40, Intent(context, FocusReceiver::class.java).setAction(FocusReceiver.END),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

  fun start(context: Context, sessionId: Long, endsAt: Long, block: Boolean, apps: Set<String>) {
    prefs(context).edit()
      .putLong("focus_session", sessionId)
      .putLong("focus_until", endsAt)
      .putBoolean("focus_block", block)
      .putStringSet("focus_apps", apps)
      .apply()
    val am = context.getSystemService(AlarmManager::class.java)
    if (Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) {
      am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endsAt, endIntent(context))
    } else {
      am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endsAt, endIntent(context))
    }
    showNotification(context, endsAt)
    // Blocage : surveillance de l'appli au premier plan, seulement pendant ce focus.
    if (block && apps.isNotEmpty() && FocusWatchService.allowed(context)) FocusWatchService.start(context)
    refreshWidgets(context)
  }

  /** Lancé depuis le widget : durée et blocage repris des réglages de l'appli. */
  fun startFromWidget(context: Context, minutes: Int?) {
    val m = minutes ?: Store.setting(context, "focus_duration")?.toIntOrNull() ?: 25
    val block = Store.setting(context, "m_block") != "0"
    val apps = try {
      val arr = JSONArray(Store.setting(context, "m_block_apps") ?: "[]")
      (0 until arr.length()).map { arr.getString(it) }.toSet()
    } catch (e: Exception) {
      emptySet()
    }
    val id = Store.startFocus(context, m, if (block) "block" else "alert")
    if (id < 0) return
    start(context, id, System.currentTimeMillis() + m * 60_000L, block, apps)
  }

  /** Arrêté depuis le widget : session close (non réussie), plus de blocage. */
  fun stopFromWidget(context: Context) {
    Store.openFocus(context)?.let { Store.stopFocus(context, it.id) }
    stop(context)
  }

  private fun refreshWidgets(context: Context) = Thread { Widget.refreshAll(context) }.start()

  /** Arrêt (ou pause) : plus d'alarme, plus de blocage, plus de notification. */
  fun stop(context: Context) {
    prefs(context).edit().putLong("focus_until", 0).apply()
    context.getSystemService(AlarmManager::class.java).cancel(endIntent(context))
    FocusWatchService.stop(context)
    NotificationManagerCompat.from(context).cancel(ID_FOCUS)
    refreshWidgets(context)
  }

  /** L'heure de fin est arrivée : session enregistrée comme réussie, petite notification de bravo. */
  fun finish(context: Context) {
    val id = prefs(context).getLong("focus_session", -1)
    stop(context)
    if (id >= 0) {
      Store.withDb(context, Unit) { db ->
        db.execSQL(
          "UPDATE focus_sessions SET ended_at = ?, completed = 1 WHERE id = ? AND ended_at IS NULL",
          arrayOf<Any>(Store.toIso(System.currentTimeMillis()), id),
        )
      }
    }
    channel(context)
    val n = NotificationCompat.Builder(context, CH_FOCUS)
      .setSmallIcon(R.drawable.ic_stat_megatron)
      .setContentTitle("Session de focus terminée 🎯")
      .setContentText("Bravo ! Prends une petite pause.")
      .setAutoCancel(true)
      .build()
    try {
      NotificationManagerCompat.from(context).notify(ID_FOCUS + 1, n)
    } catch (e: SecurityException) {
    }
  }

  private fun channel(context: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    context.getSystemService(NotificationManager::class.java).createNotificationChannel(
      NotificationChannel(CH_FOCUS, "Focus", NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) },
    )
  }

  private fun showNotification(context: Context, endsAt: Long) {
    try {
      NotificationManagerCompat.from(context).notify(ID_FOCUS, notification(context, endsAt))
    } catch (e: SecurityException) {
    }
  }

  /** Compte à rebours du focus (aussi la notification du service de blocage). */
  fun notification(context: Context, endsAt: Long): android.app.Notification {
    channel(context)
    val open = PendingIntent.getActivity(
      context, 41, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    return NotificationCompat.Builder(context, CH_FOCUS)
      .setSmallIcon(R.drawable.ic_stat_megatron)
      .setContentTitle("🎯 Focus en cours")
      .setContentText(if (blocking(context)) "Applis distrayantes bloquées" else "Reste concentré")
      // Le compte à rebours est affiché par Android lui-même : aucun code ne tourne pendant le focus.
      .setWhen(endsAt)
      .setShowWhen(true)
      .setUsesChronometer(true)
      .setChronometerCountDown(true)
      .setOngoing(true)
      .setSilent(true)
      .setContentIntent(open)
      .build()
  }
}

/** Alarme de fin de focus. */
class FocusReceiver : BroadcastReceiver() {
  companion object {
    const val END = "app.megatron.FOCUS_END"
    const val START = "app.megatron.FOCUS_START"
    const val STOP = "app.megatron.FOCUS_STOP"
  }

  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action
    if (action != END && action != START && action != STOP) return
    val pending = goAsync()
    Thread {
      try {
        when (action) {
          END -> FocusCtl.finish(context)
          START -> FocusCtl.startFromWidget(context, intent.getIntExtra("minutes", 0).takeIf { it > 0 })
          STOP -> FocusCtl.stopFromWidget(context)
        }
      } finally {
        pending.finish()
      }
    }.start()
  }
}
