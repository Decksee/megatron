package app.megatron.desktop

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Notifications de Mégatron : tâche en cours (permanente), rappels, point du matin. */
object Notifs {
  const val CH_TASK = "tache_en_cours"
  const val CH_REMINDER = "rappels"
  const val CH_DAY = "journee"
  const val ID_TASK = 1

  fun channels(context: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    val nm = context.getSystemService(NotificationManager::class.java)
    nm.createNotificationChannel(
      NotificationChannel(CH_TASK, "Tâche en cours", NotificationManager.IMPORTANCE_LOW).apply {
        description = "La tâche du moment, avec Fait et Replanifier"
        setShowBadge(false)
      },
    )
    nm.createNotificationChannel(
      NotificationChannel(CH_REMINDER, "Rappels", NotificationManager.IMPORTANCE_HIGH).apply { description = "Tes rappels à l'heure dite" },
    )
    nm.createNotificationChannel(
      NotificationChannel(CH_DAY, "Point du matin", NotificationManager.IMPORTANCE_DEFAULT).apply { description = "Ce que tu as à faire aujourd'hui" },
    )
  }

  private fun openApp(context: Context): PendingIntent =
    PendingIntent.getActivity(
      context, 0,
      Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

  fun action(context: Context, action: String, id: Long, request: Int): PendingIntent =
    PendingIntent.getBroadcast(
      context, request,
      Intent(context, ActionReceiver::class.java).setAction(action).putExtra("id", id),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

  private fun canNotify(context: Context) = NotificationManagerCompat.from(context).areNotificationsEnabled()

  private val hhmm get() = SimpleDateFormat("HH:mm", Locale.FRANCE)

  /**
   * Notification permanente « tâche en cours » : la tâche du moment, la suivante (ou le prochain rappel),
   * et les boutons Fait / Replanifier. Rien à faire aujourd'hui (ou réglage coupé) → elle disparaît.
   * Mise à jour seulement quand quelque chose change : elle ne coûte rien entre-temps.
   */
  fun refreshTask(context: Context) {
    channels(context)
    val nm = NotificationManagerCompat.from(context)
    val tasks = Store.todayTasks(context)
    if (Store.setting(context, "pin_task") == "0" || tasks.isEmpty() || !canNotify(context)) {
      nm.cancel(ID_TASK)
      return
    }
    val current = tasks[0]
    val header = if (tasks.size > 1) "À faire · 1 sur ${tasks.size}" else "À faire"
    val next = tasks.getOrNull(1)
    val reminder = Store.nextReminderToday(context)
    val nextLine = when {
      reminder != null -> "Ensuite · ${hhmm.format(Date(reminder.dueAt))} · ${reminder.title}"
      next != null -> "Ensuite · ${next.title}"
      else -> null
    }
    val title = (if (current.late) "⚠ " else "") + current.title
    val builder = NotificationCompat.Builder(context, CH_TASK)
      .setSmallIcon(R.drawable.ic_stat_megatron)
      .setSubText(current.project ?: header)
      .setContentTitle(title)
      .setContentText(nextLine ?: header)
      .setStyle(NotificationCompat.BigTextStyle().bigText(listOfNotNull(header, nextLine).joinToString("\n")))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setShowWhen(false)
      .setCategory(NotificationCompat.CATEGORY_STATUS)
      .setContentIntent(openApp(context))
      .addAction(0, "Fait", action(context, ActionReceiver.TASK_DONE, current.id, 10))
      .addAction(0, "Replanifier", action(context, ActionReceiver.TASK_REPLAN, current.id, 11))
    try {
      nm.notify(ID_TASK, builder.build())
    } catch (e: SecurityException) {
      // Permission de notifier refusée : rien à afficher.
    }
  }

  fun showReminder(context: Context, r: Store.Reminder) {
    channels(context)
    if (!canNotify(context)) return
    val id = (1000 + r.id).toInt()
    val n = NotificationCompat.Builder(context, CH_REMINDER)
      .setSmallIcon(R.drawable.ic_stat_megatron)
      .setContentTitle("🔔 ${r.title}")
      .setContentText(if (r.repeat == "none") "Rappel Mégatron" else "Rappel répété")
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_REMINDER)
      .setAutoCancel(true)
      .setContentIntent(openApp(context))
      .addAction(0, "Fait", action(context, ActionReceiver.REMINDER_DONE, r.id, id * 2))
      .addAction(0, "Dans 10 min", action(context, ActionReceiver.REMINDER_SNOOZE, r.id, id * 2 + 1))
      .build()
    try {
      NotificationManagerCompat.from(context).notify(id, n)
    } catch (e: SecurityException) {
    }
  }

  fun cancel(context: Context, id: Int) = NotificationManagerCompat.from(context).cancel(id)

  /** Point du matin, calculé hors ligne : tâches du jour, retards, premier rappel. */
  fun showBriefing(context: Context) {
    channels(context)
    if (!canNotify(context) || Store.setting(context, "briefing") == "0") return
    val tasks = Store.todayTasks(context)
    val late = tasks.count { it.late }
    val reminder = Store.nextReminderToday(context)
    val parts = mutableListOf<String>()
    if (tasks.isNotEmpty()) {
      val names = tasks.take(3).joinToString(", ") { it.title }
      parts.add("${tasks.size} tâche${if (tasks.size > 1) "s" else ""} : $names${if (tasks.size > 3) "…" else ""}")
    }
    if (late > 0) parts.add("$late en retard")
    if (reminder != null) parts.add("rappel à ${hhmm.format(Date(reminder.dueAt))} : ${reminder.title}")
    val text = if (parts.isEmpty()) "Rien de prévu aujourd'hui. Bonne journée !" else parts.joinToString(" · ")
    val n = NotificationCompat.Builder(context, CH_DAY)
      .setSmallIcon(R.drawable.ic_stat_megatron)
      .setContentTitle("☀️ Ta journée")
      .setContentText(text)
      .setStyle(NotificationCompat.BigTextStyle().bigText(text))
      .setAutoCancel(true)
      .setContentIntent(openApp(context))
      .build()
    try {
      NotificationManagerCompat.from(context).notify(2, n)
    } catch (e: SecurityException) {
    }
  }
}
