package app.megatron.desktop

import android.content.Context
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

  private fun path(context: Context): String? {
    val path = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("db_path", null) ?: return null
    return path.takeIf { java.io.File(it).exists() }
  }

  /** Un accès à la base, par le même SQLite que l'appli (voir NativeDb) ; `default` si la base est absente ou en erreur. */
  fun <T> withDb(context: Context, default: T, block: (Db) -> T): T {
    val path = path(context) ?: return default
    return try {
      block(Db(path))
    } catch (e: Throwable) {
      android.util.Log.w("Megatron", "base : ${e.message}")
      default
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

  /**
   * « Replanifier » : la tâche passe à demain. Une échéance d'aujourd'hui (ou dépassée) suit aussi,
   * sinon la tâche resterait dans « aujourd'hui » et la notification la réafficherait aussitôt.
   */
  fun replanTomorrow(context: Context, id: Long) = withDb(context, Unit) { db ->
    val tomorrow = tomorrow()
    db.execSQL(
      "UPDATE tasks SET planned_date = ?, due_date = CASE WHEN due_date IS NOT NULL AND due_date < ? THEN ? ELSE due_date END WHERE id = ?",
      arrayOf<Any>(tomorrow, tomorrow, tomorrow, id),
    )
  }

  fun setting(context: Context, key: String): String? = withDb(context, null) { db ->
    db.rawQuery("SELECT value FROM settings WHERE key = ?", arrayOf(key)).use { c -> if (c.moveToFirst()) c.getString(0) else null }
  }

  // ---------- Rappels ----------

  /**
   * Un rappel. `days` : jours choisis (0 = dimanche … 6 = samedi) pour repeat = « days » ;
   * `everyMin` / `until` : répétition dans la journée ; `start` : heure du premier rappel de chaque journée.
   */
  data class Reminder(
    val id: Long,
    val title: String,
    val dueAt: Long,
    val repeat: String,
    val ring: Boolean = false,
    val days: Set<Int> = emptySet(),
    val everyMin: Int = 0,
    val until: String = "",
    val start: String = "",
    val notified: Boolean = false,
  )

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
    // Colonnes ajoutées par des mises à jour de la base : tant que l'appli ne les a pas créées, on fait sans.
    val rows = listOf(
      "SELECT id, title, due_at, repeat, ring, days, every_min, until_time, start_time, notified_at FROM reminders WHERE done = 0",
      "SELECT id, title, due_at, repeat, ring FROM reminders WHERE done = 0",
      "SELECT id, title, due_at, repeat FROM reminders WHERE done = 0",
    ).firstNotNullOf { sql -> try { db.rawQuery(sql, null) } catch (e: Exception) { null } }
    rows.use { c ->
      while (c.moveToNext()) {
        val dueIso = c.getString(2)
        val due = parseIso(dueIso) ?: continue
        val full = c.columnCount > 5
        list.add(
          Reminder(
            id = c.getLong(0),
            title = c.getString(1),
            dueAt = due,
            repeat = c.getString(3).ifEmpty { "none" },
            ring = c.columnCount > 4 && c.getInt(4) == 1,
            days = if (full) c.getString(5).split(",").mapNotNull { it.trim().toIntOrNull() }.toSet() else emptySet(),
            everyMin = if (full) c.getInt(6) else 0,
            until = if (full) c.getString(7) else "",
            start = if (full) c.getString(8) else "",
            notified = full && !c.isNull(9) && c.getString(9) == dueIso,
          ),
        )
      }
    }
    list
  }

  fun reminder(context: Context, id: Long): Reminder? = pendingReminders(context).firstOrNull { it.id == id }

  private fun minutesOf(hhmm: String): Int {
    val parts = hhmm.split(":")
    return (parts.getOrNull(0)?.toIntOrNull() ?: 0) * 60 + (parts.getOrNull(1)?.toIntOrNull() ?: 0)
  }

  private fun allowed(r: Reminder, cal: Calendar): Boolean {
    val dow = cal.get(Calendar.DAY_OF_WEEK) // 1 = dimanche
    return when (r.repeat) {
      "weekdays" -> dow != Calendar.SATURDAY && dow != Calendar.SUNDAY
      "days" -> r.days.contains(dow - 1)
      else -> true
    }
  }

  /**
   * Prochaine occurrence après `now`, ou null si le rappel est terminé (mêmes règles que nextOccurrence dans db.ts) :
   * toutes les N minutes jusqu'à l'heure de fin, puis le jour suivant permis, à l'heure de départ.
   */
  fun nextOccurrence(r: Reminder, from: Long, now: Long = System.currentTimeMillis()): Long? {
    val cal = Calendar.getInstance().apply { timeInMillis = from }
    val start = if (r.start.isNotEmpty()) minutesOf(r.start) else cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)
    val end = if (r.until.isNotEmpty()) minutesOf(r.until) else 23 * 60 + 59
    for (guard in 0 until 2000) {
      if (r.everyMin > 0) {
        val c = Calendar.getInstance().apply { timeInMillis = cal.timeInMillis; add(Calendar.MINUTE, r.everyMin) }
        val sameDay = c.get(Calendar.YEAR) == cal.get(Calendar.YEAR) && c.get(Calendar.DAY_OF_YEAR) == cal.get(Calendar.DAY_OF_YEAR)
        if (sameDay && c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE) <= end) {
          cal.timeInMillis = c.timeInMillis
          if (cal.timeInMillis > now) return cal.timeInMillis
          continue
        }
      }
      when (r.repeat) {
        "none" -> return null
        "weekly" -> cal.add(Calendar.DAY_OF_YEAR, 7)
        "monthly" -> cal.add(Calendar.MONTH, 1)
        else -> {
          var i = 0
          do cal.add(Calendar.DAY_OF_YEAR, 1) while (!allowed(r, cal) && ++i < 8)
        }
      }
      cal.set(Calendar.HOUR_OF_DAY, start / 60)
      cal.set(Calendar.MINUTE, start % 60)
      cal.set(Calendar.SECOND, 0)
      cal.set(Calendar.MILLISECOND, 0)
      if (cal.timeInMillis > now) return cal.timeInMillis
    }
    return null
  }

  /** Dernier créneau échu d'un rappel « toutes les N min » (il resonne même sans « Fait »). */
  private fun currentSlot(r: Reminder, now: Long): Long {
    var slot = r.dueAt
    while (true) {
      val next = nextOccurrence(r, slot, slot) ?: break
      if (next > now) break
      slot = next
    }
    return slot
  }

  /** Avant de sonner : un rappel « toutes les N min » passe au créneau du moment. */
  fun catchUp(context: Context, r: Reminder): Reminder {
    if (r.everyMin <= 0) return r
    val slot = currentSlot(r, System.currentTimeMillis())
    if (slot == r.dueAt) return r
    withDb(context, Unit) { db -> db.execSQL("UPDATE reminders SET due_at = ?, notified_at = NULL WHERE id = ?", arrayOf(toIso(slot), r.id)) }
    return r.copy(dueAt = slot, notified = false)
  }

  /** « Fait » : un rappel terminé, ou la prochaine fois pour un rappel répété. */
  fun completeReminder(context: Context, id: Long) = withDb(context, Unit) { db ->
    val r = reminder(context, id) ?: return@withDb
    val next = nextOccurrence(r, r.dueAt)
    if (next == null) {
      db.execSQL("UPDATE reminders SET done = 1 WHERE id = ?", arrayOf(id))
    } else {
      db.execSQL("UPDATE reminders SET due_at = ?, notified_at = NULL WHERE id = ?", arrayOf(toIso(next), id))
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
    db.insert(
      "INSERT INTO focus_sessions (project_id, started_at, planned_minutes, budget_minutes, mode) VALUES (NULL, ?, ?, 0, ?)",
      arrayOf<Any?>(now, minutes.toLong(), mode),
    )
  }

  /** Arrêt avant la fin : la session n'est pas comptée comme réussie. */
  fun stopFocus(context: Context, id: Long) = withDb(context, Unit) { db ->
    db.execSQL(
      "UPDATE focus_sessions SET ended_at = ?, completed = 0 WHERE id = ? AND ended_at IS NULL",
      arrayOf<Any>(toIso(System.currentTimeMillis()), id),
    )
  }
}
