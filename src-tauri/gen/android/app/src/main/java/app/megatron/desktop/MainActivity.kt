package app.megatron.desktop

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  companion object {
    /** L'interface a affiché ses données (commande « appReady ») : l'écran de démarrage peut partir. */
    @Volatile var ready = false
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
}
