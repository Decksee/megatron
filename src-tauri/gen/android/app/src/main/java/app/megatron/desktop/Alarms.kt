package app.megatron.desktop

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import java.util.Calendar

/**
 * Alarmes Android : rappels à l'heure dite, point du matin à 8 h, mise à jour à minuit.
 * Le système réveille Mégatron à l'heure dite, quelques secondes : rien ne tourne entre deux.
 */
object Alarms {
  private const val PREFS = "megatron"
  private const val BRIEFING_HOUR = 8

  private fun manager(context: Context) = context.getSystemService(AlarmManager::class.java)

  private fun pending(context: Context, action: String, id: Long, request: Int, create: Boolean): PendingIntent? =
    PendingIntent.getBroadcast(
      context, request,
      Intent(context, AlarmReceiver::class.java).setAction(action).putExtra("id", id),
      PendingIntent.FLAG_IMMUTABLE or if (create) PendingIntent.FLAG_UPDATE_CURRENT else PendingIntent.FLAG_NO_CREATE,
    )

  /** Exacte si Android l'autorise (rappels à la minute), sinon à quelques minutes près. */
  private fun set(context: Context, at: Long, pi: PendingIntent) {
    val am = manager(context)
    if (Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) {
      am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    } else {
      am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
    }
  }

  private fun nextAt(hour: Int, minute: Int = 0): Long {
    val cal = Calendar.getInstance().apply {
      set(Calendar.HOUR_OF_DAY, hour); set(Calendar.MINUTE, minute); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }
    if (cal.timeInMillis <= System.currentTimeMillis()) cal.add(Calendar.DAY_OF_YEAR, 1)
    return cal.timeInMillis
  }

  /** Reprogramme tout d'après la base : à appeler quand les données changent, au démarrage du téléphone, à minuit. */
  fun scheduleAll(context: Context) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val am = manager(context)

    // Rappels : on annule les anciens, on programme ceux à venir.
    prefs.getStringSet("reminder_ids", emptySet())?.forEach { id ->
      pending(context, AlarmReceiver.REMINDER, id.toLong(), 3000 + id.toInt(), false)?.let { am.cancel(it) }
    }
    val now = System.currentTimeMillis()
    val ids = mutableSetOf<String>()
    for (r in Store.pendingReminders(context)) {
      val at = if (r.dueAt > now) r.dueAt else continue
      set(context, at, pending(context, AlarmReceiver.REMINDER, r.id, 3000 + r.id.toInt(), true)!!)
      ids.add(r.id.toString())
    }
    prefs.edit().putStringSet("reminder_ids", ids).apply()

    // Point du matin et mise à jour de minuit (jour qui change → nouvelle tâche du moment).
    set(context, nextAt(BRIEFING_HOUR), pending(context, AlarmReceiver.BRIEFING, 0, 1, true)!!)
    set(context, nextAt(0, 1), pending(context, AlarmReceiver.MIDNIGHT, 0, 2, true)!!)
  }
}
