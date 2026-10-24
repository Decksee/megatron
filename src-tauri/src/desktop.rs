//! Ordinateur (Windows) : encoches au-dessus de chaque écran, fenêtre de réglages, icône de la zone
//! de notification et raccourci Ctrl+Shift+Espace. Rien de tout ça n'existe sur téléphone.

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    thread,
    time::Duration,
};

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, LogicalSize, Manager, Monitor, PhysicalPosition, WebviewUrl,
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
pub(crate) struct HitAreas(Mutex<HashMap<String, HitArea>>);

/// Une encoche vient de (re)charger sa page : l'état connu (survol, fenêtre derrière, plein écran)
/// est oublié pour lui être renvoyé au prochain passage, sinon elle l'ignorerait jusqu'au prochain changement.
static RESYNC: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub(crate) fn notch_resync() {
    RESYNC.store(true, Ordering::Relaxed);
}

#[tauri::command]
pub(crate) fn set_hit_area(
    window: WebviewWindow,
    areas: tauri::State<HitAreas>,
    width: f64,
    height: f64,
    interactive: Option<bool>,
) {
    let area = HitArea { width, height, interactive: interactive.unwrap_or(true) };
    areas.0.lock().unwrap().insert(window.label().to_string(), area);
}

fn monitor_label(m: &Monitor) -> String {
    let (p, s) = (m.position(), m.size());
    format!("{NOTCH_PREFIX}{}_{}_{}_{}", p.x, p.y, s.width, s.height)
}

/// Place la fenêtre centrée en haut de son écran. On la pose d'abord sur l'écran (Windows lui donne alors
/// l'échelle de cet écran), puis on la dimensionne en unités logiques — c'est-à-dire avec l'échelle qu'elle
/// utilise vraiment pour dessiner — et on la centre d'après sa largeur réelle. Sinon, entre deux écrans à
/// mises à l'échelle différentes, la fenêtre peut être trop étroite et couper l'encoche ouverte.
fn place_on_monitor(win: &WebviewWindow, m: &Monitor) {
    let (mp, ms) = (m.position(), m.size());
    let _ = win.set_position(PhysicalPosition::new(mp.x + ms.width as i32 / 4, mp.y));
    let _ = win.set_size(LogicalSize::new(WINDOW_W, WINDOW_H));
    let width = win
        .outer_size()
        .map(|s| s.width as i32)
        .unwrap_or((WINDOW_W * m.scale_factor()).round() as i32);
    let _ = win.set_position(PhysicalPosition::new(mp.x + (ms.width as i32 - width) / 2, mp.y));
}

/// L'encoche n'est plus centrée en haut de son écran, ou sa taille ne correspond plus à son échelle
/// (quelques pixels de marge pour les arrondis).
fn is_misplaced(win: &WebviewWindow, m: &Monitor) -> bool {
    let (Ok(pos), Ok(size), Ok(scale)) = (win.outer_position(), win.outer_size(), win.scale_factor()) else {
        return false;
    };
    let expected = (WINDOW_W * scale).round() as i32;
    let x = m.position().x + (m.size().width as i32 - size.width as i32) / 2;
    (pos.x - x).abs() > 4 || (pos.y - m.position().y).abs() > 4 || (size.width as i32 - expected).abs() > 4
}

/// Une encoche par écran : crée celles qui manquent, replace celles qui ont bougé, ferme celles des écrans débranchés.
pub(crate) fn sync_notch_windows(app: &AppHandle) {
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
pub(crate) fn spawn_hover_watcher(app: AppHandle) {
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
            if RESYNC.swap(false, Ordering::Relaxed) {
                inside.clear();
                occupied.clear();
                hidden.clear();
                // Forcer un contrôle « fenêtre derrière » dès ce passage.
                tick = tick - tick % BEHIND_EVERY;
            }
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
pub(crate) fn register_assistant_shortcut(app: &AppHandle) -> tauri::Result<()> {
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
pub(crate) fn show_settings(app: &AppHandle, section: Option<String>) -> tauri::Result<()> {
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
pub(crate) async fn open_settings(app: AppHandle, section: Option<String>) -> Result<(), String> {
    show_settings(&app, section).map_err(|e| e.to_string())
}

pub(crate) fn build_tray(app: &AppHandle) -> tauri::Result<()> {
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

/// Mise en place au lancement : icône, raccourci, une encoche par écran et surveillance du survol.
pub(crate) fn setup(app: &AppHandle) -> tauri::Result<()> {
    build_tray(app)?;
    register_assistant_shortcut(app)?;
    sync_notch_windows(app);
    spawn_hover_watcher(app.clone());
    Ok(())
}
