//! Musique en cours (Spotify, navigateur, Deezer… : tout ce qui s'affiche dans le panneau média de Windows)
//! et volume principal du PC.

use std::sync::Mutex;

use base64::Engine;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as SessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
};
use windows::Media::MediaPlaybackAutoRepeatMode as RepeatMode;
use windows::Storage::Streams::DataReader;

/// Écart entre l'époque Windows (1601) et Unix (1970), en unités de 100 ns.
const WINDOWS_TO_UNIX_EPOCH: i64 = 116_444_736_000_000_000;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaState {
    title: String,
    artist: String,
    album: String,
    app: String,
    playing: bool,
    position_ms: i64,
    duration_ms: i64,
    /// Moment (ms Unix) où Windows a relevé la position : la page extrapole tant que ça joue.
    updated_at_ms: i64,
    /// Pochette en data URL.
    artwork: Option<String>,
    /// Lecture aléatoire (None si le lecteur ne la gère pas).
    shuffle: Option<bool>,
    /// "none" | "track" | "list" (None si non géré).
    repeat: Option<String>,
}

/// La pochette ne change qu'avec le morceau : on la garde pour éviter de la relire à chaque seconde.
static ARTWORK: Mutex<Option<(String, Option<String>)>> = Mutex::new(None);

fn current_session() -> windows::core::Result<Session> {
    SessionManager::RequestAsync()?.join()?.GetCurrentSession()
}

fn read_artwork(props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties) -> Option<String> {
    let stream = props.Thumbnail().ok()?.OpenReadAsync().ok()?.join().ok()?;
    let size = stream.Size().ok()? as u32;
    if size == 0 {
        return None;
    }
    let mime = stream.ContentType().map(|c| c.to_string()).unwrap_or_default();
    let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0).ok()?).ok()?;
    reader.LoadAsync(size).ok()?.join().ok()?;
    let mut bytes = vec![0u8; size as usize];
    reader.ReadBytes(&mut bytes).ok()?;
    let mime = if mime.starts_with("image/") { mime } else { "image/png".into() };
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

fn media_state_blocking() -> Option<MediaState> {
    let session = current_session().ok()?;
    let props = session.TryGetMediaPropertiesAsync().ok()?.join().ok()?;
    let title = props.Title().map(|s| s.to_string()).unwrap_or_default();
    if title.is_empty() {
        return None;
    }
    let artist = props.Artist().map(|s| s.to_string()).unwrap_or_default();
    let album = props.AlbumTitle().map(|s| s.to_string()).unwrap_or_default();

    let key = format!("{title}\u{1}{artist}");
    let artwork = {
        let cached = ARTWORK.lock().unwrap().clone();
        match cached {
            Some((k, art)) if k == key => art,
            _ => {
                let art = read_artwork(&props);
                *ARTWORK.lock().unwrap() = Some((key, art.clone()));
                art
            }
        }
    };

    let info = session.GetPlaybackInfo().ok();
    let playing = info
        .as_ref()
        .and_then(|p| p.PlaybackStatus().ok())
        .is_some_and(|s| s == PlaybackStatus::Playing);
    let shuffle = info.as_ref().and_then(|p| p.IsShuffleActive().ok()).and_then(|v| v.Value().ok());
    let repeat = info
        .as_ref()
        .and_then(|p| p.AutoRepeatMode().ok())
        .and_then(|v| v.Value().ok())
        .map(|m| match m {
            RepeatMode::Track => "track",
            RepeatMode::List => "list",
            _ => "none",
        }.to_string());
    let (position_ms, duration_ms, updated_at_ms) = session
        .GetTimelineProperties()
        .map(|t| {
            let pos = t.Position().map(|d| d.Duration / 10_000).unwrap_or(0);
            let end = t.EndTime().map(|d| d.Duration / 10_000).unwrap_or(0);
            let updated = t
                .LastUpdatedTime()
                .map(|d| (d.UniversalTime - WINDOWS_TO_UNIX_EPOCH) / 10_000)
                .unwrap_or(0);
            (pos, end, updated)
        })
        .unwrap_or((0, 0, 0));
    let app = session.SourceAppUserModelId().map(|s| s.to_string()).unwrap_or_default();

    Some(MediaState {
        title,
        artist,
        album,
        app,
        playing,
        position_ms,
        duration_ms,
        updated_at_ms,
        artwork,
        shuffle,
        repeat,
    })
}

