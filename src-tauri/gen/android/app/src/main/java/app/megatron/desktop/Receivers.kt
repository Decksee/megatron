package app.megatron.desktop

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Boutons des notifications (Fait, Replanifier, Dans 10 min) : la base est modifiée sans ouvrir l'appli. */
class ActionReceiver : BroadcastReceiver() {
  companion object {
    const val TASK_DONE = "app.megatron.TASK_DONE"
    const val TASK_REPLAN = "app.megatron.TASK_REPLAN"
    const val REMINDER_DONE = "app.megatron.REMINDER_DONE"
    const val REMINDER_SNOOZE = "app.megatron.REMINDER_SNOOZE"
  }

  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getLongExtra("id", -1)
    if (id < 0) return
    val pending = goAsync()
    Thread {
      try {
        when (intent.action) {
          TASK_DONE -> Store.markDone(context, id)
          TASK_REPLAN -> Store.replanTomorrow(context, id)
          REMINDER_DONE -> {
            Store.completeReminder(context, id)
            Notifs.cancel(context, (1000 + id).toInt())
          }
          REMINDER_SNOOZE -> {
            Store.snoozeReminder(context, id, 10)
            Notifs.cancel(context, (1000 + id).toInt())
          }
        }
        Alarms.scheduleAll(context)
        Notifs.refreshTask(context)
        Widget.refreshAll(context)
      } finally {
        pending.finish()
      }
    }.start()
  }
}

/** Alarmes : un rappel arrive, c'est le matin, ou minuit est passé. */
class AlarmReceiver : BroadcastReceiver() {
  companion object {
    const val REMINDER = "app.megatron.REMINDER"
    const val BRIEFING = "app.megatron.BRIEFING"
    const val MIDNIGHT = "app.megatron.MIDNIGHT"
  }

  override fun onReceive(context: Context, intent: Intent) {
    val pending = goAsync()
    Thread {
      try {
        when (intent.action) {
          REMINDER -> {
            val id = intent.getLongExtra("id", -1)
            Store.reminder(context, id)?.let { r ->
              Notifs.showReminder(context, r)
              Store.markNotified(context, id)
            }
          }
          BRIEFING -> Notifs.showBriefing(context)
        }
        Alarms.scheduleAll(context)
        Notifs.refreshTask(context)
        Widget.refreshAll(context)
      } finally {
        pending.finish()
      }
    }.start()
  }
}

/** Après un redémarrage du téléphone (ou une mise à jour de l'appli), Android oublie les alarmes : on les remet. */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val pending = goAsync()
    Thread {
      try {
        Alarms.scheduleAll(context)
        Notifs.refreshTask(context)
        Widget.refreshAll(context)
      } finally {
        pending.finish()
      }
    }.start()
  }
}
