//! « Hey Mégatron » : la reconnaissance vocale intégrée à Windows écoute en continu, en local,
//! mais ne reconnaît que le mot d'éveil (liste de phrases fermée). Rien n'est enregistré ni envoyé.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter};
use windows::core::HSTRING;
use windows::Foundation::{TimeSpan, TypedEventHandler};
use windows_collections::IIterable;
use windows::Globalization::Language;
use windows::Media::SpeechRecognition::{
    SpeechContinuousRecognitionCompletedEventArgs, SpeechContinuousRecognitionResultGeneratedEventArgs,
    SpeechContinuousRecognitionSession, SpeechRecognitionConfidence, SpeechRecognitionListConstraint,
    SpeechRecognitionResultStatus, SpeechRecognizer,
};

/// Les façons de prononcer le nom (le moteur ne connaît pas ce mot : on lui donne plusieurs graphies).
const NAMES: [&str; 4] = ["Mégatron", "Megatron", "Méga trône", "Mégatronne"];
const PREFIXES: [&str; 7] = ["", "Hey ", "Hé ", "Eh ", "Dis ", "OK ", "Salut "];
/// Des leurres : sans eux, n'importe quelle parole est rapprochée du nom le plus proche
/// (« patron », « électron »…). Avec eux, on peut accepter les détections moins sûres.
const DECOYS: [&str; 22] = [
    "patron", "matrone", "électron", "Mégane", "méga", "métro", "météo", "mais attends", "c'est bon",
    "d'accord", "merci", "bonjour", "salut", "oui", "non", "voilà", "allô", "écoute", "regarde",
    "j'ai pas compris", "qu'est-ce que tu fais", "on y va",
];
/// En dessous, une détection « faible » est ignorée (0 à 1).
const MIN_RAW_CONFIDENCE: f64 = 0.25;
/// Une journée sans parole avant que Windows ne coupe la session (en unités de 100 ns).
const SILENCE_TIMEOUT: i64 = 24 * 3600 * 10_000_000;

struct Listener {
    recognizer: SpeechRecognizer,
    session: SpeechContinuousRecognitionSession,
    result_token: i64,
    completed_token: i64,
}

// Les objets WinRT de la reconnaissance vocale sont « agiles » : utilisables depuis n'importe quel thread.
unsafe impl Send for Listener {}

static LISTENER: Mutex<Option<Listener>> = Mutex::new(None);

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
                SpeechRecognitionConfidence::Low => raw >= MIN_RAW_CONFIDENCE,
                _ => false,
            };
            if is_wake && confident {
                if let Some(win) = crate::notch_under_cursor(&handle) {
                    let _ = handle.emit_to(win.label(), "wake-word", ());
                }
            }
            Ok(())
        }))
        .map_err(err)?;

    // Si Windows coupe la session (veille, micro débranché…), on la relance.
    let completed_token = session
        .Completed(&TypedEventHandler::<
            SpeechContinuousRecognitionSession,
            SpeechContinuousRecognitionCompletedEventArgs,
        >::new(|sender, _| {
            if let Some(session) = sender.as_ref() {
                if let Ok(op) = session.StartAsync() {
                    let _ = op.join();
                }
            }
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
    *LISTENER.lock().unwrap() = Some(Listener { recognizer, session, result_token, completed_token });
    Ok(language)
}

fn stop() {
    if let Some(l) = LISTENER.lock().unwrap().take() {
        let _ = l.session.RemoveCompleted(l.completed_token);
        let _ = l.session.RemoveResultGenerated(l.result_token);
        if let Ok(op) = l.session.CancelAsync() {
            let _ = op.join();
        }
        let _ = l.recognizer.Close();
    }
}

/// Active ou coupe l'écoute du mot d'éveil. Renvoie la langue de reconnaissance utilisée.
#[tauri::command]
pub async fn wake_word_set(app: AppHandle, enabled: bool) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        stop();
        if enabled {
            start(app)
        } else {
            Ok(String::new())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
