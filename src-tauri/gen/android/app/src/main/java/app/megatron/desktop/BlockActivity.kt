package app.megatron.desktop

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.activity.ComponentActivity

/** Écran posé devant une appli bloquée pendant un focus : temps restant et retour à l'accueil. */
class BlockActivity : ComponentActivity() {
  private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

  private fun goHome() {
    startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    finish()
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val minutes = ((FocusCtl.endsAt(this) - System.currentTimeMillis()) / 60_000L).coerceAtLeast(1)

    fun text(value: String, size: Float, color: Int, bold: Boolean = false) = TextView(this).apply {
      text = value
      setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
      setTextColor(color)
      gravity = Gravity.CENTER
      if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
    }

    val button = text("Retour à l'accueil", 16f, Color.BLACK, true).apply {
      background = GradientDrawable().apply { cornerRadius = dp(18).toFloat(); setColor(0xFF4FE06A.toInt()) }
      setPadding(dp(24), dp(16), dp(24), dp(16))
      setOnClickListener { goHome() }
    }

    setContentView(LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setBackgroundColor(Color.BLACK)
      setPadding(dp(32), dp(32), dp(32), dp(32))
      addView(text("🎯", 56f, Color.WHITE))
      addView(text("Focus en cours", 26f, Color.WHITE, true).apply { setPadding(0, dp(16), 0, dp(6)) })
      addView(text("Cette appli est en pause jusqu'à la fin de ta session.", 15f, 0xFF9A9AA2.toInt()))
      addView(text("Encore $minutes min", 34f, 0xFF4FE06A.toInt(), true).apply { setPadding(0, dp(28), 0, dp(36)) })
      addView(button, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
    })

    // Retour : on ne revient pas sur l'appli bloquée, on va à l'accueil.
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() = goHome()
    })
  }
}
