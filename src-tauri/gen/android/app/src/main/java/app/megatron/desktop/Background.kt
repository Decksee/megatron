package app.megatron.desktop

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlarmManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat

/**
 * Guide « fonctionnement en arrière-plan » : ce qu'Android autorise déjà, et les réglages à ouvrir
 * pour que rappels, notifications et widgets marchent appli fermée (Samsung, Tecno / Infinix / itel…).
 */
object Background {
  fun brand(): String = Build.MANUFACTURER.lowercase()

  fun status(context: Context): Map<String, Any> {
    val power = context.getSystemService(PowerManager::class.java)
    val alarms = context.getSystemService(AlarmManager::class.java)
    return mapOf(
      "brand" to brand(),
      "notifications" to NotificationManagerCompat.from(context).areNotificationsEnabled(),
      "battery" to power.isIgnoringBatteryOptimizations(context.packageName),
      "exactAlarms" to (Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms()),
    )
  }

  private fun tryStart(activity: Activity, intent: Intent): Boolean = try {
    activity.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    true
  } catch (e: Exception) {
    false
  }

  private fun appDetails(context: Context) =
    Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))

  /** Demande directe d'Android : « Autoriser Mégatron à toujours fonctionner en arrière-plan ? ». */
  @SuppressLint("BatteryLife")
  fun openBattery(activity: Activity) {
    val ask = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${activity.packageName}"))
    if (!tryStart(activity, ask)) tryStart(activity, Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
  }

  fun openNotifications(activity: Activity) {
    val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName)
    if (!tryStart(activity, intent)) tryStart(activity, appDetails(activity))
  }

  /**
   * Réglages propres à la marque : démarrage automatique (Tecno, Infinix, itel, Xiaomi…).
   * Sinon (Samsung compris), la fiche de l'appli dans les réglages.
   */
  fun openBrandSettings(activity: Activity) {
    val candidates = when {
      // Samsung : la fiche de l'appli (Batterie → Non restreinte), atteinte par le repli ci-dessous.
      brand().contains("samsung") -> emptyList()
      brand().let { it.contains("tecno") || it.contains("infinix") || it.contains("itel") || it.contains("transsion") } -> listOf(
        ComponentName("com.transsion.phonemaster", "com.cyin.himgr.autostart.AutoStartActivity"),
        ComponentName("com.transsion.phonemaster", "com.cyin.himgr.applicationmanager.view.activities.AppManagerActivity"),
      )
      brand().contains("xiaomi") || brand().contains("redmi") -> listOf(
        ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"),
      )
      brand().contains("oppo") || brand().contains("realme") -> listOf(
        ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
      )
      brand().contains("vivo") -> listOf(
        ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
      )
      brand().contains("huawei") || brand().contains("honor") -> listOf(
        ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
      )
      else -> emptyList()
    }
    for (c in candidates) if (tryStart(activity, Intent().setComponent(c))) return
    tryStart(activity, appDetails(activity))
  }
}
