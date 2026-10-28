//! Accès à la base pour le code Android (notifications, widgets, alarmes), appelé depuis Kotlin (`NativeDb.run`).
//!
//! Kotlin ne doit pas ouvrir la base avec le SQLite d'Android : deux copies de SQLite dans le même processus
//! ne voient pas leurs verrous respectifs. Celle d'Android se croyait seule, vidait le journal (WAL) en se fermant,
//! et l'appli tombait ensuite sur « disk I/O error (522) » à chaque enregistrement. Ici, on passe par la même
//! copie de SQLite que l'appli : les verrous sont partagés.

use std::ffi::{c_int, CStr, CString};
use std::ptr::null_mut;

use jni::objects::{JClass, JString};
use jni::sys::jstring;
use jni::JNIEnv;
use libsqlite3_sys as ffi;
use serde_json::{json, Value};

/// Exécute une requête (avec ses paramètres) et renvoie les lignes lues.
fn run(path: &str, sql: &str, args: &[Value]) -> Result<Value, String> {
    let c_path = CString::new(path).map_err(|e| e.to_string())?;
    let c_sql = CString::new(sql).map_err(|e| e.to_string())?;
    unsafe {
        let mut db = null_mut();
        let rc = ffi::sqlite3_open_v2(c_path.as_ptr(), &mut db, ffi::SQLITE_OPEN_READWRITE | ffi::SQLITE_OPEN_FULLMUTEX, std::ptr::null());
        if rc != ffi::SQLITE_OK {
            let err = message(db);
            ffi::sqlite3_close(db);
            return Err(err);
        }
        // L'appli peut être en train d'écrire : on attend un peu plutôt que d'échouer.
        ffi::sqlite3_busy_timeout(db, 5000);
        let result = query(db, &c_sql, args);
        ffi::sqlite3_close(db);
        result
    }
}

unsafe fn message(db: *mut ffi::sqlite3) -> String {
    if db.is_null() {
        return "base introuvable".into();
    }
    CStr::from_ptr(ffi::sqlite3_errmsg(db)).to_string_lossy().into_owned()
}

unsafe fn query(db: *mut ffi::sqlite3, sql: &CStr, args: &[Value]) -> Result<Value, String> {
    let mut stmt = null_mut();
    if ffi::sqlite3_prepare_v2(db, sql.as_ptr(), -1, &mut stmt, null_mut()) != ffi::SQLITE_OK {
        return Err(message(db));
    }
    let result = (|| {
        for (i, arg) in args.iter().enumerate() {
            let index = (i + 1) as c_int;
            let rc = match arg {
                Value::Null => ffi::sqlite3_bind_null(stmt, index),
                Value::Bool(b) => ffi::sqlite3_bind_int64(stmt, index, *b as i64),
                Value::Number(n) => match n.as_i64() {
                    Some(v) => ffi::sqlite3_bind_int64(stmt, index, v),
                    None => ffi::sqlite3_bind_double(stmt, index, n.as_f64().unwrap_or(0.0)),
                },
                other => {
                    let text = match other {
                        Value::String(s) => s.clone(),
                        v => v.to_string(),
                    };
                    let c_text = CString::new(text).map_err(|e| e.to_string())?;
                    ffi::sqlite3_bind_text(stmt, index, c_text.as_ptr(), -1, ffi::SQLITE_TRANSIENT())
                }
            };
            if rc != ffi::SQLITE_OK {
                return Err(message(db));
            }
        }
        let mut rows = Vec::new();
        loop {
            match ffi::sqlite3_step(stmt) {
                ffi::SQLITE_ROW => {
                    let count = ffi::sqlite3_column_count(stmt);
                    let row: Vec<Value> = (0..count)
                        .map(|c| match ffi::sqlite3_column_type(stmt, c) {
                            ffi::SQLITE_INTEGER => json!(ffi::sqlite3_column_int64(stmt, c)),
                            ffi::SQLITE_FLOAT => json!(ffi::sqlite3_column_double(stmt, c)),
                            ffi::SQLITE_NULL => Value::Null,
                            _ => {
                                let text = ffi::sqlite3_column_text(stmt, c);
                                if text.is_null() {
                                    Value::Null
                                } else {
                                    Value::String(CStr::from_ptr(text as *const _).to_string_lossy().into_owned())
                                }
                            }
                        })
                        .collect();
                    rows.push(Value::Array(row));
                }
                ffi::SQLITE_DONE => break,
                _ => return Err(message(db)),
            }
        }
        Ok(json!({ "rows": rows, "lastId": ffi::sqlite3_last_insert_rowid(db) }))
    })();
    ffi::sqlite3_finalize(stmt);
    result
}

/// `NativeDb.run(chemin, sql, paramètres en JSON)` → `{"ok": {"rows": [...]}}` ou `{"err": "..."}`.
#[no_mangle]
pub extern "system" fn Java_app_megatron_desktop_NativeDb_run<'a>(
    mut env: JNIEnv<'a>,
    _class: JClass<'a>,
    path: JString<'a>,
    sql: JString<'a>,
    args: JString<'a>,
) -> jstring {
    let mut text = |s: &JString<'a>| env.get_string(s).map(String::from).unwrap_or_default();
    let (path, sql, args) = (text(&path), text(&sql), text(&args));
    let args: Vec<Value> = serde_json::from_str(&args).unwrap_or_default();
    let out = match run(&path, &sql, &args) {
        Ok(v) => json!({ "ok": v }),
        Err(e) => json!({ "err": e }),
    };
    env.new_string(out.to_string()).map(|s| s.into_raw()).unwrap_or(null_mut())
}
