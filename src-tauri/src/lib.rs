mod actions;
mod ai;
mod files;
mod media;
mod telegram;
mod wake;

use std::{collections::HashMap, sync::Mutex, thread, time::Duration};

use tauri_plugin_sql::{Migration, MigrationKind};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};

/// Taille (logique) de la fenêtre transparente qui héberge l'encoche.
/// Elle doit contenir l'encoche ouverte ; le reste laisse passer les clics.
const WINDOW_W: f64 = 900.0;
const WINDOW_H: f64 = 520.0;
const SETTINGS_LABEL: &str = "settings";
const NOTCH_PREFIX: &str = "notch-";
const POLL_INTERVAL: Duration = Duration::from_millis(16);
/// Toutes les ~2 s, on vérifie si des écrans ont été branchés/débranchés.
const MONITOR_SYNC_EVERY: u32 = 120;
/// Position de la souris envoyée à la mascotte (~30 fois/s) quand elle est à moins de cette distance.
const CURSOR_EVERY: u32 = 2;
/// Vérification « une fenêtre est-elle sous l'encoche ? » (~4 fois/s).
const BEHIND_EVERY: u32 = 15;
const CURSOR_RANGE: f64 = 700.0;

/// Zone survolable de chaque encoche (taille logique, centrée en haut de la fenêtre).
/// `interactive` : la zone reçoit les clics. Sinon (pilule fermée), on détecte seulement le survol
/// et les clics passent aux applications en dessous (onglets du navigateur…).
#[derive(Clone, Copy)]
struct HitArea {
    width: f64,
    height: f64,
    interactive: bool,
}

#[derive(Default)]
struct HitAreas(Mutex<HashMap<String, HitArea>>);

#[tauri::command]
fn set_hit_area(
    window: WebviewWindow,
    areas: tauri::State<HitAreas>,
    width: f64,
    height: f64,
    interactive: Option<bool>,
) {
    let area = HitArea { width, height, interactive: interactive.unwrap_or(true) };
    areas.0.lock().unwrap().insert(window.label().to_string(), area);
}

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

fn monitor_label(m: &Monitor) -> String {
    let (p, s) = (m.position(), m.size());
    format!("{NOTCH_PREFIX}{}_{}_{}_{}", p.x, p.y, s.width, s.height)
}

/// Place la fenêtre centrée en haut de l'écran, en pixels physiques
/// pour rester juste quand les écrans ont des mises à l'échelle différentes.
fn place_on_monitor(win: &WebviewWindow, m: &Monitor) {
    let scale = m.scale_factor();
    let width = (WINDOW_W * scale).round() as u32;
    let height = (WINDOW_H * scale).round() as u32;
    let x = m.position().x + (m.size().width as i32 - width as i32) / 2;
    let _ = win.set_position(PhysicalPosition::new(x, m.position().y));
    let _ = win.set_size(PhysicalSize::new(width, height));
}

/// L'encoche n'est plus centrée en haut de son écran (quelques pixels de marge pour les arrondis).
fn is_misplaced(win: &WebviewWindow, m: &Monitor) -> bool {
    let (Ok(pos), Ok(size)) = (win.outer_position(), win.outer_size()) else {
        return false;
    };
    let width = (WINDOW_W * m.scale_factor()).round() as i32;
    let x = m.position().x + (m.size().width as i32 - width) / 2;
    (pos.x - x).abs() > 4 || (pos.y - m.position().y).abs() > 4 || (size.width as i32 - width).abs() > 4
}

