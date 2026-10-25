package app.megatron.desktop

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Accès direct à la base SQLite de Mégatron, pour que les notifications et les alarmes marchent
 * appli fermée (boutons « Fait », « Replanifier », rappels…). Mêmes règles que l'interface.
 */
object Store {
  private const val PREFS = "megatron"

  fun setDbPath(context: Context, path: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("db_path", path).apply()
  }

  private fun open(context: Context): SQLiteDatabase? {
    val path = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("db_path", null) ?: return null
    if (!java.io.File(path).exists()) return null
    return try {
      // Sans table « android_metadata » (NO_LOCALIZED_COLLATORS) et en WAL comme l'appli : Android n'écrit rien
      // en ouvrant la base et ne change pas son mode, donc il ne la verrouille pas pendant un enregistrement.
      SQLiteDatabase.openDatabase(
        path, null,
        SQLiteDatabase.OPEN_READWRITE or SQLiteDatabase.NO_LOCALIZED_COLLATORS or SQLiteDatabase.ENABLE_WRITE_AHEAD_LOGGING,
      )
    } catch (e: Exception) {
      null
    }
  }

  fun <T> withDb(context: Context, default: T, block: (SQLiteDatabase) -> T): T {
    val db = open(context) ?: return default
    return try {
      block(db)
    } catch (e: Exception) {
      default
    } finally {
      db.close()
    }
  }

  fun isoDay(cal: Calendar = Calendar.getInstance()): String =
    SimpleDateFormat("yyyy-MM-dd", Locale.US).format(cal.time)

