package app.megatron.desktop

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.widget.RemoteViews
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/** Durée lisible : « 2 h 05 », « 45 min ». */
private fun duration(ms: Long): String {
  val min = ms / 60_000
  return if (min >= 60) "${min / 60} h ${(min % 60).toString().padStart(2, '0')}" else "$min min"
}

/** Redessin des widgets à la pose et au redimensionnement ; ensuite seulement quand les données changent. */
private fun async(pending: android.content.BroadcastReceiver.PendingResult, work: () -> Unit) {
  Thread {
    try {
      work()
    } finally {
      pending.finish()
    }
  }.start()
}

// ---------- Minuteur ----------

/** Widget Minuteur : chrono du temps de travail en cours, Pause / Reprendre / Arrêter, ou Démarrer sur le dernier projet. */
object TimerWidget {
  fun refreshAll(context: Context) = updateAll(context, TimerWidgetProvider::class.java) { build(context, it) }

  private fun clock(ms: Long): String {
    val s = ms / 1000
    return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, s / 60 % 60, s % 60) else "%02d:%02d".format(s / 60, s % 60)
  }

  fun build(context: Context, options: Bundle): RemoteViews {
    val (w, h) = Widget.size(options)
    val row = h < ONE_ROW_DP
    val v = RemoteViews(context.packageName, if (row) R.layout.widget_timer_row else R.layout.widget_timer)
    v.setOnClickPendingIntent(R.id.widget_root, Widget.openApp(context, "time", 67))
    val all = TimerNotif.timers(context)
    val shown = all.firstOrNull { it.runningSince != null } ?: all.firstOrNull()
    val narrow = w < 170
    v.setViewVisibility(R.id.timer_sub, if (row || narrow) View.GONE else View.VISIBLE)

    if (shown == null) {
      // Aucun minuteur : on propose de reprendre le dernier projet travaillé.
      val (pid, name) = TimerNotif.lastProject(context)
      v.setTextViewText(R.id.timer_label, "⏱ Minuteur")
      v.setViewVisibility(R.id.timer_chrono, View.GONE)
      v.setViewVisibility(R.id.timer_static, View.VISIBLE)
      v.setTextViewText(R.id.timer_static, "00:00")
      v.setTextViewText(R.id.timer_sub, "Sur : $name")
      v.setTextViewText(R.id.timer_main, if (row) "▶" else "▶  Démarrer")
      v.setOnClickPendingIntent(R.id.timer_main, TimerNotif.action(context, TimerReceiver.START, pid, 30))
      v.setViewVisibility(R.id.timer_stop, View.GONE)
      return v
    }

    val running = shown.runningSince
    val others = all.size - 1
    v.setTextViewText(R.id.timer_label, (if (running != null) "⏱ " else "⏸ ") + shown.name)
    if (running != null) {
      // Chrono qui monte, tenu par Android : aucun code ne tourne pendant que le minuteur compte.
      val elapsed = shown.doneMs + (System.currentTimeMillis() - running)
      v.setViewVisibility(R.id.timer_static, View.GONE)
      v.setViewVisibility(R.id.timer_chrono, View.VISIBLE)
      v.setChronometer(R.id.timer_chrono, SystemClock.elapsedRealtime() - elapsed, null, true)
      v.setTextViewText(R.id.timer_sub, if (others > 0) "En cours · +$others autre${if (others > 1) "s" else ""}" else "En cours")
      v.setTextViewText(R.id.timer_main, if (row || narrow) "⏸" else "⏸  Pause")
      v.setOnClickPendingIntent(R.id.timer_main, TimerNotif.action(context, TimerReceiver.PAUSE, shown.projectId, 31))
    } else {
      v.setViewVisibility(R.id.timer_chrono, View.GONE)
      v.setViewVisibility(R.id.timer_static, View.VISIBLE)
      v.setTextViewText(R.id.timer_static, clock(shown.doneMs))
      v.setTextViewText(R.id.timer_sub, "En pause")
      v.setTextViewText(R.id.timer_main, if (row || narrow) "▶" else "▶  Reprendre")
      v.setOnClickPendingIntent(R.id.timer_main, TimerNotif.action(context, TimerReceiver.RESUME, shown.projectId, 32))
    }
    v.setViewVisibility(R.id.timer_stop, View.VISIBLE)
    v.setTextViewText(R.id.timer_stop, if (row || narrow) "■" else "■  Arrêter")
    v.setOnClickPendingIntent(R.id.timer_stop, TimerNotif.action(context, TimerReceiver.STOP, shown.projectId, 33))
    return v
  }
}

class TimerWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = async(goAsync()) { TimerWidget.refreshAll(context) }

  override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) =
    async(goAsync()) { manager.updateAppWidget(id, TimerWidget.build(context, options)) }
}

// ---------- Ajout rapide ----------

/** Widget Ajout rapide : « + Tâche » ouvre l'ajout, le micro ouvre l'assistant prêt à écouter. */
object QuickWidget {
  fun refreshAll(context: Context) = updateAll(context, QuickWidgetProvider::class.java) { build(context, it) }

  fun build(context: Context, options: Bundle): RemoteViews {
    val (w, _) = Widget.size(options)
    val v = RemoteViews(context.packageName, R.layout.widget_quick)
    v.setOnClickPendingIntent(R.id.quick_add, Widget.openApp(context, Widget.ACTION_ADD, 64))
    v.setOnClickPendingIntent(R.id.quick_voice, Widget.openApp(context, "voice", 65))
    v.setOnClickPendingIntent(R.id.widget_root, Widget.openApp(context, Widget.ACTION_ADD, 64))
    when {
      // Une case : juste le « + ».
      w < 110 -> {
        v.setViewVisibility(R.id.quick_voice, View.GONE)
        v.setTextViewText(R.id.quick_add, "+")
        v.setFloat(R.id.quick_add, "setTextSize", 28f)
      }
      // Deux cases : « + » et micro, sans texte.
      w < 220 -> {
        v.setTextViewText(R.id.quick_add, "+")
        v.setFloat(R.id.quick_add, "setTextSize", 26f)
        v.setTextViewText(R.id.quick_voice, "🎙")
        v.setFloat(R.id.quick_voice, "setTextSize", 22f)
      }
    }
    return v
  }
}

class QuickWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = async(goAsync()) { QuickWidget.refreshAll(context) }

  override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) =
    async(goAsync()) { manager.updateAppWidget(id, QuickWidget.build(context, options)) }
}

// ---------- Argent ----------

/** Widget Argent : reste à encaisser (par devise), encaissé ce mois-ci, prochaine deadline de projet. */
object MoneyWidget {
  fun refreshAll(context: Context) = updateAll(context, MoneyWidgetProvider::class.java) { build(context, it) }

  private fun money(value: Double, currency: String): String {
    val n = NumberFormat.getIntegerInstance(Locale.FRANCE).format(Math.round(value))
    return if (currency == "XOF") "$n FCFA" else "$n €"
  }

  private fun line(byCurrency: Map<String, Double>): String =
    byCurrency.entries.filter { it.value > 0.5 }.sortedByDescending { it.value }.joinToString(" · ") { money(it.value, it.key) }.ifEmpty { "0 €" }

  private data class Totals(val owed: Map<String, Double>, val month: Map<String, Double>, val deadline: String?, val late: Boolean, val open: Int)

  private fun totals(context: Context): Totals = Store.withDb(context, Totals(emptyMap(), emptyMap(), null, false, 0)) { db ->
    val owed = mutableMapOf<String, Double>()
    var open = 0
    db.rawQuery(
      """SELECT p.price, p.currency, p.status,
           COALESCE((SELECT SUM(price) FROM extras x WHERE x.project_id = p.id), 0),
           COALESCE((SELECT SUM(amount) FROM payments y WHERE y.project_id = p.id), 0)
         FROM projects p""",
      null,
    ).use { c ->
      while (c.moveToNext()) {
        val remaining = c.getDouble(0) + c.getDouble(3) - c.getDouble(4)
        if (remaining > 0) owed[c.getString(1)] = (owed[c.getString(1)] ?: 0.0) + remaining
        if (c.getString(2) in setOf("todo", "active", "paused")) open++
      }
    }
    val month = mutableMapOf<String, Double>()
    val monthStart = SimpleDateFormat("yyyy-MM-01", Locale.US).format(Calendar.getInstance().time)
    db.rawQuery(
      "SELECT p.currency, SUM(y.amount) FROM payments y JOIN projects p ON p.id = y.project_id WHERE y.paid_on >= ? GROUP BY p.currency",
      arrayOf(monthStart),
    ).use { c -> while (c.moveToNext()) month[c.getString(0)] = c.getDouble(1) }
    val today = Store.isoDay()
    var deadline: String? = null
    var late = false
    db.rawQuery(
      "SELECT name, deadline FROM projects WHERE status IN ('todo','active','paused') AND deadline IS NOT NULL ORDER BY deadline LIMIT 1",
      null,
    ).use { c ->
      if (c.moveToFirst()) {
        val day = c.getString(1)
        late = day < today
        val date = SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(day)
        val label = if (date != null) SimpleDateFormat("d MMM", Locale.FRANCE).format(date) else day
        deadline = "${c.getString(0)} · $label${if (late) " · en retard" else ""}"
      }
    }
    Totals(owed, month, deadline, late, open)
  }

