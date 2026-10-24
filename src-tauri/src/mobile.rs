//! Téléphone : pont vers le plugin Kotlin de Mégatron (`MegatronPlugin`), qui gère ce qu'Android seul sait
//! faire — fichiers choisis par l'utilisateur, partage, notifications, alarmes, blocage d'applis, widget.

use serde_json::Value;
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    AppHandle, Manager, Runtime,
};

pub struct Native<R: Runtime>(pub PluginHandle<R>);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("megatron-native")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin("app.megatron.desktop", "MegatronPlugin")?;
                // Le plugin Kotlin lit la base appli fermée (notifications, alarmes) : on lui donne son chemin.
                // Hors du fil principal, pour ne pas bloquer le lancement.
                if let Ok(dir) = app.path().app_config_dir() {
                    let path = dir.join("megatron.db").to_string_lossy().to_string();
                    let h = handle.clone();
                    std::thread::spawn(move || {
                        let _ = h.run_mobile_plugin::<Value>("setDbPath", serde_json::json!({ "path": path }));
                        let _ = h.run_mobile_plugin::<Value>("refresh", Value::Null);
                    });
                }
                app.manage(Native(handle));
            }
            #[cfg(not(target_os = "android"))]
            let _ = (app, api);
            Ok(())
        })
        .build()
}

/// Appelle une commande du plugin Kotlin (`method`) avec ses arguments, et renvoie sa réponse.
/// Certaines attendent l'utilisateur (choix d'un fichier) : on les laisse tourner hors du fil principal.
#[tauri::command]
pub async fn native_call<R: Runtime>(app: AppHandle<R>, method: String, args: Option<Value>) -> Result<Value, String> {
    let handle = app
        .try_state::<Native<R>>()
        .ok_or("Fonction disponible seulement sur téléphone.")?
        .0
        .clone();
    tauri::async_runtime::spawn_blocking(move || {
        handle
            .run_mobile_plugin::<Value>(&method, args.unwrap_or(Value::Null))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Même nom que sur PC : les boutons « Ouvrir le site » de l'interface marchent tels quels sur téléphone.
#[tauri::command]
pub async fn open_url<R: Runtime>(app: AppHandle<R>, url: String) -> Result<(), String> {
    native_call(app, "openUrl".into(), Some(serde_json::json!({ "url": url }))).await.map(|_| ())
}
