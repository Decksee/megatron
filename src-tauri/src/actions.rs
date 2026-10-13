//! Actions sur le PC que l'assistant peut déclencher. Liste blanche volontairement courte :
//! ouvrir (apps, sites, dossiers), touches multimédia, verrouillage. Aucune commande libre.

use std::os::windows::process::CommandExt;
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const APPS_CACHE_TTL: Duration = Duration::from_secs(600);

#[derive(Clone, serde::Deserialize)]
struct StartApp {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "AppID")]
    app_id: String,
}

static APPS: Mutex<Option<(Instant, Vec<StartApp>)>> = Mutex::new(None);

/// Applications du menu Démarrer (bureau et Microsoft Store), via Get-StartApps. Mis en cache 10 min.
fn start_apps() -> Result<Vec<StartApp>, String> {
    if let Some((at, apps)) = APPS.lock().unwrap().as_ref() {
        if at.elapsed() < APPS_CACHE_TTL {
            return Ok(apps.clone());
        }
    }
    let out = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | ConvertTo-Json -Compress",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("Impossible de lister les applications : {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout);
    let value: serde_json::Value = serde_json::from_str(text.trim()).map_err(|e| e.to_string())?;
    // Une seule app → objet ; plusieurs → tableau.
    let apps: Vec<StartApp> = if value.is_array() {
        serde_json::from_value(value).map_err(|e| e.to_string())?
    } else {
        vec![serde_json::from_value(value).map_err(|e| e.to_string())?]
    };
    *APPS.lock().unwrap() = Some((Instant::now(), apps.clone()));
    Ok(apps)
}

fn normalize(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| match c {
            'à' | 'â' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'î' | 'ï' => 'i',
            'ô' | 'ö' => 'o',
            'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            c => c,
        })
        .collect()
}

/// Plus le score est haut, mieux c'est ; 0 = pas de correspondance.
fn score(name: &str, query: &str) -> u32 {
    let (n, q) = (normalize(name), normalize(query));
    if n == q {
        100
    } else if n.starts_with(&q) {
        80
    } else if n.split_whitespace().any(|w| w.starts_with(&q)) {
        60
    } else if n.contains(&q) {
        40
    } else if q.split_whitespace().all(|w| n.contains(w)) {
        20
    } else {
        0
    }
}

#[tauri::command]
pub async fn open_app(name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let apps = start_apps()?;
        let best = apps
            .iter()
            .map(|a| (score(&a.name, &name), a))
            .filter(|(s, _)| *s > 0)
            // À score égal, le nom le plus court (« Spotify » avant « Spotify Widget »).
            .max_by(|(sa, a), (sb, b)| sa.cmp(sb).then(b.name.len().cmp(&a.name.len())))
            .map(|(_, a)| a.clone())
            .ok_or_else(|| format!("Aucune application « {name} » trouvée dans le menu Démarrer."))?;
        Command::new("explorer.exe")
            .arg(format!("shell:AppsFolder\\{}", best.app_id))
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(best.name)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn shell_open(target: &str) -> Result<(), String> {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let (verb, file) = (wide("open"), wide(target));
    let res = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    // ShellExecuteW renvoie une valeur > 32 en cas de succès.
    if res as isize > 32 {
        Ok(())
    } else {
        Err(format!("Impossible d'ouvrir {target}"))
    }
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    let lower = url.trim().to_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return Err("Seuls les liens http(s) peuvent être ouverts.".into());
    }
    shell_open(url.trim())
}

#[tauri::command]
pub fn open_folder(folder: String) -> Result<(), String> {
    // Les dossiers « shell: » suivent les redirections (OneDrive…).
    let target = match folder.as_str() {
        "documents" => "shell:Personal",
        "telechargements" => "shell:Downloads",
        "bureau" => "shell:Desktop",
        "images" => "shell:My Pictures",
        "musique" => "shell:My Music",
        "videos" => "shell:My Video",
        _ => return Err(format!("Dossier inconnu : {folder}")),
    };
    Command::new("explorer.exe")
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn media_key(action: String, times: Option<u32>) -> Result<(), String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        keybd_event, KEYEVENTF_KEYUP, VK_MEDIA_NEXT_TRACK, VK_MEDIA_PLAY_PAUSE, VK_MEDIA_PREV_TRACK,
        VK_VOLUME_DOWN, VK_VOLUME_MUTE, VK_VOLUME_UP,
    };
    let vk = match action.as_str() {
        "lecture_pause" => VK_MEDIA_PLAY_PAUSE,
        "suivant" => VK_MEDIA_NEXT_TRACK,
        "precedent" => VK_MEDIA_PREV_TRACK,
        "volume_plus" => VK_VOLUME_UP,
        "volume_moins" => VK_VOLUME_DOWN,
        "muet" => VK_VOLUME_MUTE,
        _ => return Err(format!("Action multimédia inconnue : {action}")),
    } as u8;
    // Une pression de volume = 2 %.
    let n = if action.starts_with("volume") { times.unwrap_or(5).clamp(1, 50) } else { 1 };
    for _ in 0..n {
        unsafe {
            keybd_event(vk, 0, 0, 0);
            keybd_event(vk, 0, KEYEVENTF_KEYUP, 0);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn lock_screen() -> Result<(), String> {
    use windows_sys::Win32::System::Shutdown::LockWorkStation;
    if unsafe { LockWorkStation() } != 0 {
        Ok(())
    } else {
        Err("Impossible de verrouiller la session.".into())
    }
}

/// Ouvre l'outil Capture d'écran de Windows (sélection d'une zone).
#[tauri::command]
pub fn screen_snip() -> Result<(), String> {
    shell_open("ms-screenclip:")
}
