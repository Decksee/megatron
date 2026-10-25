package app.megatron.desktop

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Minuteur de temps de travail dans les notifications : le chrono qui avance (affiché par Android lui-même,
 * aucun code ne tourne), et Pause / Reprendre / Arrêter sans ouvrir l'appli. Mêmes règles que l'interface.
 */
object TimerNotif {
  private const val CH_TIMER = "minuteur"
  private const val ID_TIMER = 4

  /** Les lectures n'acceptent pas de paramètre vide : « sans projet » s'écrit à part. */
  private fun sameProject(projectId: Long?) = if (projectId == null) "project_id IS NULL" else "project_id = ?"

  /** Un minuteur : projet (null = sans projet), temps déjà compté, et début de la session en cours s'il tourne. */
  data class TimerState(val projectId: Long?, val name: String, val doneMs: Long, val runningSince: Long?)

  fun timers(context: Context): List<TimerState> = Store.withDb(context, emptyList()) { db ->
    val list = mutableListOf<TimerState>()
    db.rawQuery(
      "SELECT t.project_id, t.created_at, p.name FROM timers t LEFT JOIN projects p ON p.id = t.project_id ORDER BY t.created_at",
      null,
    ).use { c ->
      while (c.moveToNext()) {
        val pid = if (c.isNull(0)) null else c.getLong(0)
        val createdAt = c.getString(1)
        var done = 0L
        var since: Long? = null
        db.rawQuery(
          "SELECT started_at, ended_at FROM time_entries WHERE ${sameProject(pid)} AND started_at >= ?",
          (listOfNotNull(pid?.toString()) + createdAt).toTypedArray(),
        ).use { e ->
          while (e.moveToNext()) {
            val start = Store.parseIso(e.getString(0)) ?: continue
            if (e.isNull(1)) since = start else done += ((Store.parseIso(e.getString(1)) ?: start) - start).coerceAtLeast(0)
          }
        }
        list.add(TimerState(pid, if (c.isNull(2)) "Sans projet" else c.getString(2), done, since))
      }
    }
    list
  }

  private fun channel(context: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    context.getSystemService(NotificationManager::class.java).createNotificationChannel(
      NotificationChannel(CH_TIMER, "Minuteur", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Le temps de travail en cours, avec Pause et Arrêter"
        setShowBadge(false)
      },
    )
  }

  fun action(context: Context, action: String, projectId: Long?, request: Int): PendingIntent =
    PendingIntent.getBroadcast(
      context, request,
      Intent(context, TimerReceiver::class.java).setAction(action).putExtra("project", projectId ?: -1L),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

  private fun clock(ms: Long): String {
    val s = ms / 1000
    return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s / 60 % 60, s % 60) else "%02d:%02d".format(s / 60, s % 60)
  }