  fun build(context: Context, options: Bundle): RemoteViews {
    val (_, h) = Widget.size(options)
    val row = h < ONE_ROW_DP
    val v = RemoteViews(context.packageName, R.layout.widget_money)
    v.setOnClickPendingIntent(R.id.widget_root, Widget.openApp(context, "projects", 66))
    val t = totals(context)
    // Études ou perso : pas d'argent en jeu, on montre les projets en cours et le prochain rendu.
    val freelance = Store.setting(context, "usage").let { it == null || it == "freelance" }
    if (freelance) {
      v.setTextViewText(R.id.money_label, "Reste à encaisser")
      val owed = t.owed.entries.filter { it.value > 0.5 }.sortedByDescending { it.value }
      v.setTextViewText(R.id.money_big, if (owed.isEmpty()) "Tout est payé ✓" else money(owed[0].value, owed[0].key))
      v.setTextViewText(R.id.money_sub, owed.drop(1).joinToString(" · ") { money(it.value, it.key) })
      v.setTextViewText(R.id.money_month, "Encaissé ce mois : ${line(t.month)}")
    } else {
      v.setTextViewText(R.id.money_label, "Projets en cours")
      v.setTextViewText(R.id.money_big, "${t.open}")
      v.setTextViewText(R.id.money_sub, "")
      v.setTextViewText(R.id.money_month, "")
    }
    v.setTextViewText(R.id.money_deadline, t.deadline?.let { "⏳ $it" } ?: "Aucune deadline")
    v.setTextColor(R.id.money_deadline, context.getColor(if (t.late) R.color.widget_danger else R.color.widget_text))
    // Une seule rangée : le montant seul. Sinon les lignes qui ont du contenu.
    v.setViewVisibility(R.id.money_sub, if (row || !freelance || t.owed.size < 2) View.GONE else View.VISIBLE)
    v.setViewVisibility(R.id.money_month, if (row || !freelance) View.GONE else View.VISIBLE)
    v.setViewVisibility(R.id.money_deadline, if (row || h < 170) View.GONE else View.VISIBLE)
    return v
  }
}

class MoneyWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = async(goAsync()) { MoneyWidget.refreshAll(context) }

  override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) =
    async(goAsync()) { manager.updateAppWidget(id, MoneyWidget.build(context, options)) }
}

// ---------- Ma semaine ----------

/** Widget Ma semaine : temps travaillé jour par jour (lundi → dimanche), total, et la journée en cours. */
object WeekWidget {
  fun refreshAll(context: Context) = updateAll(context, WeekWidgetProvider::class.java) { build(context, it) }

  /** Temps travaillé chaque jour de la semaine en cours (index 0 = lundi). */
  private fun perDay(context: Context): LongArray {
    val days = LongArray(7)
    val cal = Calendar.getInstance().apply {
      firstDayOfWeek = Calendar.MONDAY
      set(Calendar.DAY_OF_WEEK, Calendar.MONDAY)
      set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }
    if (cal.timeInMillis > System.currentTimeMillis()) cal.add(Calendar.DAY_OF_YEAR, -7)
    val weekStart = cal.timeInMillis
    val now = System.currentTimeMillis()
    Store.withDb(context, Unit) { db ->
      db.rawQuery(
        "SELECT started_at, ended_at FROM time_entries WHERE ended_at IS NULL OR ended_at >= ?",
        arrayOf(Store.toIso(weekStart)),
      ).use { c ->
        while (c.moveToNext()) {
          val start = Store.parseIso(c.getString(0)) ?: continue
          val end = if (c.isNull(1)) now else Store.parseIso(c.getString(1)) ?: continue
          for (i in 0 until 7) {
            val from = weekStart + i * 86_400_000L
            val to = from + 86_400_000L
            val overlap = minOf(end, to) - maxOf(start, from)
            if (overlap > 0) days[i] += overlap
          }
        }
      }
    }
    return days
  }