#[tauri::command]
pub async fn media_state() -> Option<MediaState> {
    tauri::async_runtime::spawn_blocking(media_state_blocking).await.ok().flatten()
}

/// Lecture/pause, suivant, précédent, ou déplacement dans le morceau (`seek` + position en ms).
#[tauri::command]
pub async fn media_control(action: String, position_ms: Option<i64>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> windows::core::Result<()> {
        let session = current_session()?;
        match action.as_str() {
            "play_pause" => session.TryTogglePlayPauseAsync()?.join()?,
            "next" => session.TrySkipNextAsync()?.join()?,
            "previous" => session.TrySkipPreviousAsync()?.join()?,
            "seek" => session.TryChangePlaybackPositionAsync(position_ms.unwrap_or(0) * 10_000)?.join()?,
            "shuffle" => {
                let info = session.GetPlaybackInfo()?;
                let on = info.IsShuffleActive().and_then(|v| v.Value()).unwrap_or(false);
                session.TryChangeShuffleActiveAsync(!on)?.join()?
            }
            // Répéter : rien → liste → morceau → rien.
            "repeat" => {
                let info = session.GetPlaybackInfo()?;
                let next = match info.AutoRepeatMode().and_then(|v| v.Value()).unwrap_or(RepeatMode::None) {
                    RepeatMode::None => RepeatMode::List,
                    RepeatMode::List => RepeatMode::Track,
                    _ => RepeatMode::None,
                };
                session.TryChangeAutoRepeatModeAsync(next)?.join()?
            }
            _ => return Ok(()),
        };
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("Aucun lecteur ne répond : {}", e.message()))
}

// ---------- Volume ----------

#[derive(serde::Serialize)]
pub struct VolumeState {
    level: f32,
    muted: bool,
}

fn with_endpoint<T>(f: impl FnOnce(&windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume) -> windows::core::Result<T>) -> Result<T, String> {
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let run = || -> windows::core::Result<T> {
            let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
            let volume: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None)?;
            f(&volume)
        };
        run().map_err(|e| format!("Volume indisponible : {}", e.message()))
    }
}

#[tauri::command]
pub async fn volume_get() -> Result<VolumeState, String> {
    tauri::async_runtime::spawn_blocking(|| {
        with_endpoint(|v| unsafe {
            Ok(VolumeState { level: v.GetMasterVolumeLevelScalar()?, muted: v.GetMute()?.as_bool() })
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// `level` entre 0 et 1 ; `muted` pour couper / rétablir le son.
#[tauri::command]
pub async fn volume_set(level: Option<f32>, muted: Option<bool>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_endpoint(|v| unsafe {
            if let Some(level) = level {
                v.SetMasterVolumeLevelScalar(level.clamp(0.0, 1.0), std::ptr::null())?;
            }
            if let Some(muted) = muted {
                v.SetMute(muted, std::ptr::null())?;
            }
            Ok(())
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Niveau sonore qui sort du PC en ce moment (0 à 1), pour animer les courbes au-dessus de la barre.
#[tauri::command]
pub async fn audio_peak() -> f32 {
    tauri::async_runtime::spawn_blocking(|| {
        use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
        use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
        use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let run = || -> windows::core::Result<f32> {
                let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
                let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
                let meter: IAudioMeterInformation = device.Activate(CLSCTX_ALL, None)?;
                meter.GetPeakValue()
            };
            run().unwrap_or(0.0)
        }
    })
    .await
    .unwrap_or(0.0)
}