/// Une encoche par écran : crée celles qui manquent, replace celles qui ont bougé, ferme celles des écrans débranchés.
fn sync_notch_windows(app: &AppHandle) {
    let monitors = app.available_monitors().unwrap_or_default();
    let wanted: HashMap<String, Monitor> =
        monitors.into_iter().map(|m| (monitor_label(&m), m)).collect();

    for (label, win) in app.webview_windows() {
        if label.starts_with(NOTCH_PREFIX) && !wanted.contains_key(&label) {
            let _ = win.destroy();
            app.state::<HitAreas>().0.lock().unwrap().remove(&label);
        }
    }

    for (label, monitor) in &wanted {
        if let Some(win) = app.get_webview_window(label) {
            // Windows déplace parfois les fenêtres d'un écran qui se met en veille ou change d'entrée
            // vers l'écran principal : l'encoche est remise à sa place dès qu'elle en sort.
            if is_misplaced(&win, monitor) {
                eprintln!("Encoche {label} replacée sur son écran");
                place_on_monitor(&win, monitor);
            }
            continue;
        }
        let built = WebviewWindowBuilder::new(app, label, WebviewUrl::default())
            .title("Mégatron")
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .focused(false)
            .visible(false)
            .inner_size(WINDOW_W, WINDOW_H)
            .build();
        match built {
            Ok(win) => {
                place_on_monitor(&win, monitor);
                let _ = win.set_ignore_cursor_events(true);
                let _ = win.show();
            }
            Err(e) => eprintln!("Impossible de créer l'encoche {label}: {e}"),
        }
    }
}

/// La fenêtre ignore la souris par défaut (clics transmis aux apps derrière).
/// On surveille le curseur et on « réveille » la fenêtre seulement au-dessus de l'encoche.
fn spawn_hover_watcher(app: AppHandle) {
    thread::spawn(move || {
        let mut inside: HashMap<String, bool> = HashMap::new();
        let mut ignoring: HashMap<String, bool> = HashMap::new();
        let mut occupied: HashMap<String, bool> = HashMap::new();
        let mut hidden: HashMap<String, bool> = HashMap::new();
        let mut last_cursor: HashMap<String, Option<(f64, f64)>> = HashMap::new();
        let mut tick: u32 = 0;
        loop {
            thread::sleep(POLL_INTERVAL);
            tick = tick.wrapping_add(1);
            if tick % MONITOR_SYNC_EVERY == 0 {
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || sync_notch_windows(&handle));
            }

            let Ok(cursor) = app.cursor_position() else { continue };
            let areas = app.state::<HitAreas>().0.lock().unwrap().clone();

            for (label, win) in app.webview_windows() {
                if !label.starts_with(NOTCH_PREFIX) {
                    continue;
                }
                let (Ok(pos), Ok(size), Ok(scale)) =
                    (win.outer_position(), win.outer_size(), win.scale_factor())
                else {
                    continue;
                };
                let area = areas
                    .get(&label)
                    .copied()
                    .unwrap_or(HitArea { width: 236.0, height: 44.0, interactive: false });
                let (w, h) = (area.width * scale, area.height * scale);
                let left = pos.x as f64 + (size.width as f64 - w) / 2.0;
                let top = pos.y as f64;
                let is_inside = cursor.x >= left
                    && cursor.x <= left + w
                    && cursor.y >= top
                    && cursor.y <= top + h;

                if inside.get(&label).copied().unwrap_or(false) != is_inside {
                    inside.insert(label.clone(), is_inside);
                    let _ = app.emit_to(label.as_str(), "notch-hover", is_inside);
                }
                let ignore = !(is_inside && area.interactive);
                if ignoring.get(&label).copied() != Some(ignore) {
                    ignoring.insert(label.clone(), ignore);
                    let _ = win.set_ignore_cursor_events(ignore);
                }

                // Vidéo, jeu ou présentation en plein écran sur cet écran (barre des tâches comprise) :
                // l'encoche disparaît complètement. Une fenêtre simplement agrandie ne compte pas.
                if tick % BEHIND_EVERY == 0 {
                    let fullscreen = win.current_monitor().ok().flatten().is_some_and(|m| {
                        let (mp, ms) = (m.position(), m.size());
                        foreground_rect().is_some_and(|(l, t, r, b)| {
                            l <= mp.x
                                && t <= mp.y
                                && r >= mp.x + ms.width as i32
                                && b >= mp.y + ms.height as i32
                        })
                    });
                    if hidden.get(&label).copied().unwrap_or(false) != fullscreen {
                        hidden.insert(label.clone(), fullscreen);
                        let _ = if fullscreen { win.hide() } else { win.show() };
                    }
                }

                // Une fenêtre derrière l'encoche ? On sonde le centre et les côtés de la pilule.
                if tick % BEHIND_EVERY == 0 && ignore {
                    let cx = pos.x + size.width as i32 / 2;
                    let y = pos.y + (12.0 * scale) as i32;
                    let dx = (90.0 * scale) as i32;
                    let probes = [cx, cx - dx, cx + dx].map(|x| window_behind(x, y));
                    if probes.iter().any(Option::is_some) {
                        let now = probes.iter().any(|p| *p == Some(true));
                        if occupied.get(&label).copied() != Some(now) {
                            occupied.insert(label.clone(), now);
                            let _ = app.emit_to(label.as_str(), "notch-occupied", now);
                        }
                    }
                }

                // Pour que la mascotte suive la souris du regard : position en px logiques,
                // relative au coin haut-gauche de la fenêtre.
                if tick % CURSOR_EVERY == 0 {
                    let x = (cursor.x - pos.x as f64) / scale;
                    let y = (cursor.y - pos.y as f64) / scale;
                    let near = (x - WINDOW_W / 2.0).abs() < CURSOR_RANGE && y < CURSOR_RANGE && y > -50.0;
                    let next = near.then_some((x.round(), y.round()));
                    if last_cursor.get(&label) != Some(&next) {
                        let _ = app.emit_to(label.as_str(), "notch-cursor", next);
                        last_cursor.insert(label.clone(), next);
                    }
                }
            }
            inside.retain(|label, _| app.get_webview_window(label).is_some());
            ignoring.retain(|label, _| app.get_webview_window(label).is_some());
            occupied.retain(|label, _| app.get_webview_window(label).is_some());
            hidden.retain(|label, _| app.get_webview_window(label).is_some());
            last_cursor.retain(|label, _| app.get_webview_window(label).is_some());
        }
    });
}

