//! Assistant IA : clés API (Gestionnaire d'identification Windows) et appels aux fournisseurs.
//! Les requêtes partent d'ici (et non de la page) pour que la clé ne quitte jamais le côté Rust.

use base64::Engine;
use std::time::Duration;

use serde_json::{json, Value};

const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1";
const OPENAI_URL: &str = "https://api.openai.com/v1";
const GEMINI_URL: &str = "https://generativelanguage.googleapis.com/v1beta";

// ---------- Clés : Gestionnaire d'identification Windows ----------

fn target(slot: &str) -> Vec<u16> {
    format!("megatron:{slot}").encode_utf16().chain(Some(0)).collect()
}

#[cfg(windows)]
pub(crate) fn read_key(slot: &str) -> Option<String> {
    use windows_sys::Win32::Security::Credentials::{CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC};
    unsafe {
        let mut cred: *mut CREDENTIALW = std::ptr::null_mut();
        if CredReadW(target(slot).as_ptr(), CRED_TYPE_GENERIC, 0, &mut cred) == 0 || cred.is_null() {
            return None;
        }
        let c = &*cred;
        let bytes = std::slice::from_raw_parts(c.CredentialBlob, c.CredentialBlobSize as usize);
        let key = String::from_utf8(bytes.to_vec()).ok();
        CredFree(cred as *const _);
        key.filter(|k| !k.is_empty())
    }
}

#[cfg(windows)]
fn write_key(slot: &str, key: &str) -> Result<(), String> {
    use windows_sys::Win32::Security::Credentials::{
        CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    };
    let mut name = target(slot);
    let mut user: Vec<u16> = "megatron".encode_utf16().chain(Some(0)).collect();
    let mut blob = key.as_bytes().to_vec();
    unsafe {
        let mut cred: CREDENTIALW = std::mem::zeroed();
        cred.Type = CRED_TYPE_GENERIC;
        cred.TargetName = name.as_mut_ptr();
        cred.UserName = user.as_mut_ptr();
        cred.CredentialBlobSize = blob.len() as u32;
        cred.CredentialBlob = blob.as_mut_ptr();
        cred.Persist = CRED_PERSIST_LOCAL_MACHINE;
        if CredWriteW(&cred, 0) == 0 {
            return Err("Impossible d'enregistrer la clé dans Windows.".into());
        }
    }
    Ok(())
}

#[cfg(windows)]
fn delete_key(slot: &str) {
    use windows_sys::Win32::Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC};
    unsafe {
        CredDeleteW(target(slot).as_ptr(), CRED_TYPE_GENERIC, 0);
    }
}

#[tauri::command]
pub fn ai_set_key(slot: String, key: String) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() {
        delete_key(&slot);
        return Ok(());
    }
    write_key(&slot, key)
}

#[tauri::command]
pub fn ai_has_key(slot: String) -> bool {
    read_key(&slot).is_some()
}

#[tauri::command]
pub fn ai_delete_key(slot: String) {
    delete_key(&slot);
}

// ---------- Requêtes ----------

fn require_key(slot: &str) -> Result<String, String> {
    read_key(slot).ok_or_else(|| "Aucune clé API enregistrée (onglet IA → réglages).".into())
}

fn openai_base(base_url: &Option<String>) -> String {
    base_url
        .as_deref()
        .map(str::trim)
        .filter(|b| !b.is_empty())
        .map(|b| b.trim_end_matches('/').to_string())
        .unwrap_or_else(|| OPENAI_URL.to_string())
}

/// Le repli automatique côté serveur (si un modèle refuse, l'API relance sur un autre) n'existe
/// que sur certains modèles Claude.
fn supports_fallbacks(model: &str) -> bool {
    matches!(model, "claude-opus-5-5" | "claude-opus-5" | "claude-fable-5-1" | "claude-sonnet-5-5")
}

pub(crate) fn error_message(text: &str) -> String {
    let parsed: Option<Value> = serde_json::from_str(text).ok();
    let msg = parsed.as_ref().and_then(|v| {
        v["error"]["message"]
            .as_str()
            .or_else(|| v["error"].as_str())
            .or_else(|| v["message"].as_str())
            .map(str::to_string)
    });
    msg.unwrap_or_else(|| text.chars().take(300).collect())
}