  private fun doneToday(context: Context): Int = Store.withDb(context, 0) { db ->
    db.rawQuery(
      "SELECT COUNT(*) FROM tasks WHERE done = 1 AND date(completed_at, 'localtime') = date('now', 'localtime')",
      null,
    ).use { c -> if (c.moveToFirst()) c.getInt(0) else 0 }
  }

  /** Barres dessinées à la taille réelle du widget : nettes à toutes les tailles. */
  private fun chart(context: Context, days: LongArray, wDp: Int, hDp: Int): Bitmap {
    val density = context.resources.displayMetrics.density
    val width = (wDp * density).toInt().coerceIn(120, 900)
    val height = (hDp * density).toInt().coerceIn(60, 500)
    val bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bmp)
    val accent = context.getColor(R.color.widget_accent)
    val muted = context.getColor(R.color.widget_muted)
    val track = context.getColor(R.color.widget_line)
    val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = muted; textSize = 11 * density; textAlign = Paint.Align.CENTER
    }
    val bar = Paint(Paint.ANTI_ALIAS_FLAG)
    val labels = arrayOf("L", "M", "M", "J", "V", "S", "D")
    val today = (Calendar.getInstance().get(Calendar.DAY_OF_WEEK) + 5) % 7
    val max = maxOf(days.maxOrNull() ?: 0L, 3_600_000L).toFloat()
    val labelH = 16 * density
    val slot = width / 7f
    val barW = minOf(slot * 0.5f, 22 * density)
    val chartH = height - labelH
    for (i in 0 until 7) {
      val cx = slot * i + slot / 2
      // Rail discret sur toute la hauteur, puis la barre du temps travaillé par-dessus.
      bar.color = track
      canvas.drawRoundRect(RectF(cx - barW / 2, 0f, cx + barW / 2, chartH), barW / 2, barW / 2, bar)
      val v = days[i] / max
      if (v > 0) {
        val top = chartH - maxOf(chartH * v, barW)
        bar.color = if (i == today) accent else (accent and 0x00FFFFFF) or (0x99 shl 24)
        canvas.drawRoundRect(RectF(cx - barW / 2, top, cx + barW / 2, chartH), barW / 2, barW / 2, bar)
      }
      text.color = if (i == today) accent else muted
      text.isFakeBoldText = i == today
      canvas.drawText(labels[i], cx, height - 3 * density, text)
    }
    return bmp
  }

  fun build(context: Context, options: Bundle): RemoteViews {
    val (w, h) = Widget.size(options)
    val row = h < ONE_ROW_DP
    val v = RemoteViews(context.packageName, R.layout.widget_week)
    v.setOnClickPendingIntent(R.id.widget_root, Widget.openApp(context, "time", 67))
    val days = perDay(context)
    val todayIdx = (Calendar.getInstance().get(Calendar.DAY_OF_WEEK) + 5) % 7
    v.setTextViewText(R.id.week_total, duration(days.sum()))
    val left = Store.todayTasks(context).size
    val done = doneToday(context)
    v.setTextViewText(
      R.id.week_today,
      "Aujourd'hui : ${duration(days[todayIdx])} · $done/${done + left} tâche${if (done + left > 1) "s" else ""}",
    )
    if (row) {
      v.setViewVisibility(R.id.week_chart, View.GONE)
    } else {
      v.setViewVisibility(R.id.week_chart, View.VISIBLE)
      // Place laissée au graphique : hauteur du widget moins l'en-tête, la ligne du bas et les marges.
      v.setImageViewBitmap(R.id.week_chart, chart(context, days, w - 28, (h - 28 - 24 - 26).coerceAtLeast(50)))
    }
    return v
  }
}

class WeekWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = async(goAsync()) { WeekWidget.refreshAll(context) }

  override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) =
    async(goAsync()) { manager.updateAppWidget(id, WeekWidget.build(context, options)) }
}