/// Y a-t-il une fenêtre (navigateur, éditeur…) sous ce point de l'écran, ou seulement le bureau ?
/// `None` si c'est une de nos propres fenêtres (on ne peut pas conclure).
fn window_behind(x: i32, y: i32) -> Option<bool> {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::System::Threading::GetCurrentProcessId;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetAncestor, GetClassNameW, GetWindowThreadProcessId, WindowFromPoint, GA_ROOT,
    };
    unsafe {
        // L'encoche fermée laisse passer la souris : Windows renvoie donc la fenêtre située dessous.
        let hwnd = WindowFromPoint(POINT { x, y });
        if hwnd.is_null() {
            return Some(false);
        }
        let root = GetAncestor(hwnd, GA_ROOT);
        let mut pid = 0u32;
        GetWindowThreadProcessId(root, &mut pid);
        if pid == GetCurrentProcessId() {
            return None;
        }
        let mut buf = [0u16; 64];
        let n = GetClassNameW(root, buf.as_mut_ptr(), buf.len() as i32).max(0) as usize;
        let class = String::from_utf16_lossy(&buf[..n]);
        // Le bureau et la barre des tâches ne comptent pas comme « quelque chose derrière ».
        Some(!matches!(
            class.as_str(),
            "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd"
        ))
    }
}

/// Rectangle (pixels physiques) de la fenêtre au premier plan si elle peut être en plein écran :
/// ni le bureau, ni une fenêtre de Mégatron.
fn foreground_rect() -> Option<(i32, i32, i32, i32)> {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::System::Threading::GetCurrentProcessId;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId,
    };
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return None;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == GetCurrentProcessId() {
            return None;
        }
        let mut buf = [0u16; 64];
        let n = GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32).max(0) as usize;
        if matches!(String::from_utf16_lossy(&buf[..n]).as_str(), "Progman" | "WorkerW") {
            return None;
        }
        let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        (GetWindowRect(hwnd, &mut r) != 0).then_some((r.left, r.top, r.right, r.bottom))
    }
}

