//! « Hey Mégatron » : la reconnaissance vocale intégrée à Windows écoute en continu, en local,
//! mais ne reconnaît que le mot d'éveil (liste de phrases fermée). Rien n'est enregistré ni envoyé.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};
use windows::core::HSTRING;
use windows::Foundation::{TimeSpan, TypedEventHandler};
use windows_collections::IIterable;
use windows::Globalization::Language;
use windows::Media::SpeechRecognition::{
    SpeechContinuousRecognitionCompletedEventArgs, SpeechContinuousRecognitionResultGeneratedEventArgs,
    SpeechContinuousRecognitionSession, SpeechRecognitionConfidence, SpeechRecognitionListConstraint,
    SpeechRecognitionHypothesisGeneratedEventArgs, SpeechRecognitionResultStatus, SpeechRecognizer,
    SpeechRecognizerState,
};

/// Les façons de prononcer le nom (le moteur ne connaît pas ce mot : on lui donne plusieurs graphies).
const NAMES: [&str; 4] = ["Mégatron", "Megatron", "Méga trône", "Mégatronne"];
const PREFIXES: [&str; 10] = ["", "Hey ", "Hé ", "Eh ", "Dis ", "OK ", "Salut ", "Bonjour ", "Coucou ", "Allô "];
/// Des leurres : sans eux, n'importe quelle parole est rapprochée du nom le plus proche.
/// Aucun ne doit ressembler au nom ni à une formule d'appel (« méga », « salut »… volaient les vraies détections).
const DECOYS: [&str; 16] = [
    "électron", "métro", "météo", "mais attends", "c'est bon", "d'accord", "merci", "oui", "non", "voilà",
    "écoute", "regarde", "j'ai pas compris", "qu'est-ce que tu fais", "on y va", "tu vois",
];
/// Certitude minimale (en millièmes) pour accepter une détection « faible » : réglable (sensibilité).
/// Windows connaît mal le mot « Mégatron » : même bien prononcé, il dépasse rarement 10 à 20 %.
static MIN_RAW_PERMILLE: AtomicU32 = AtomicU32::new(100);
/// Mode test des réglages : on montre ce qui est entendu sans lancer la conversation.
static TEST_MODE: AtomicBool = AtomicBool::new(false);
/// Une journée sans parole avant que Windows ne coupe la session (en unités de 100 ns).
const SILENCE_TIMEOUT: i64 = 24 * 3600 * 10_000_000;

struct Listener {
    recognizer: SpeechRecognizer,
    session: SpeechContinuousRecognitionSession,
    result_token: i64,
    completed_token: i64,
    hypothesis_token: i64,
}

// Les objets WinRT de la reconnaissance vocale sont « agiles » : utilisables depuis n'importe quel thread.
unsafe impl Send for Listener {}

static LISTENER: Mutex<Option<Listener>> = Mutex::new(None);

/// L'utilisateur veut l'écoute : si Windows la coupe, on la relance.
static ENABLED: AtomicBool = AtomicBool::new(false);
static APP: Mutex<Option<AppHandle>> = Mutex::new(None);
static WATCHDOG: AtomicBool = AtomicBool::new(false);
static STARTED_AT: Mutex<Option<Instant>> = Mutex::new(None);
/// Dernier déclenchement : l'hypothèse puis le résultat final d'une même phrase ne lancent qu'une conversation.
static LAST_FIRE: Mutex<Option<Instant>> = Mutex::new(None);

/// Prévient l'encoche de l'écran où se trouve la souris (une fois par phrase).
fn fire(app: &AppHandle) {
    if TEST_MODE.load(Ordering::Relaxed) {
        return;
    }
    {
        let mut last = LAST_FIRE.lock().unwrap();
        if last.is_some_and(|t| t.elapsed() < Duration::from_secs(4)) {
            return;
        }
        *last = Some(Instant::now());
    }
    if let Some(win) = crate::notch_under_cursor(app) {
        let _ = app.emit_to(win.label(), "wake-word", ());
    }
}

/// Une seule mise en route à la fois : deux écoutes lancées ensemble se disputent le micro et n'entendent plus rien.
static OP: Mutex<()> = Mutex::new(());

/// Vérification de l'état de l'écoute.
const CHECK_EVERY: Duration = Duration::from_secs(20);
/// Relance préventive : la reconnaissance de Windows se dégrade ou se fige parfois sans prévenir.
const REFRESH_EVERY: Duration = Duration::from_secs(10 * 60);

