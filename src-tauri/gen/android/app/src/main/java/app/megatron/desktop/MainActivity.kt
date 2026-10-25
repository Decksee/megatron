package app.megatron.desktop

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  companion object {
    /** L'interface a affiché ses données (commande « appReady ») : l'écran de démarrage peut partir. */
    @Volatile var ready = false

    /** Appli ouverte en ce moment (null sinon) : les boutons des notifications la préviennent directement. */
    @Volatile private var current: java.lang.ref.WeakReference<MainActivity>? = null

    /**
     * Une notification (Fait, Replanifier, minuteur, focus…) vient de changer la base : si l'appli est ouverte,
     * elle relit tout de suite ses données, même quand le volet n'a pas été ouvert (bandeau en haut de l'écran).
     */
    fun resync() {
      current?.get()?.let { a -> a.runOnUiThread { a.findWebView(a.window.decorView)?.evaluateJavascript(RESYNC_JS, null) } }
    }

    private const val RESYNC_JS = "window.dispatchEvent(new Event('megatron-resync'))"
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    // Écran de démarrage : l'icône reste jusqu'au premier affichage (3 s au plus), puis s'efface en fondu.
    val splash = installSplashScreen()
    val shownAt = SystemClock.uptimeMillis()
    splash.setKeepOnScreenCondition { !ready && SystemClock.uptimeMillis() - shownAt < 3000 }
    splash.setOnExitAnimationListener { screen ->
      screen.view.animate().alpha(0f).setDuration(220).withEndAction { screen.remove() }.start()
    }
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    window.decorView.setBackgroundColor(getColor(R.color.splash_bg))
    rememberAction(intent)

    // L'interface se pose entre la barre d'état et la barre de navigation (boutons ou gestes) :
    // la barre d'onglets n'est jamais cachée dessous. Clavier ouvert, le contenu remonte au-dessus.
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
      WindowInsetsCompat.CONSUMED
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    rememberAction(intent)
  }

  /** Bouton « + » du widget : l'interface le lit au retour au premier plan et ouvre le panneau d'ajout. */
  private fun rememberAction(intent: Intent?) {
    val action = intent?.getStringExtra("megatron_action") ?: return
    getSharedPreferences("megatron", Context.MODE_PRIVATE).edit().putString("launch_action", action).apply()
    intent.removeExtra("megatron_action")
  }

  /** Icônes de la barre d'état et de navigation : sombres en thème clair, claires en thème sombre. */
  fun setLightBars(light: Boolean) = runOnUiThread {
    // Fond derrière les barres (zone sous les boutons de navigation) : celui du thème de l'appli.
    window.decorView.setBackgroundColor(if (light) 0xFFF7F7F9.toInt() else 0xFF000000.toInt())
    WindowCompat.getInsetsController(window, window.decorView).apply {
      isAppearanceLightStatusBars = light
      isAppearanceLightNavigationBars = light
    }
  }

  /**
   * Retour au premier plan sans pause (volet des notifications refermé, après « Fait » ou « Replanifier ») :
   * on prévient l'interface pour qu'elle relise la base, sans avoir à fermer et rouvrir l'appli.
   */
  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) findWebView(window.decorView)?.evaluateJavascript(RESYNC_JS, null)
  }

  override fun onResume() {
    super.onResume()
    current = java.lang.ref.WeakReference(this)
  }

  override fun onDestroy() {
    if (current?.get() === this) current = null
    super.onDestroy()
  }

  fun findWebView(view: View): WebView? {
    if (view is WebView) return view
    if (view is ViewGroup) for (i in 0 until view.childCount) findWebView(view.getChildAt(i))?.let { return it }
    return null
  }
}