/// Client HTTP avec délais : sans eux, un fournisseur qui ne répond pas bloquerait l'assistant indéfiniment.
pub(crate) fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .build()
        .unwrap_or_default()
}

async fn send(req: reqwest::RequestBuilder) -> Result<Value, String> {
    let res = req.send().await.map_err(|e| {
        if e.is_timeout() {
            "Le fournisseur d'IA ne répond pas (délai dépassé). Réessaie ou choisis un autre modèle.".to_string()
        } else {
            format!("Connexion impossible : {e}")
        }
    })?;
    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let hint = match status.as_u16() {
            401 | 403 => " (clé API refusée)",
            429 => " (trop de requêtes ou quota atteint)",
            _ => "",
        };
        return Err(format!("Erreur {}{hint} : {}", status.as_u16(), error_message(&text)));
    }
    serde_json::from_str(&text).map_err(|e| format!("Réponse illisible : {e}"))
}

/// Envoie une requête de conversation déjà mise en forme pour le fournisseur ; renvoie sa réponse brute.
#[tauri::command]
pub async fn ai_chat(
    provider: String,
    slot: String,
    model: String,
    base_url: Option<String>,
    mut body: Value,
) -> Result<Value, String> {
    let client = client();
    match provider.as_str() {
        "anthropic" => {
            let key = require_key(&slot)?;
            body["model"] = json!(model);
            let mut req = client
                .post(format!("{ANTHROPIC_URL}/messages"))
                .header("x-api-key", key)
                .header("anthropic-version", "2023-06-01");
            if supports_fallbacks(&model) {
                body["fallbacks"] = json!("default");
                req = req.header("anthropic-beta", "server-side-fallback-2026-07-01");
            }
            send(req.json(&body)).await
        }
        "openai" | "compatible" => {
            body["model"] = json!(model);
            let mut req = client.post(format!("{}/chat/completions", openai_base(&base_url)));
            // Un serveur local (Ollama, LM Studio…) peut se passer de clé.
            match read_key(&slot) {
                Some(key) => req = req.bearer_auth(key),
                None if provider == "openai" => return Err(require_key(&slot).unwrap_err()),
                None => {}
            }
            send(req.json(&body)).await
        }
        "gemini" => {
            let key = require_key(&slot)?;
            let req = client
                .post(format!("{GEMINI_URL}/models/{model}:generateContent"))
                .header("x-goog-api-key", key);
            send(req.json(&body)).await
        }
        _ => Err(format!("Fournisseur inconnu : {provider}")),
    }
}

/// Modèles disponibles pour la clé enregistrée (pour ne pas coder en dur des noms qui changent).
#[tauri::command]
pub async fn ai_list_models(provider: String, slot: String, base_url: Option<String>) -> Result<Vec<String>, String> {
    let client = client();
    let mut ids: Vec<String> = match provider.as_str() {
        "anthropic" => {
            let req = client
                .get(format!("{ANTHROPIC_URL}/models?limit=100"))
                .header("x-api-key", require_key(&slot)?)
                .header("anthropic-version", "2023-06-01");
            let v = send(req).await?;
            v["data"].as_array().into_iter().flatten().filter_map(|m| m["id"].as_str().map(String::from)).collect()
        }
        "openai" | "compatible" => {
            let mut req = client.get(format!("{}/models", openai_base(&base_url)));
            if let Some(key) = read_key(&slot) {
                req = req.bearer_auth(key);
            }
            let v = send(req).await?;
            v["data"].as_array().into_iter().flatten().filter_map(|m| m["id"].as_str().map(String::from)).collect()
        }
        "gemini" => {
            let req = client
                .get(format!("{GEMINI_URL}/models?pageSize=200"))
                .header("x-goog-api-key", require_key(&slot)?);
            let v = send(req).await?;
            v["models"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|m| {
                    m["supportedGenerationMethods"]
                        .as_array()
                        .is_some_and(|a| a.iter().any(|x| x == "generateContent"))
                })
                .filter_map(|m| m["name"].as_str().map(|n| n.trim_start_matches("models/").to_string()))
                .collect()
        }
        _ => return Err(format!("Fournisseur inconnu : {provider}")),
    };
    ids.sort();
    ids.dedup();
    Ok(ids)
}