/// Recrée entièrement la reconnaissance (comme couper puis rallumer le réglage).
fn restart() {
    if !ENABLED.load(Ordering::SeqCst) {
        return;
    }
    let Some(app) = APP.lock().unwrap().clone() else { return };
    let _op = OP.lock().unwrap();
    stop();
    if let Err(e) = start(app) {
        eprintln!("[wake] relance impossible : {e}");
    }
}

fn restart_soon(delay: Duration) {
    std::thread::spawn(move || {
        std::thread::sleep(delay);
        restart();
    });
}

/// Surveille l'écoute : relance si elle s'est arrêtée, et la rafraîchit régulièrement quand personne ne parle.
fn spawn_watchdog() {
    if WATCHDOG.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(|| loop {
        std::thread::sleep(CHECK_EVERY);
        if !ENABLED.load(Ordering::SeqCst) {
            continue;
        }
        let state = LISTENER.lock().unwrap().as_ref().map(|l| l.recognizer.State());
        let stale = STARTED_AT.lock().unwrap().is_none_or(|t| t.elapsed() > REFRESH_EVERY);
        match state {
            // Plus d'écoute du tout, ou écoute arrêtée : on relance.
            None | Some(Err(_)) | Some(Ok(SpeechRecognizerState::Idle)) | Some(Ok(SpeechRecognizerState::Paused)) => restart(),
            // Elle écoute, mais depuis longtemps : rafraîchie si personne ne parle à ce moment.
            Some(Ok(SpeechRecognizerState::Capturing)) if stale => restart(),
            _ => {}
        }
    });
}

fn create_recognizer() -> windows::core::Result<SpeechRecognizer> {
    // Français si la voix française est installée, sinon la langue de Windows.
    Language::CreateLanguage(&HSTRING::from("fr-FR"))
        .and_then(|lang| SpeechRecognizer::Create(&lang))
        .or_else(|_| SpeechRecognizer::new())
}

fn start(app: AppHandle) -> Result<String, String> {
    let err = |e: windows::core::Error| e.message().to_string();
    let recognizer = create_recognizer().map_err(|e| {
        format!("Reconnaissance vocale de Windows indisponible : {}", e.message())
    })?;
    let wake: Vec<HSTRING> = PREFIXES
        .iter()
        .flat_map(|p| NAMES.iter().map(move |n| HSTRING::from(format!("{p}{n}"))))
        .collect();
    let decoys: Vec<HSTRING> = DECOYS.iter().map(|d| HSTRING::from(*d)).collect();
    let constraints = recognizer.Constraints().map_err(err)?;
    for (tag, list) in [("wake", wake), ("decoy", decoys)] {
        let phrases: IIterable<HSTRING> = list.into();
        let constraint = SpeechRecognitionListConstraint::CreateWithTag(&phrases, &HSTRING::from(tag)).map_err(err)?;
        constraints.Append(&constraint).map_err(err)?;
    }
    let compiled = recognizer.CompileConstraintsAsync().map_err(err)?.join().map_err(err)?;
    if compiled.Status().map_err(err)? != SpeechRecognitionResultStatus::Success {
        return Err("Windows n'a pas pu préparer la reconnaissance du mot « Mégatron ».".into());
    }

    // Valider la phrase après un court silence (par défaut, Windows attend plus longtemps).
    if let Ok(timeouts) = recognizer.Timeouts() {
        let _ = timeouts.SetEndSilenceTimeout(TimeSpan { Duration: 2_500_000 }); // 0,25 s
    }

    // Réaction immédiate : dès que le nom apparaît dans ce que Windows est en train de comprendre,
    // sans attendre la fin de la phrase.
    let early = app.clone();
    let hypothesis_token = recognizer
        .HypothesisGenerated(&TypedEventHandler::<SpeechRecognizer, SpeechRecognitionHypothesisGeneratedEventArgs>::new(
            move |_, args| {
                let Some(args) = args.as_ref() else { return Ok(()) };
                let text = args.Hypothesis()?.Text()?.to_string().to_lowercase().replace(' ', "");
                if text.contains("gatr") {
                    fire(&early);
                }
                Ok(())
            },
        ))
        .map_err(err)?;

    let session = recognizer.ContinuousRecognitionSession().map_err(err)?;
    let _ = session.SetAutoStopSilenceTimeout(TimeSpan { Duration: SILENCE_TIMEOUT });

    let handle = app.clone();
    let result_token = session
        .ResultGenerated(&TypedEventHandler::<
            SpeechContinuousRecognitionSession,
            SpeechContinuousRecognitionResultGeneratedEventArgs,
        >::new(move |_, args| {
            let Some(args) = args.as_ref() else { return Ok(()) };
            let result = args.Result()?;
            let confidence = result.Confidence()?;
            let raw = result.RawConfidence().unwrap_or(0.0);
            let text = result.Text()?.to_string().to_lowercase().replace(' ', "");
            let is_wake = result.Constraint().and_then(|c| c.Tag()).map(|t| t == "wake").unwrap_or(false)
                || text.contains("gatr");
            let confident = match confidence {
                SpeechRecognitionConfidence::High | SpeechRecognitionConfidence::Medium => true,
                SpeechRecognitionConfidence::Low => raw * 1000.0 >= MIN_RAW_PERMILLE.load(Ordering::Relaxed) as f64,
                _ => false,
            };
            if is_wake && confident {
                fire(&handle);
            }
            // Pour le mode test des réglages : ce que Windows a cru entendre, et ce qu'on en a fait.
            let level = match confidence {
                SpeechRecognitionConfidence::High => "high",
                SpeechRecognitionConfidence::Medium => "medium",
                SpeechRecognitionConfidence::Low => "low",
                _ => "rejected",
            };
            let _ = handle.emit(
                "wake-heard",
                serde_json::json!({
                    "text": result.Text().map(|t| t.to_string()).unwrap_or_default(),
                    "confidence": level,
                    "raw": raw,
                    "wake": is_wake,
                    "accepted": is_wake && confident,
                }),
            );
            Ok(())
        }))
        .map_err(err)?;

    // Si Windows coupe la session (veille, micro débranché…), on la relance.
    let completed_token = session
        .Completed(&TypedEventHandler::<
            SpeechContinuousRecognitionSession,
            SpeechContinuousRecognitionCompletedEventArgs,
        >::new(|_, _| {
            // Pas de relance ici même (on est dans le fil de Windows) : on recrée tout un peu plus tard.
            restart_soon(Duration::from_millis(800));
            Ok(())
        }))
        .map_err(err)?;

    session
        .StartAsync()
        .map_err(err)?
        .join()
        .map_err(|e| format!("Impossible d'écouter le micro : {}", e.message()))?;

    let language = recognizer
        .CurrentLanguage()
        .and_then(|l| l.DisplayName())
        .map(|n| n.to_string())
        .unwrap_or_default();
    *LISTENER.lock().unwrap() = Some(Listener { recognizer, session, result_token, completed_token, hypothesis_token });
    *STARTED_AT.lock().unwrap() = Some(Instant::now());
    Ok(language)
}

