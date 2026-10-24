package app.megatron.desktop

import android.app.Activity
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
