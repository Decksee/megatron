package app.megatron.desktop

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.widget.RemoteViews
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

private fun updateAll(context: Context, provider: Class<*>, build: (Bundle) -> RemoteViews) {
  val manager = AppWidgetManager.getInstance(context)
  for (id in manager.getAppWidgetIds(ComponentName(context, provider))) {
    manager.updateAppWidget(id, build(manager.getAppWidgetOptions(id)))
  }
}

private fun hhmm(ms: Long) = SimpleDateFormat("HH:mm", Locale.FRANCE).format(Date(ms))

private fun formatMinutes(m: Int) = if (m < 60) "$m min" else "${m / 60} h" + if (m % 60 > 0) " ${(m % 60).toString().padStart(2, '0')}" else ""

/**
 * Widget Focus : lancer une session d'un toucher (durée et blocage repris des réglages),
 * puis compte à rebours affiché par Android lui-même (aucun code ne tourne pendant le focus).
 */
object FocusWidget {
  fun refreshAll(context: Context) = updateAll(context, FocusWidgetProvider::class.java) { build(context, it) }

  private fun startIntent(context: Context, minutes: Int): PendingIntent =
    PendingIntent.getBroadcast(
      context, 800 + minutes,
      Intent(context, FocusReceiver::class.java).setAction(FocusReceiver.START).putExtra("minutes", minutes),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

  private fun stopIntent(context: Context): PendingIntent =
    PendingIntent.getBroadcast(
      context, 799,
      Intent(context, FocusReceiver::class.java).setAction(FocusReceiver.STOP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

  fun build(context: Context, options: Bundle): RemoteViews {
    val (w, h) = Widget.size(options)
    val v = RemoteViews(context.packageName, R.layout.widget_focus)
    val now = System.currentTimeMillis()
    val until = FocusCtl.endsAt(context)
    val open = Store.openFocus(context)
    val tiny = w < 120 || h < 100

    v.setOnClickPendingIntent(R.id.widget_root, Widget.openApp(context, "focus", 62))
    v.setViewVisibility(R.id.focus_title, if (h < 80) View.GONE else View.VISIBLE)
    v.setViewVisibility(R.id.focus_quick, View.GONE)

    when {
      // En cours : compte à rebours natif, bouton Arrêter.
      until > now -> {
        v.setTextViewText(R.id.focus_title, "🎯 Focus en cours")
        v.setViewVisibility(R.id.focus_big, View.GONE)
        v.setViewVisibility(R.id.focus_chrono, View.VISIBLE)
        v.setChronometer(R.id.focus_chrono, SystemClock.elapsedRealtime() + (until - now), null, true)
        v.setChronometerCountDown(R.id.focus_chrono, true)
        v.setTextViewText(R.id.focus_sub, "Fin à ${hhmm(until)}" + if (FocusCtl.blocking(context)) " · applis bloquées" else "")
        v.setTextViewText(R.id.focus_action, "■  Arrêter")
        v.setInt(R.id.focus_action, "setBackgroundResource", R.drawable.widget_pill_danger)
        v.setTextColor(R.id.focus_action, 0xFFFFFFFF.toInt())
        v.setOnClickPendingIntent(R.id.focus_action, stopIntent(context))
      }
      // En pause dans l'appli : on y renvoie pour reprendre.
      open != null && open.pausedAt != null -> {
        val left = (open.plannedMinutes * 60_000L - (open.pausedAt - open.startedAt - open.pausedMs)).coerceAtLeast(0)
        v.setTextViewText(R.id.focus_title, "Focus en pause")
        v.setViewVisibility(R.id.focus_chrono, View.GONE)
        v.setViewVisibility(R.id.focus_big, View.VISIBLE)
        v.setTextViewText(R.id.focus_big, formatMinutes(((left + 59_999) / 60_000).toInt()))
        v.setTextViewText(R.id.focus_sub, "Reprends-le dans l'appli")
        v.setTextViewText(R.id.focus_action, "Reprendre")
        v.setInt(R.id.focus_action, "setBackgroundResource", R.drawable.widget_pill)
        v.setTextColor(R.id.focus_action, 0xFF000000.toInt())
        v.setOnClickPendingIntent(R.id.focus_action, Widget.openApp(context, "focus", 62))
      }
      // Rien en cours : durée habituelle, et raccourcis si la place le permet.
      else -> {
        val m = Store.setting(context, "focus_duration")?.toIntOrNull() ?: 25
        v.setTextViewText(R.id.focus_title, "🎯 Focus")
        v.setViewVisibility(R.id.focus_chrono, View.GONE)
        v.setViewVisibility(R.id.focus_big, View.VISIBLE)
        v.setTextViewText(R.id.focus_big, formatMinutes(m))
        v.setTextViewText(R.id.focus_sub, if (Store.setting(context, "m_block") != "0") "Applis distrayantes bloquées" else "Reste concentré")
        v.setTextViewText(R.id.focus_action, "▶  Lancer")
        v.setInt(R.id.focus_action, "setBackgroundResource", R.drawable.widget_pill)
        v.setTextColor(R.id.focus_action, 0xFF000000.toInt())
        v.setOnClickPendingIntent(R.id.focus_action, startIntent(context, m))
        if (w >= 200 && h >= 170) {
          v.setViewVisibility(R.id.focus_quick, View.VISIBLE)
          v.setOnClickPendingIntent(R.id.focus_q1, startIntent(context, 15))
          v.setOnClickPendingIntent(R.id.focus_q2, startIntent(context, 50))
          v.setOnClickPendingIntent(R.id.focus_q3, startIntent(context, 90))
        }
      }
    }
    if (tiny) v.setViewVisibility(R.id.focus_sub, View.GONE)
    return v
  }
}

/** Widget Prochain rappel : quand, quoi, et Fait / +10 min sans ouvrir l'appli. */
object ReminderWidget {
  fun refreshAll(context: Context) = updateAll(context, ReminderWidgetProvider::class.java) { build(context, it) }

  private fun whenLabel(due: Long): String {
    val now = Calendar.getInstance()
    val d = Calendar.getInstance().apply { timeInMillis = due }
    val sameDay = now.get(Calendar.YEAR) == d.get(Calendar.YEAR) && now.get(Calendar.DAY_OF_YEAR) == d.get(Calendar.DAY_OF_YEAR)
    now.add(Calendar.DAY_OF_YEAR, 1)
    val tomorrow = now.get(Calendar.YEAR) == d.get(Calendar.YEAR) && now.get(Calendar.DAY_OF_YEAR) == d.get(Calendar.DAY_OF_YEAR)
    return when {
      due <= System.currentTimeMillis() -> "Maintenant"
      sameDay -> "Aujourd'hui · ${hhmm(due)}"
      tomorrow -> "Demain · ${hhmm(due)}"
      else -> SimpleDateFormat("EEE d MMM · HH:mm", Locale.FRANCE).format(Date(due))
    }
  }

  fun build(context: Context, options: Bundle): RemoteViews {
    val (w, h) = Widget.size(options)
    val v = RemoteViews(context.packageName, R.layout.widget_reminder)
    val next = Store.nextReminder(context)
    val small = w < 150 || h < 110

    v.setOnClickPendingIntent(R.id.widget_root, Widget.openApp(context, "reminders", 63))
    v.setViewVisibility(R.id.rem_label, if (h < 90) View.GONE else View.VISIBLE)
    if (next == null) {
      v.setTextViewText(R.id.rem_when, "Rien de prévu")
      v.setTextViewText(R.id.rem_title, "Touche pour ajouter un rappel")
      v.setViewVisibility(R.id.rem_actions, View.GONE)
      return v
    }
    v.setTextViewText(R.id.rem_when, whenLabel(next.dueAt))
    v.setTextViewText(R.id.rem_title, next.title)
    v.setInt(R.id.rem_title, "setMaxLines", if (small) 1 else 2)
    v.setViewVisibility(R.id.rem_actions, if (small) View.GONE else View.VISIBLE)
    v.setOnClickPendingIntent(R.id.rem_done, Notifs.action(context, ActionReceiver.REMINDER_DONE, next.id, 9000))
    v.setOnClickPendingIntent(R.id.rem_snooze, Notifs.action(context, ActionReceiver.REMINDER_SNOOZE, next.id, 9001))
    return v
  }
}

/** Les deux widgets se redessinent à la pose et au redimensionnement ; ensuite seulement quand les données changent. */
private fun redrawAsync(context: Context, refresh: () -> Unit, pending: android.content.BroadcastReceiver.PendingResult) {
  Thread {
    try {
      refresh()
    } finally {
      pending.finish()
    }
  }.start()
}

class FocusWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) =
    redrawAsync(context, { FocusWidget.refreshAll(context) }, goAsync())

  override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) =
    redrawAsync(context, { manager.updateAppWidget(id, FocusWidget.build(context, options)) }, goAsync())
}

class ReminderWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) =
    redrawAsync(context, { ReminderWidget.refreshAll(context) }, goAsync())

  override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) =
    redrawAsync(context, { manager.updateAppWidget(id, ReminderWidget.build(context, options)) }, goAsync())
}