fn stop() {
    let listener = LISTENER.lock().unwrap().take();
    if let Some(l) = listener {
        let _ = l.session.RemoveCompleted(l.completed_token);
        let _ = l.session.RemoveResultGenerated(l.result_token);
        let _ = l.recognizer.RemoveHypothesisGenerated(l.hypothesis_token);
        if let Ok(op) = l.session.CancelAsync() {
            let _ = op.join();
        }
        let _ = l.recognizer.Close();
        // Windows met un instant à libérer le micro : relancer aussitôt donnait une écoute sourde.
        std::thread::sleep(Duration::from_millis(400));
    }
}

/// Active ou coupe l'écoute du mot d'éveil. Renvoie la langue de reconnaissance utilisée.
#[tauri::command]
pub async fn wake_word_set(app: AppHandle, enabled: bool) -> Result<String, String> {
    ENABLED.store(enabled, Ordering::SeqCst);
    *APP.lock().unwrap() = Some(app.clone());
    if enabled {
        spawn_watchdog();
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _op = OP.lock().unwrap();
        stop();
        if enabled {
            let res = start(app);
            if let Err(e) = &res {
                eprintln!("[wake] démarrage impossible : {e}");
            }
            res
        } else {
            Ok(String::new())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Relance l'écoute (après une conversation : Mégatron vient d'utiliser le micro lui-même).
#[tauri::command]
pub async fn wake_word_refresh() {
    let _ = tauri::async_runtime::spawn_blocking(restart).await;
}

/// Sensibilité du mot d'éveil : certitude minimale acceptée (0 à 1).
#[tauri::command]
pub fn wake_word_sensitivity(min_confidence: f64) {
    MIN_RAW_PERMILLE.store((min_confidence.clamp(0.0, 1.0) * 1000.0) as u32, Ordering::Relaxed);
}

/// Mode test : les phrases entendues sont affichées, sans déclencher la conversation.
#[tauri::command]
pub fn wake_word_test(enabled: bool) {
    TEST_MODE.store(enabled, Ordering::Relaxed);
}