/// Transcrit un enregistrement WAV (base64) en texte, via Gemini ou OpenAI.
#[tauri::command]
pub async fn ai_transcribe(
    provider: String,
    slot: String,
    model: String,
    base_url: Option<String>,
    wav_base64: String,
    mime: Option<String>,
) -> Result<String, String> {
    let client = client();
    // WAV du micro, ou OGG des messages vocaux Telegram.
    let mime = match mime.as_deref() {
        Some("audio/ogg") => "audio/ogg",
        _ => "audio/wav",
    };
    let file_name = if mime == "audio/ogg" { "voix.ogg" } else { "voix.wav" };
    match provider.as_str() {
        "gemini" => {
            let body = json!({
                "contents": [{
                    "role": "user",
                    "parts": [
                        { "inline_data": { "mime_type": mime, "data": wav_base64 } },
                        { "text": "Transcris mot pour mot ce que dit la personne (en français le plus souvent). Réponds uniquement par la transcription, sans guillemets ni commentaire. Si on n'entend rien, réponds par une chaîne vide." }
                    ]
                }]
            });
            let req = client
                .post(format!("{GEMINI_URL}/models/{model}:generateContent"))
                .header("x-goog-api-key", require_key(&slot)?);
            let v = send(req.json(&body)).await?;
            let text = v["candidates"][0]["content"]["parts"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|p| p["text"].as_str())
                .collect::<String>();
            Ok(text.trim().to_string())
        }
        "openai" | "compatible" => {
            let audio = base64::engine::general_purpose::STANDARD
                .decode(wav_base64)
                .map_err(|e| e.to_string())?;
            let part = reqwest::multipart::Part::bytes(audio)
                .file_name(file_name)
                .mime_str(mime)
                .map_err(|e| e.to_string())?;
            let form = reqwest::multipart::Form::new()
                .part("file", part)
                .text("model", if model.is_empty() { "whisper-1".to_string() } else { model });
            let mut req = client.post(format!("{}/audio/transcriptions", openai_base(&base_url)));
            if let Some(key) = read_key(&slot) {
                req = req.bearer_auth(key);
            }
            let v = send(req.multipart(form)).await?;
            Ok(v["text"].as_str().unwrap_or_default().trim().to_string())
        }
        _ => Err("La voix fonctionne avec une clé Gemini ou OpenAI.".into()),
    }
}

/// Ajoute un en-tête WAV à de l'audio brut (PCM 16 bits mono), comme le renvoie Gemini.
fn pcm_to_wav(pcm: &[u8], rate: u32) -> Vec<u8> {
    let mut out = Vec::with_capacity(44 + pcm.len());
    let len = pcm.len() as u32;
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&len.to_le_bytes());
    out.extend_from_slice(pcm);
    out
}