  fun tomorrow(): String = isoDay(Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, 1) })

  data class TaskRow(val id: Long, val title: String, val project: String?, val dueDate: String?, val late: Boolean)

  /** Tâches de la journée : prévues aujourd'hui (ou reportées) ou à rendre aujourd'hui / en retard. Retards d'abord. */
  fun todayTasks(context: Context): List<TaskRow> = withDb(context, emptyList()) { db ->
    val today = isoDay()
    val rows = mutableListOf<TaskRow>()
    db.rawQuery(
      """SELECT t.id, t.title, p.name, t.due_date FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
         WHERE t.done = 0 AND ((t.planned_date IS NOT NULL AND t.planned_date <= ?) OR (t.due_date IS NOT NULL AND t.due_date <= ?))
         ORDER BY (t.due_date IS NOT NULL AND t.due_date < ?) DESC, COALESCE(t.planned_date, t.due_date), t.created_at DESC""",
      arrayOf(today, today, today),
    ).use { c ->
      while (c.moveToNext()) {
        val due = if (c.isNull(3)) null else c.getString(3)
        rows.add(TaskRow(c.getLong(0), c.getString(1), if (c.isNull(2)) null else c.getString(2), due, due != null && due < today))
      }
    }
    rows
  }

  fun markDone(context: Context, id: Long) = withDb(context, Unit) { db ->
    db.execSQL("UPDATE tasks SET done = 1, completed_at = datetime('now') WHERE id = ?", arrayOf(id))
  }

  fun replanTomorrow(context: Context, id: Long) = withDb(context, Unit) { db ->
    db.execSQL("UPDATE tasks SET planned_date = ? WHERE id = ?", arrayOf(tomorrow(), id))
  }

  fun setting(context: Context, key: String): String? = withDb(context, null) { db ->
    db.rawQuery("SELECT value FROM settings WHERE key = ?", arrayOf(key)).use { c -> if (c.moveToFirst()) c.getString(0) else null }
  }

  // ---------- Rappels ----------

  data class Reminder(val id: Long, val title: String, val dueAt: Long, val repeat: String)

  private fun isoFormat() = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }

  /** « 2026-10-24T08:30:00.000Z » → millisecondes. */
  fun parseIso(iso: String): Long? = try {
    isoFormat().parse(iso.substring(0, 19))?.time
  } catch (e: Exception) {
    null
  }

  fun toIso(ms: Long): String = isoFormat().format(Date(ms)) + ".000Z"

  fun pendingReminders(context: Context): List<Reminder> = withDb(context, emptyList()) { db ->
    val list = mutableListOf<Reminder>()
    db.rawQuery("SELECT id, title, due_at, repeat FROM reminders WHERE done = 0", null).use { c ->
      while (c.moveToNext()) {
        val due = parseIso(c.getString(2)) ?: continue
        list.add(Reminder(c.getLong(0), c.getString(1), due, c.getString(3) ?: "none"))
      }
    }
    list
  }

  fun reminder(context: Context, id: Long): Reminder? = pendingReminders(context).firstOrNull { it.id == id }

  /** Prochaine occurrence d'un rappel répété (mêmes règles que l'interface). */
  fun nextOccurrence(from: Long, repeat: String): Long {
    val cal = Calendar.getInstance().apply { timeInMillis = from }
    val now = System.currentTimeMillis()
    do {
      when (repeat) {
        "daily" -> cal.add(Calendar.DAY_OF_YEAR, 1)
        "weekdays" -> {
          do cal.add(Calendar.DAY_OF_YEAR, 1) while (cal.get(Calendar.DAY_OF_WEEK) == Calendar.SATURDAY || cal.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY)
        }
        "weekly" -> cal.add(Calendar.WEEK_OF_YEAR, 1)
        "monthly" -> cal.add(Calendar.MONTH, 1)
        else -> return from
      }
    } while (cal.timeInMillis <= now)
    return cal.timeInMillis
  }

  /** « Fait » : un rappel simple est terminé, un rappel répété passe à la prochaine fois. */
  fun completeReminder(context: Context, id: Long) = withDb(context, Unit) { db ->
    val r = reminder(context, id) ?: return@withDb
    if (r.repeat == "none") {
      db.execSQL("UPDATE reminders SET done = 1 WHERE id = ?", arrayOf(id))
    } else {
      db.execSQL("UPDATE reminders SET due_at = ?, notified_at = NULL WHERE id = ?", arrayOf(toIso(nextOccurrence(r.dueAt, r.repeat)), id))
    }
  }

  fun snoozeReminder(context: Context, id: Long, minutes: Int) = withDb(context, Unit) { db ->
    db.execSQL(
      "UPDATE reminders SET due_at = ?, notified_at = NULL WHERE id = ?",
      arrayOf(toIso(System.currentTimeMillis() + minutes * 60_000L), id),
    )
  }

  /** Marque le rappel comme notifié (l'interface ne le renverra pas une seconde fois). */
  fun markNotified(context: Context, id: Long) = withDb(context, Unit) { db ->
    db.execSQL("UPDATE reminders SET notified_at = due_at WHERE id = ?", arrayOf(id))
  }

  /** Rappels de la journée encore à venir (pour la ligne « Ensuite » de la notification). */
  fun nextReminderToday(context: Context): Reminder? {
    val now = System.currentTimeMillis()
    val end = Calendar.getInstance().apply {
      set(Calendar.HOUR_OF_DAY, 23); set(Calendar.MINUTE, 59); set(Calendar.SECOND, 59)
    }.timeInMillis
    return pendingReminders(context).filter { it.dueAt in now..end }.minByOrNull { it.dueAt }
  }

  /** Prochain rappel (même s'il est déjà passé et pas encore traité). */
  fun nextReminder(context: Context): Reminder? = pendingReminders(context).minByOrNull { it.dueAt }

  // ---------- Focus (widget) ----------

  data class Focus(val id: Long, val startedAt: Long, val plannedMinutes: Int, val pausedAt: Long?, val pausedMs: Long)

  /** Session de focus ouverte (en cours ou en pause), ou null. */
  fun openFocus(context: Context): Focus? = withDb(context, null) { db ->
    db.rawQuery(
      "SELECT id, started_at, planned_minutes, paused_at, paused_ms FROM focus_sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1",
      null,
    ).use { c ->
      if (!c.moveToFirst()) return@use null
      val started = parseIso(c.getString(1)) ?: return@use null
      Focus(c.getLong(0), started, c.getInt(2), if (c.isNull(3)) null else parseIso(c.getString(3)), c.getLong(4))
    }
  }

  /** Nouvelle session (mêmes règles que l'interface : une session ouverte à la fois). */
  fun startFocus(context: Context, minutes: Int, mode: String): Long = withDb(context, -1L) { db ->
    val now = toIso(System.currentTimeMillis())
    db.execSQL("UPDATE focus_sessions SET ended_at = ? WHERE ended_at IS NULL", arrayOf(now))
    db.compileStatement(
      "INSERT INTO focus_sessions (project_id, started_at, planned_minutes, budget_minutes, mode) VALUES (NULL, ?, ?, 0, ?)",
    ).use { st ->
      st.bindString(1, now)
      st.bindLong(2, minutes.toLong())
      st.bindString(3, mode)
      st.executeInsert()
    }
  }

  /** Arrêt avant la fin : la session n'est pas comptée comme réussie. */
  fun stopFocus(context: Context, id: Long) = withDb(context, Unit) { db ->
    db.execSQL(
      "UPDATE focus_sessions SET ended_at = ?, completed = 0 WHERE id = ? AND ended_at IS NULL",
      arrayOf<Any>(toIso(System.currentTimeMillis()), id),
    )
  }
}