/// L'encoche de l'écran où se trouve la souris.
pub(crate) fn notch_under_cursor(app: &AppHandle) -> Option<WebviewWindow> {
    let cursor = app.cursor_position().ok()?;
    let notches: Vec<WebviewWindow> = app
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| label.starts_with(NOTCH_PREFIX))
        .map(|(_, w)| w)
        .collect();
    notches
        .iter()
        .find(|w| {
            w.current_monitor().ok().flatten().is_some_and(|m| {
                let (p, s) = (m.position(), m.size());
                cursor.x >= p.x as f64
                    && cursor.x < (p.x + s.width as i32) as f64
                    && cursor.y >= p.y as f64
                    && cursor.y < (p.y + s.height as i32) as f64
            })
        })
        .or(notches.first())
        .cloned()
}

/// Ctrl+Shift+Espace, partout dans Windows : appui court = écrire à l'assistant, appui long = lui parler.
fn register_assistant_shortcut(app: &AppHandle) -> tauri::Result<()> {
    use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
    let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
    app.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, pressed, event| {
                if pressed != &shortcut {
                    return;
                }
                let Some(win) = notch_under_cursor(app) else { return };
                let down = event.state() == ShortcutState::Pressed;
                if down {
                    // Le clavier va à l'encoche ; la souris continue de passer à travers hors de l'encoche.
                    let _ = win.set_focus();
                }
                let _ = app.emit_to(win.label(), "assistant-key", down);
            })
            .build(),
    )?;
    if let Err(e) = app.global_shortcut().register(shortcut) {
        eprintln!("Raccourci Ctrl+Shift+Espace indisponible : {e}");
    }
    Ok(())
}

/// Fenêtre classique (déplaçable, redimensionnable) pour tout configurer hors de l'encoche.
fn show_settings(app: &AppHandle, section: Option<String>) -> tauri::Result<()> {
    if let Some(win) = app.get_webview_window(SETTINGS_LABEL) {
        let _ = win.unminimize();
        win.show()?;
        win.set_focus()?;
        if let Some(section) = section {
            app.emit_to(SETTINGS_LABEL, "settings-section", section)?;
        }
        return Ok(());
    }
    let url = format!("index.html?window=settings&section={}", section.unwrap_or_default());
    WebviewWindowBuilder::new(app, SETTINGS_LABEL, WebviewUrl::App(url.into()))
        .title("Mégatron")
        .inner_size(1040.0, 680.0)
        .min_inner_size(820.0, 540.0)
        .decorations(false)
        .transparent(true)
        .center()
        .build()?;
    Ok(())
}

#[tauri::command]
async fn open_settings(app: AppHandle, section: Option<String>) -> Result<(), String> {
    show_settings(&app, section).map_err(|e| e.to_string())
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::tray::{MouseButton, TrayIconEvent};
    let open = MenuItem::with_id(app, "open", "Ouvrir Mégatron", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Réglages…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quitter Mégatron", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &settings, &quit])?;
    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Mégatron")
        .menu(&menu)
        // Le menu s'ouvre au clic droit ; un double-clic ouvre directement la fenêtre.
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } = event {
                let _ = show_settings(tray.app_handle(), None);
            }
        })
        .on_menu_event(|app, event| {
            match event.id.as_ref() {
                "quit" => app.exit(0),
                "open" => {
                    let _ = show_settings(app, None);
                }
                "settings" => {
                    let _ = show_settings(app, Some("settings".into()));
                }
                _ => {}
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Un seul Mégatron à la fois : relancer l'app ouvre simplement sa fenêtre (au lieu de doubler les encoches).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = show_settings(app, None);
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:megatron.db", migrations())
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(HitAreas::default())
        .invoke_handler(tauri::generate_handler![
            set_hit_area,
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
            open_settings,
            wake::wake_word_set,
            wake::wake_word_refresh,
            wake::wake_word_sensitivity,
            wake::wake_word_test
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            build_tray(&handle)?;
            register_assistant_shortcut(&handle)?;
            sync_notch_windows(&handle);
            spawn_hover_watcher(handle);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Mégatron");
}