/// Fait lire un texte par une voix en ligne (Gemini ou OpenAI). Renvoie l'audio en data URL WAV.
#[tauri::command]
pub async fn ai_speak(
    provider: String,
    slot: String,
    model: String,
    voice: String,
    style: String,
    text: String,
    region: Option<String>,
    pitch: Option<String>,
) -> Result<String, String> {
    let b64 = base64::engine::general_purpose::STANDARD;
    let client = client();
    let wav = match provider.as_str() {
        "gemini" => {
            let prompt = if style.is_empty() { text } else { format!("{style} : {text}") };
            let body = json!({
                "contents": [{ "role": "user", "parts": [{ "text": prompt }] }],
                "generationConfig": {
                    "responseModalities": ["AUDIO"],
                    "speechConfig": { "voiceConfig": { "prebuiltVoiceConfig": { "voiceName": voice } } }
                }
            });
            let req = client
                .post(format!("{GEMINI_URL}/models/{model}:generateContent"))
                .header("x-goog-api-key", require_key(&slot)?);
            let v = send(req.json(&body)).await?;
            let part = v["candidates"][0]["content"]["parts"]
                .as_array()
                .into_iter()
                .flatten()
                .find_map(|p| p["inlineData"].as_object().or_else(|| p["inline_data"].as_object()).cloned())
                .ok_or("Gemini n'a pas renvoyé d'audio.")?;
            let pcm = b64.decode(part["data"].as_str().unwrap_or_default()).map_err(|e| e.to_string())?;
            // « audio/L16;codec=pcm;rate=24000 »
            let rate = part["mimeType"]
                .as_str()
                .and_then(|m| m.split("rate=").nth(1))
                .and_then(|r| r.parse().ok())
                .unwrap_or(24_000);
            pcm_to_wav(&pcm, rate)
        }
        "openai" => {
            let mut body = json!({ "model": model, "voice": voice, "input": text, "response_format": "wav" });
            if !style.is_empty() {
                body["instructions"] = json!(style);
            }
            let res = client
                .post(format!("{OPENAI_URL}/audio/speech"))
                .bearer_auth(require_key(&slot)?)
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Connexion impossible : {e}"))?;
            let status = res.status();
            if !status.is_success() {
                let text = res.text().await.unwrap_or_default();
                return Err(format!("Erreur {} : {}", status.as_u16(), error_message(&text)));
            }
            res.bytes().await.map_err(|e| e.to_string())?.to_vec()
        }
        "azure" => {
            let region = azure_region(region.as_deref())?;
            let pitch = pitch.filter(|p| p.chars().all(|c| c.is_ascii_digit() || "+-%.".contains(c)));
            let voice_name = if voice.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') { voice } else { String::new() };
            let lang = voice_name.get(..5).unwrap_or("fr-FR").to_string();
            let inner = match pitch {
                Some(p) => format!("<prosody pitch='{p}'>{}</prosody>", xml_escape(&text)),
                None => xml_escape(&text),
            };
            let ssml = format!(
                "<speak version='1.0' xml:lang='{lang}' xmlns='http://www.w3.org/2001/10/synthesis'><voice name='{voice_name}'>{inner}</voice></speak>"
            );
            let res = client
                .post(format!("https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"))
                .header("Ocp-Apim-Subscription-Key", require_key(&slot)?)
                .header("Content-Type", "application/ssml+xml")
                .header("X-Microsoft-OutputFormat", "riff-24khz-16bit-mono-pcm")
                .header("User-Agent", "megatron")
                .body(ssml)
                .send()
                .await
                .map_err(|e| format!("Connexion impossible : {e}"))?;
            let status = res.status();
            if !status.is_success() {
                let retry = res
                    .headers()
                    .get("retry-after")
                    .and_then(|v| v.to_str().ok())
                    .map(|v| format!(" Please retry in {v}s."))
                    .unwrap_or_default();
                let text = res.text().await.unwrap_or_default();
                let hint = match status.as_u16() {
                    401 | 403 => " (clé ou région refusée)",
                    429 => " (trop de requêtes ou quota atteint)",
                    _ => "",
                };
                return Err(format!("Erreur {}{hint} : {}{retry}", status.as_u16(), error_message(&text)));
            }
            res.bytes().await.map_err(|e| e.to_string())?.to_vec()
        }
        _ => return Err("Les voix en ligne fonctionnent avec une clé Azure, Gemini ou OpenAI.".into()),
    };
    Ok(format!("data:audio/wav;base64,{}", b64.encode(wav)))
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('\'', "&apos;").replace('"', "&quot;")
}

/// La région Azure entre dans l'adresse : on n'accepte que des lettres et des chiffres (« francecentral »).
fn azure_region(region: Option<&str>) -> Result<String, String> {
    let r = region.unwrap_or_default().trim().to_lowercase();
    if r.is_empty() || !r.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Région Azure invalide.".into());
    }
    Ok(r)
}

/// Les voix Azure disponibles (sert aussi à vérifier la clé et la région).
#[tauri::command]
pub async fn azure_voices(slot: String, region: String) -> Result<Vec<Value>, String> {
    let region = azure_region(Some(&region))?;
    let req = client()
        .get(format!("https://{region}.tts.speech.microsoft.com/cognitiveservices/voices/list"))
        .header("Ocp-Apim-Subscription-Key", require_key(&slot)?);
    let v = send(req).await?;
    Ok(v.as_array().cloned().unwrap_or_default())
}