  /** Redessine la notification d'après la base : minuteur qui tourne en priorité, sinon un minuteur en pause. */
  fun refresh(context: Context) {
    val all = timers(context)
    val shown = all.firstOrNull { it.runningSince != null } ?: all.firstOrNull()
    val nm = NotificationManagerCompat.from(context)
    if (shown == null || !nm.areNotificationsEnabled()) {
      nm.cancel(ID_TIMER)
      return
    }
    channel(context)
    val others = all.size - 1
    val open = PendingIntent.getActivity(
      context, 42,
      Intent(context, MainActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        .putExtra("megatron_action", "time"),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val b = NotificationCompat.Builder(context, CH_TIMER)
      .setSmallIcon(R.drawable.ic_stat_megatron)
      .setOngoing(true)
      .setSilent(true)
      .setContentIntent(open)
    val running = shown.runningSince
    if (running != null) {
      // Chrono qui monte, tenu par Android : départ fictif = maintenant moins le temps total déjà compté.
      b.setContentTitle("⏱ ${shown.name}")
        .setContentText(if (others > 0) "En cours · +$others autre${if (others > 1) "s" else ""}" else "En cours")
        .setWhen(running - shown.doneMs)
        .setShowWhen(true)
        .setUsesChronometer(true)
        .addAction(0, "Pause", action(context, TimerReceiver.PAUSE, shown.projectId, 20))
    } else {
      b.setContentTitle("⏸ ${shown.name} · en pause")
        .setContentText(clock(shown.doneMs))
        .setShowWhen(false)
        .addAction(0, "Reprendre", action(context, TimerReceiver.RESUME, shown.projectId, 21))
    }
    b.addAction(0, "Arrêter", action(context, TimerReceiver.STOP, shown.projectId, 22))
    try {
      nm.notify(ID_TIMER, b.build())
    } catch (e: SecurityException) {
    }
  }

  private fun closeOpen(context: Context, projectId: Long?) = Store.withDb(context, Unit) { db ->
    db.execSQL(
      "UPDATE time_entries SET ended_at = ? WHERE ended_at IS NULL AND project_id IS ?",
      arrayOf<Any?>(Store.toIso(System.currentTimeMillis()), projectId),
    )
  }

  fun pause(context: Context, projectId: Long?) = closeOpen(context, projectId)

  fun resume(context: Context, projectId: Long?) = Store.withDb(context, Unit) { db ->
    val open = db.rawQuery(
      "SELECT 1 FROM time_entries WHERE ended_at IS NULL AND ${sameProject(projectId)}",
      listOfNotNull(projectId?.toString()).toTypedArray(),
    ).use { it.moveToFirst() }
    if (!open) {
      db.execSQL(
        "INSERT INTO time_entries (project_id, started_at) VALUES (?, ?)",
        arrayOf<Any?>(projectId, Store.toIso(System.currentTimeMillis())),
      )
    }
  }

  /** Démarre (ou reprend) le minuteur d'un projet, comme le bouton « Démarrer » de l'appli. */
  fun start(context: Context, projectId: Long?) {
    Store.withDb(context, Unit) { db ->
      val exists = db.rawQuery("SELECT 1 FROM timers WHERE ${sameProject(projectId)}", listOfNotNull(projectId?.toString()).toTypedArray())
        .use { it.moveToFirst() }
      if (!exists) {
        db.execSQL(
          "INSERT INTO timers (project_id, created_at) VALUES (?, ?)",
          arrayOf<Any?>(projectId, Store.toIso(System.currentTimeMillis())),
        )
      }
    }
    resume(context, projectId)
  }

  /** Projet du dernier temps compté (pour « Démarrer » sur le widget), et son nom. */
  fun lastProject(context: Context): Pair<Long?, String> = Store.withDb(context, null as Long? to "Sans projet") { db ->
    db.rawQuery(
      "SELECT e.project_id, p.name FROM time_entries e LEFT JOIN projects p ON p.id = e.project_id ORDER BY e.started_at DESC LIMIT 1",
      null,
    ).use { c ->
      if (!c.moveToFirst() || c.isNull(0)) null as Long? to "Sans projet"
      else c.getLong(0) to (if (c.isNull(1)) "Sans projet" else c.getString(1))
    }
  }

  fun stop(context: Context, projectId: Long?) {
    closeOpen(context, projectId)
    Store.withDb(context, Unit) { db -> db.execSQL("DELETE FROM timers WHERE project_id IS ?", arrayOf<Any?>(projectId)) }
  }
}

/** Boutons Pause / Reprendre / Arrêter de la notification du minuteur. */
class TimerReceiver : BroadcastReceiver() {
  companion object {
    const val PAUSE = "app.megatron.TIMER_PAUSE"
    const val RESUME = "app.megatron.TIMER_RESUME"
    const val STOP = "app.megatron.TIMER_STOP"
    const val START = "app.megatron.TIMER_START"
  }

  override fun onReceive(context: Context, intent: Intent) {
    val raw = intent.getLongExtra("project", -1L)
    val projectId = if (raw < 0) null else raw
    val pending = goAsync()
    Thread {
      try {
        when (intent.action) {
          PAUSE -> TimerNotif.pause(context, projectId)
          RESUME -> TimerNotif.resume(context, projectId)
          STOP -> TimerNotif.stop(context, projectId)
          START -> TimerNotif.start(context, projectId)
        }
        TimerNotif.refresh(context)
        TimerWidget.refreshAll(context)
        WeekWidget.refreshAll(context)
        MainActivity.resync()
      } finally {
        pending.finish()
      }
    }.start()
  }
}
