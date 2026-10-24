package app.megatron.desktop

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews

/**
 * Widget « Aujourd'hui » de l'écran d'accueil. Il s'adapte à la taille choisie :
 * - très petit : le nombre de tâches restantes ;
 * - étroit ou bas : le nombre et la prochaine tâche ;
 * - plus grand : en-tête et autant de tâches que la hauteur le permet, à cocher d'un toucher.
 * Aucune mise à jour périodique : il est redessiné quand les données changent (appli, notification, minuit).
 */
object Widget {
  const val ACTION_ADD = "add"
  private const val HEADER_DP = 42 // en-tête + marge
  private const val PADDING_DP = 24
  private const val ROW_DP = 48 // ligne + espacement

  fun refreshAll(context: Context) {
    val manager = AppWidgetManager.getInstance(context)
    val ids = manager.getAppWidgetIds(ComponentName(context, WidgetProvider::class.java))
    if (ids.isEmpty()) return
    val tasks = Store.todayTasks(context)
    for (id in ids) manager.updateAppWidget(id, build(context, tasks, manager.getAppWidgetOptions(id)))
  }

  fun refreshOne(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) {
    manager.updateAppWidget(id, build(context, Store.todayTasks(context), options))
  }

  /** Taille réelle en dp (portrait : largeur minimale et hauteur maximale proposées par le lanceur). */
  private fun size(options: Bundle): Pair<Int, Int> {
    val w = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 250)
    val h = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 180)
    return w to h
  }

  private fun build(context: Context, tasks: List<Store.TaskRow>, options: Bundle): RemoteViews {
    val (w, h) = size(options)
    return if (w < 150 || h < 110) small(context, tasks, w, h) else list(context, tasks, h)
  }

  private fun openApp(context: Context, action: String?, request: Int): PendingIntent =
    PendingIntent.getActivity(
      context, request,
      Intent(context, MainActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        .apply { if (action != null) putExtra("megatron_action", action) },
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

  private fun plural(n: Int) = if (n > 1) "s" else ""

  private fun small(context: Context, tasks: List<Store.TaskRow>, w: Int, h: Int): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.widget_small)
    val n = tasks.size
    views.setTextViewText(R.id.small_count, if (n == 0) "✓" else n.toString())
    views.setTextViewText(R.id.small_label, if (n == 0) "Journée bouclée" else "à faire")
    // La prochaine tâche dès qu'il y a un peu de place (widget large mais bas, ou étroit mais haut).
    val roomForNext = n > 0 && (w >= 150 || h >= 110)
    views.setViewVisibility(R.id.small_next, if (roomForNext) View.VISIBLE else View.GONE)
    if (roomForNext) views.setTextViewText(R.id.small_next, tasks[0].title)
    views.setOnClickPendingIntent(R.id.widget_root, openApp(context, null, 60))
    return views
  }

  private fun list(context: Context, tasks: List<Store.TaskRow>, h: Int): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.widget_list)
    val n = tasks.size
    views.setTextViewText(R.id.widget_count, if (n == 0) "" else "$n à faire")
    views.setOnClickPendingIntent(R.id.widget_root, openApp(context, null, 60))
    views.setOnClickPendingIntent(R.id.widget_add, openApp(context, ACTION_ADD, 61))

    views.removeAllViews(R.id.widget_rows)
    views.setViewVisibility(R.id.widget_empty, if (n == 0) View.VISIBLE else View.GONE)
    views.setViewVisibility(R.id.widget_rows, if (n == 0) View.GONE else View.VISIBLE)

    val fit = ((h - HEADER_DP - PADDING_DP) / ROW_DP).coerceAtLeast(1)
    val shown = tasks.take(if (n > fit) (fit - 1).coerceAtLeast(1) else fit)
    shown.forEachIndexed { i, t ->
      val row = RemoteViews(context.packageName, R.layout.widget_row)
      row.setTextViewText(R.id.row_title, t.title)
      row.setTextViewText(R.id.row_meta, if (t.late) "en retard" else t.project ?: "")
      row.setTextColor(R.id.row_meta, context.getColor(if (t.late) R.color.widget_danger else R.color.widget_muted))
      row.setImageViewResource(R.id.row_check_icon, if (t.late) R.drawable.widget_check_late else R.drawable.widget_check)
      // Toucher le rond : tâche faite, sans ouvrir l'appli (même récepteur que la notification).
      row.setOnClickPendingIntent(R.id.row_check, Notifs.action(context, ActionReceiver.TASK_DONE, t.id, 7000 + i))
      row.setOnClickPendingIntent(R.id.row_root, openApp(context, null, 60))
      views.addView(R.id.widget_rows, row)
    }
    // Plus de tâches que de place : une dernière ligne « + N autres » qui ouvre l'appli.
    if (n > shown.size) {
      val more = RemoteViews(context.packageName, R.layout.widget_row)
      more.setTextViewText(R.id.row_title, "+ ${n - shown.size} autre${plural(n - shown.size)}")
      more.setTextColor(R.id.row_title, context.getColor(R.color.widget_muted))
      more.setTextViewText(R.id.row_meta, "")
      more.setViewVisibility(R.id.row_check, View.INVISIBLE)
      more.setOnClickPendingIntent(R.id.row_root, openApp(context, null, 60))
      views.addView(R.id.widget_rows, more)
    }
    return views
  }
}

class WidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    val pending = goAsync()
    Thread {
      try {
        Widget.refreshAll(context)
      } finally {
        pending.finish()
      }
    }.start()
  }

  /** Redimensionné : on recalcule le nombre de lignes pour la nouvelle taille. */
  override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: Bundle) {
    val pending = goAsync()
    Thread {
      try {
        Widget.refreshOne(context, manager, id, options)
      } finally {
        pending.finish()
      }
    }.start()
  }
}
