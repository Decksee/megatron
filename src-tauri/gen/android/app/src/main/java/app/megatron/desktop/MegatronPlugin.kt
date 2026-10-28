package app.megatron.desktop

import android.app.Activity
import android.content.Context
import android.content.Intent
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class FocusArgs {
  var sessionId: Long = 0
  var endsAt: Long = 0
  var block: Boolean = false
  var apps: Array<String> = arrayOf()
}

@InvokeArg
class PathArgs {
  lateinit var path: String
}

@InvokeArg
class UrlArgs {
  lateinit var url: String
}

@InvokeArg
class ShareArgs {
  lateinit var fileName: String
  lateinit var text: String
  var mimeType: String? = null
  var title: String? = null
}

/**
 * Fonctions natives Android de Mégatron, appelées depuis Rust (`native_call`).
 * Rien ne tourne ici en continu : chaque commande fait son travail puis rend la main.
 */
@TauriPlugin
class MegatronPlugin(private val activity: Activity) : Plugin(activity) {

  /** Chemin de la base SQLite (donné par Rust au lancement) : notifications et alarmes la lisent appli fermée. */
  @Command
  fun setDbPath(invoke: Invoke) {
    val args = invoke.parseArgs(PathArgs::class.java)
    Store.setDbPath(activity, args.path)
    invoke.resolve()
  }

  /** Les données ont changé : notification « tâche en cours », alarmes et widget sont remis à jour. */
  @Command
  fun refresh(invoke: Invoke) {
    val context = activity.applicationContext
    Thread {
      Alarms.scheduleAll(context)
      Notifs.refreshTask(context)
      TimerNotif.refresh(context)
      Widget.refreshAll(context)
    }.start()
    invoke.resolve()
  }

  // ---------- Focus ----------

  @InvokeArg
  class BarsArgs {
    var light: Boolean = false
  }

  /** Thème de l'interface (clair / sombre) : couleur des icônes des barres système. */
  @Command
  fun setSystemBars(invoke: Invoke) {
    (activity as? MainActivity)?.setLightBars(invoke.parseArgs(BarsArgs::class.java).light)
    invoke.resolve()
  }

  /** L'interface est prête : fin de l'écran de démarrage. */
  @Command
  fun appReady(invoke: Invoke) {
    MainActivity.ready = true
    invoke.resolve()
  }

  /** Action demandée en ouvrant l'appli (bouton « + » du widget), lue une seule fois. */
  @Command
  fun takeLaunchAction(invoke: Invoke) {
    val prefs = activity.getSharedPreferences("megatron", Context.MODE_PRIVATE)
    val res = JSObject()
    res.put("action", prefs.getString("launch_action", null))
    prefs.edit().remove("launch_action").apply()
    invoke.resolve(res)
  }

  @Command
  fun focusStart(invoke: Invoke) {
    val a = invoke.parseArgs(FocusArgs::class.java)
    FocusCtl.start(activity.applicationContext, a.sessionId, a.endsAt, a.block, a.apps.toSet())
    invoke.resolve()
  }

  @Command
  fun focusStop(invoke: Invoke) {
    FocusCtl.stop(activity.applicationContext)
    invoke.resolve()
  }

  /** Guide « arrière-plan » : marque du téléphone et autorisations déjà accordées. */
  @Command
  fun backgroundStatus(invoke: Invoke) {
    val res = JSObject()
    for ((k, v) in Background.status(activity)) res.put(k, v)
    invoke.resolve(res)
  }

  @InvokeArg
  class SettingsArgs {
    var which: String = "app"
  }

  /** Ouvre le bon écran de réglages : batterie, notifications, ou réglages propres à la marque. */
  @Command
  fun openBackgroundSettings(invoke: Invoke) {
    when (invoke.parseArgs(SettingsArgs::class.java).which) {
      "battery" -> Background.openBattery(activity)
      "notifications" -> Background.openNotifications(activity)
      else -> Background.openBrandSettings(activity)
    }
    invoke.resolve()
  }

  /** Blocage d'applis : accès à l'utilisation et affichage par-dessus les autres applis. */
  @Command
  fun blockerStatus(invoke: Invoke) {
    val res = JSObject()
    res.put("usage", FocusWatchService.usageAccess(activity))
    res.put("overlay", FocusWatchService.overlay(activity))
    res.put("enabled", FocusWatchService.allowed(activity))
    invoke.resolve(res)
  }

