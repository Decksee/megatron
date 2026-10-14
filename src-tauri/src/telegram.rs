//! Bot Telegram : notifications sur le téléphone et discussion avec Mégatron à distance.
//! La clé du bot reste ici (Gestionnaire d'identification Windows) : la page n'appelle que
//! quelques méthodes de l'API Bot, toutes listées ci-dessous.

use base64::Engine;
use serde_json::Value;

use crate::ai::{client, error_message, read_key};

pub const SLOT: &str = "telegram";
const API: &str = "https://api.telegram.org";

/// Méthodes de l'API Bot que la page a le droit d'appeler.
const ALLOWED: [&str; 7] = [
    "getMe",
    "getUpdates",
    "sendMessage",
    "sendChatAction",
    "answerCallbackQuery",
    "editMessageText",
    "deleteWebhook",
];

fn token() -> Result<String, String> {
    read_key(SLOT).ok_or_else(|| "Aucun bot Telegram connecté.".to_string())
}

async fn call(method: &str, params: &Value) -> Result<Value, String> {
    let res = client()
        .post(format!("{API}/bot{}/{method}", token()?))
        .json(params)
        .send()
        .await
        // Le message d'erreur de reqwest contient l'adresse, donc la clé : on ne le renvoie pas tel quel.
        .map_err(|e| {
            if e.is_timeout() {
                "Telegram ne répond pas (délai dépassé).".to_string()
            } else {
                "Connexion à Telegram impossible.".to_string()
            }
        })?;
    let status = res.status();
    let text = res.text().await.map_err(|_| "Réponse de Telegram illisible.".to_string())?;
    let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    if !status.is_success() || v["ok"] != Value::Bool(true) {
        let msg = v["description"].as_str().map(str::to_string).unwrap_or_else(|| error_message(&text));
        return Err(format!("Erreur Telegram {} : {msg}", status.as_u16()));
    }
    Ok(v["result"].clone())
}

/// Appelle une méthode autorisée de l'API Bot et renvoie son résultat.
#[tauri::command]
pub async fn telegram_call(method: String, params: Option<Value>) -> Result<Value, String> {
    if !ALLOWED.contains(&method.as_str()) {
        return Err(format!("Méthode Telegram non autorisée : {method}"));
    }
    call(&method, &params.unwrap_or_else(|| serde_json::json!({}))).await
}

/// Télécharge un fichier envoyé au bot (message vocal) et le renvoie en base64.
#[tauri::command]
pub async fn telegram_file(file_id: String) -> Result<String, String> {
    let info = call("getFile", &serde_json::json!({ "file_id": file_id })).await?;
    let path = info["file_path"].as_str().ok_or("Fichier Telegram introuvable.")?;
    if path.contains("..") {
        return Err("Chemin de fichier Telegram invalide.".into());
    }
    let size = info["file_size"].as_u64().unwrap_or(0);
    if size > 20 * 1024 * 1024 {
        return Err("Fichier trop volumineux.".into());
    }
    let bytes = client()
        .get(format!("{API}/file/bot{}/{path}", token()?))
        .send()
        .await
        .map_err(|_| "Téléchargement du fichier Telegram impossible.".to_string())?
        .bytes()
        .await
        .map_err(|_| "Téléchargement du fichier Telegram impossible.".to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}
