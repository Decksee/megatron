// Windows : encoche, voix, son et applis. Téléphone : seulement le tronc commun.
#[cfg(windows)]
mod actions;
mod ai;
#[cfg(desktop)]
mod desktop;
mod files;
#[cfg(windows)]
mod media;
#[cfg(mobile)]
mod mobile;
mod telegram;
#[cfg(windows)]
mod wake;

use tauri_plugin_sql::{Migration, MigrationKind};

/// Lecture/écriture des fichiers de sauvegarde (chemins choisis par l'utilisateur via la boîte de dialogue).
#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Secondes écoulées depuis la dernière action clavier/souris (pour la pause automatique).
#[tauri::command]
fn idle_seconds() -> u64 {
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::System::SystemInformation::GetTickCount;
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
        let mut info = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if GetLastInputInfo(&mut info) != 0 {
            return (GetTickCount().wrapping_sub(info.dwTime) / 1000) as u64;
        }
    }
    0
}

/// Fenêtre au premier plan (pour repérer les distractions en mode focus).
#[derive(serde::Serialize)]
struct ForegroundWindow {
    hwnd: isize,
    process: String,
    title: String,
}

#[tauri::command]
fn foreground_window() -> Option<ForegroundWindow> {
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
            PROCESS_QUERY_LIMITED_INFORMATION,
        };
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
        };

        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return None;
        }
        let mut buf = [0u16; 512];
        let len = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32).max(0) as usize;
        let title = String::from_utf16_lossy(&buf[..len]);

        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        let mut process = String::new();
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if !handle.is_null() {
            let mut path = [0u16; 1024];
            let mut size = path.len() as u32;
            if QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, path.as_mut_ptr(), &mut size) != 0 {
                let full = String::from_utf16_lossy(&path[..size as usize]);
                process = full.rsplit('\\').next().unwrap_or_default().to_string();
            }
            CloseHandle(handle);
        }
        return Some(ForegroundWindow { hwnd: hwnd as isize, process, title });
    }
    #[allow(unreachable_code)]
    None
}

/// Réduit la fenêtre, seulement si elle est toujours au premier plan (évite d'agir sur une autre).
#[tauri::command]
fn minimize_window(hwnd: isize) -> bool {
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, ShowWindow, SW_MINIMIZE};
        let fg = GetForegroundWindow();
        if fg as isize == hwnd && !fg.is_null() {
            return ShowWindow(fg, SW_MINIMIZE) != 0;
        }
    }
    false
}

fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "projets et tâches",
        sql: "CREATE TABLE projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                client TEXT NOT NULL DEFAULT '',
                price REAL NOT NULL DEFAULT 0,
                currency TEXT NOT NULL DEFAULT 'EUR',
                status TEXT NOT NULL DEFAULT 'active',
                deadline TEXT,
                notes TEXT NOT NULL DEFAULT '',
                color TEXT NOT NULL DEFAULT '#0a84ff',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
              );
              CREATE TABLE tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER REFERENCES projects(id),
                title TEXT NOT NULL,
                done INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                completed_at TEXT
              );
              CREATE INDEX idx_tasks_project ON tasks(project_id);",
        kind: MigrationKind::Up,
    },
    Migration {
        version: 2,
        description: "suivi du temps et réglages",
        sql: "CREATE TABLE time_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER REFERENCES projects(id),
                started_at TEXT NOT NULL,
                ended_at TEXT,
                note TEXT NOT NULL DEFAULT ''
              );
              CREATE INDEX idx_time_started ON time_entries(started_at);
              CREATE TABLE settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
              );",
        kind: MigrationKind::Up,
    },
    Migration {
        version: 3,
        description: "minuteurs multiples avec pause",
        // Un minuteur existe tant qu'on suit un projet : il tourne s'il a une session ouverte,
        // il est en pause sinon.
        sql: "CREATE TABLE timers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER REFERENCES projects(id),
                created_at TEXT NOT NULL
              );
              INSERT INTO timers (project_id, created_at)
                SELECT project_id, MIN(started_at) FROM time_entries
                WHERE ended_at IS NULL GROUP BY project_id;",
        kind: MigrationKind::Up,
    },
    Migration {
        version: 4,
        description: "sessions de focus",
        sql: "CREATE TABLE focus_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER REFERENCES projects(id),
                started_at TEXT NOT NULL,
                ended_at TEXT,
                planned_minutes INTEGER NOT NULL,
                budget_minutes INTEGER NOT NULL,
                mode TEXT NOT NULL DEFAULT 'alert',
                distraction_ms INTEGER NOT NULL DEFAULT 0,
                distractions TEXT NOT NULL DEFAULT '{}',
                completed INTEGER NOT NULL DEFAULT 0
              );",
        kind: MigrationKind::Up,
    },
    Migration {
        version: 5,
        description: "rappels",
        sql: "CREATE TABLE reminders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                due_at TEXT NOT NULL,
                repeat TEXT NOT NULL DEFAULT 'none',
                project_id INTEGER REFERENCES projects(id),
                done INTEGER NOT NULL DEFAULT 0,
                notified_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
              );
              CREATE INDEX idx_reminders_due ON reminders(done, due_at);",
        kind: MigrationKind::Up,
    },
    Migration {
        version: 6,
        description: "dates des tâches, dates et statuts de paiement des projets",
        // « Terminé » devient « En attente de paiement » : à marquer « Payé » une fois l'argent reçu.
        sql: "ALTER TABLE tasks ADD COLUMN due_date TEXT;
              ALTER TABLE projects ADD COLUMN start_date TEXT;
              ALTER TABLE projects ADD COLUMN paid_at TEXT;
              UPDATE projects SET status = 'unpaid' WHERE status = 'done';",
        kind: MigrationKind::Up,
    },
    Migration {
        version: 7,
        description: "conversation gardée et mémoire de l'assistant",
        sql: "CREATE TABLE conversation (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                data TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
              );
              CREATE TABLE memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                text TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
              );",
        kind: MigrationKind::Up,
    },
    Migration {
        version: 8,
        description: "extras des projets (avec leur prix) et paiements reçus",
        // Les projets déjà marqués « Payé » reçoivent un paiement du montant de leur prix.
        sql: "CREATE TABLE extras (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL REFERENCES projects(id),
                title TEXT NOT NULL,
                price REAL NOT NULL DEFAULT 0,
                done INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                completed_at TEXT
              );
              CREATE TABLE payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL REFERENCES projects(id),
                amount REAL NOT NULL,
                paid_on TEXT NOT NULL,
                note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
              );
              ALTER TABLE tasks ADD COLUMN extra_id INTEGER REFERENCES extras(id);
              INSERT INTO payments (project_id, amount, paid_on, note)
                SELECT id, price, COALESCE(substr(paid_at, 1, 10), date('now')), 'Paiement'
                FROM projects WHERE status = 'paid' AND price > 0;",
        kind: MigrationKind::Up,
    },
    Migration {
        version: 9,
        description: "pause des sessions de focus",
        sql: "ALTER TABLE focus_sessions ADD COLUMN paused_at TEXT;
              ALTER TABLE focus_sessions ADD COLUMN paused_ms INTEGER NOT NULL DEFAULT 0;",
        kind: MigrationKind::Up,
    },
    Migration {
        version: 10,
        description: "jour prevu des taches (distinct de l'echeance)",
        sql: "ALTER TABLE tasks ADD COLUMN planned_date TEXT;",
        kind: MigrationKind::Up,
    }]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Ordinateur : un seul Mégatron à la fois (relancer l'app ouvre simplement sa fenêtre),
    // mises à jour automatiques et démarrage avec Windows.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = desktop::show_settings(app, None);
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ));

    let builder = builder
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:megatron.db", migrations())
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init());

    #[cfg(desktop)]
    let builder = builder
        .manage(desktop::HitAreas::default())
        .invoke_handler(tauri::generate_handler![
            desktop::set_hit_area,
            desktop::notch_resync,
            write_text_file,
            read_text_file,
            idle_seconds,
            foreground_window,
            minimize_window,
            ai::ai_set_key,
            ai::ai_has_key,
            ai::ai_delete_key,
            ai::ai_chat,
            ai::ai_list_models,
            ai::ai_transcribe,
            ai::ai_speak,
            ai::azure_voices,
            files::read_attachment,
            files::parse_attachment,
            telegram::telegram_call,
            telegram::telegram_file,
            actions::open_app,
            actions::open_url,
            actions::open_folder,
            actions::media_key,
            actions::lock_screen,
            actions::screen_snip,
            media::media_state,
            media::media_control,
            media::volume_get,
            media::volume_set,
            media::audio_peak,
            desktop::open_settings,
            wake::wake_word_set,
            wake::wake_word_refresh,
            wake::wake_word_sensitivity,
            wake::wake_word_test
        ])
        .setup(|app| {
            desktop::setup(app.handle())?;
            Ok(())
        });

    #[cfg(mobile)]
    let builder = builder
        .plugin(mobile::init())
        .invoke_handler(tauri::generate_handler![
            mobile::native_call,
            mobile::open_url,
            write_text_file,
            read_text_file,
            idle_seconds,
            foreground_window,
            minimize_window,
            ai::ai_set_key,
            ai::ai_has_key,
            ai::ai_delete_key,
            ai::ai_chat,
            ai::ai_list_models,
            ai::ai_transcribe,
            ai::ai_speak,
            ai::azure_voices,
            files::read_attachment,
            files::parse_attachment,
            telegram::telegram_call,
            telegram::telegram_file
        ])
        .setup(|app| {
            ai::init_key_store(app.handle());
            // Une seule fenêtre plein écran : l'interface mobile.
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html?window=mobile".into()))
                .build()?;
            Ok(())
        });

    builder
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Mégatron");
}
