package app.megatron.desktop

import org.json.JSONArray
import org.json.JSONObject
import java.io.Closeable

/**
 * La base de Mégatron, lue et modifiée par le même SQLite que l'appli (côté Rust, `native_db.rs`).
 * Le SQLite d'Android, ouvert dans le même processus, ne voyait pas les verrous de l'appli et cassait
 * ses enregistrements (« disk I/O error »).
 */
object NativeDb {
  init {
    System.loadLibrary("megatron_lib")
  }

  @JvmStatic external fun run(path: String, sql: String, args: String): String
}

/** Une connexion le temps d'un bloc : mêmes noms que l'API d'Android pour garder le code lisible. */
class Db(private val path: String) {
  private fun call(sql: String, args: Array<out Any?>): JSONObject {
    val params = JSONArray()
    args.forEach { params.put(it ?: JSONObject.NULL) }
    val out = JSONObject(NativeDb.run(path, sql, params.toString()))
    if (out.has("err")) throw IllegalStateException(out.getString("err"))
    return out.getJSONObject("ok")
  }

  fun rawQuery(sql: String, args: Array<out Any?>?): Rows = Rows(call(sql, args ?: emptyArray()).getJSONArray("rows"))

  fun execSQL(sql: String, args: Array<out Any?> = emptyArray()) {
    call(sql, args)
  }

  /** INSERT : renvoie l'identifiant de la ligne créée. */
  fun insert(sql: String, args: Array<out Any?>): Long = call(sql, args).getLong("lastId")
}

/** Lignes lues, parcourues comme un Cursor d'Android. */
class Rows(private val rows: JSONArray) : Closeable {
  private var pos = -1
  val count: Int get() = rows.length()
  val columnCount: Int get() = if (pos in 0 until rows.length()) rows.getJSONArray(pos).length() else 0

  fun moveToNext(): Boolean = ++pos < rows.length()
  fun moveToFirst(): Boolean {
    pos = 0
    return rows.length() > 0
  }

  private fun cell(i: Int): Any? = rows.getJSONArray(pos).opt(i).takeUnless { it == JSONObject.NULL }
  fun isNull(i: Int): Boolean = cell(i) == null
  fun getString(i: Int): String = cell(i)?.toString() ?: ""
  fun getLong(i: Int): Long = when (val v = cell(i)) {
    is Number -> v.toLong()
    null -> 0L
    else -> v.toString().toDoubleOrNull()?.toLong() ?: 0L
  }
  fun getInt(i: Int): Int = getLong(i).toInt()
  fun getDouble(i: Int): Double = when (val v = cell(i)) {
    is Number -> v.toDouble()
    null -> 0.0
    else -> v.toString().toDoubleOrNull() ?: 0.0
  }

  override fun close() {}
}