  /** Ouvre le réglage d'Android qui manque (« usage » ou « overlay »). */
  @Command
  fun openBlockerSettings(invoke: Invoke) {
    val which = invoke.parseArgs(SettingsArgs::class.java).which
    val intent = when (which) {
      "overlay" -> FocusWatchService.overlaySettings(activity)
      // Fiche de l'appli : son menu ⋮ propose « Autoriser les paramètres restreints » (appli installée hors Play Store).
      "app" -> Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:${activity.packageName}"))
      else -> FocusWatchService.usageSettings(activity)
    }
    try {
      activity.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (e: Exception) {
      activity.startActivity(Intent(android.provider.Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    invoke.resolve()
  }

  /** Applis installées (celles qu'on peut lancer), pour choisir lesquelles bloquer pendant un focus. */
  @Command
  fun listApps(invoke: Invoke) {
    val pm = activity.packageManager
    val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    val apps = app.tauri.plugin.JSArray()
    pm.queryIntentActivities(launcher, 0)
      .map { it.activityInfo.packageName to it.loadLabel(pm).toString() }
      .filter { it.first != activity.packageName }
      .distinctBy { it.first }
      .sortedBy { it.second.lowercase() }
      .forEach { (pkg, label) ->
        val o = JSObject()
        o.put("package", pkg)
        o.put("label", label)
        apps.put(o)
      }
    val res = JSObject()
    res.put("apps", apps)
    invoke.resolve(res)
  }

  /** Ouvre le sélecteur de fichiers Android et renvoie le contenu texte du fichier choisi (sauvegarde). */
  @Command
  fun pickTextFile(invoke: Invoke) {
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = "*/*"
      putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/json", "text/plain", "application/octet-stream"))
    }
    startActivityForResult(invoke, intent, "pickTextFileResult")
  }

  /** Son actuel des rappels avec sonnerie. */
  @Command
  fun ringSound(invoke: Invoke) {
    val res = JSObject()
    res.put("title", Notifs.ringTitle(activity))
    invoke.resolve(res)
  }

  /** Ouvre le choix des sons d'Android (réveils, sonneries, notifications) pour les rappels avec sonnerie. */
  @Command
  fun pickRingSound(invoke: Invoke) {
    val intent = Intent(android.media.RingtoneManager.ACTION_RINGTONE_PICKER)
      .putExtra(android.media.RingtoneManager.EXTRA_RINGTONE_TYPE, android.media.RingtoneManager.TYPE_ALL)
      .putExtra(android.media.RingtoneManager.EXTRA_RINGTONE_TITLE, "Son des rappels")
      .putExtra(android.media.RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true)
      .putExtra(android.media.RingtoneManager.EXTRA_RINGTONE_DEFAULT_URI, android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_ALARM))
      .putExtra(android.media.RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, false)
      .putExtra(android.media.RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, Notifs.ringUri(activity))
    startActivityForResult(invoke, intent, "pickRingSoundResult")
  }

  @ActivityCallback
  fun pickRingSoundResult(invoke: Invoke, result: ActivityResult) {
    if (result.resultCode == Activity.RESULT_OK) {
      @Suppress("DEPRECATION")
      val uri = result.data?.getParcelableExtra<android.net.Uri>(android.media.RingtoneManager.EXTRA_RINGTONE_PICKED_URI)
      Notifs.setRingSound(activity, uri)
    }
    val res = JSObject()
    res.put("title", Notifs.ringTitle(activity))
    invoke.resolve(res)
  }

  @ActivityCallback
  fun pickTextFileResult(invoke: Invoke, result: ActivityResult) {
    val uri = result.data?.data
    if (result.resultCode != Activity.RESULT_OK || uri == null) {
      invoke.reject("Aucun fichier choisi.")
      return
    }
    try {
      val text = activity.contentResolver.openInputStream(uri)?.use { it.readBytes().toString(Charsets.UTF_8) }
        ?: throw IllegalStateException("Fichier illisible.")
      val res = JSObject()
      res.put("text", text)
      invoke.resolve(res)
    } catch (e: Exception) {
      invoke.reject(e.message ?: "Fichier illisible.")
    }
  }

  /** Ouvre un lien dans le navigateur (ou l'appli qui le gère). */
  @Command
  fun openUrl(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(UrlArgs::class.java)
      val intent = Intent(Intent.ACTION_VIEW, android.net.Uri.parse(args.url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      activity.startActivity(intent)
      invoke.resolve()
    } catch (e: Exception) {
      invoke.reject(e.message ?: "Lien impossible à ouvrir.")
    }
  }

  /** Écrit le texte dans un fichier temporaire et ouvre le menu de partage Android (Drive, mail, WhatsApp…). */
  @Command
  fun shareFile(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(ShareArgs::class.java)
      val dir = File(activity.cacheDir, "partage").apply { mkdirs() }
      val file = File(dir, args.fileName)
      file.writeText(args.text, Charsets.UTF_8)
      val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
      val send = Intent(Intent.ACTION_SEND).apply {
        type = args.mimeType ?: "application/json"
        putExtra(Intent.EXTRA_STREAM, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      activity.startActivity(Intent.createChooser(send, args.title ?: "Partager"))
      invoke.resolve()
    } catch (e: Exception) {
      invoke.reject(e.message ?: "Partage impossible.")
    }
  }
}
