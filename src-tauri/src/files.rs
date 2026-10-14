//! Fichiers joints à l'assistant (glissés dans la discussion, choisis avec le trombone ou reçus sur Telegram).
//! Images et PDF partent tels quels au modèle ; le texte, le code et les documents Word / Excel
//! sont convertis en texte ici, pour fonctionner avec tous les fournisseurs.

use std::io::{Cursor, Read};
use std::path::Path;

use base64::Engine;
use serde::Serialize;

/// Au-delà, l'envoi au modèle échouerait ou coûterait trop cher.
const MAX_BYTES: u64 = 20 * 1024 * 1024;
/// Texte gardé au maximum par fichier (environ 50 000 mots).
const MAX_TEXT_CHARS: usize = 300_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    name: String,
    mime: String,
    size: u64,
    /// « image », « pdf » ou « text ».
    kind: &'static str,
    /// Contenu en base64 (images, PDF).
    data: Option<String>,
    /// Contenu en texte (texte, code, Word, Excel).
    text: Option<String>,
}

const TEXT_EXT: [&str; 34] = [
    "txt", "md", "markdown", "csv", "tsv", "json", "xml", "yaml", "yml", "toml", "ini", "log", "html", "htm", "css",
    "js", "jsx", "ts", "tsx", "py", "rs", "java", "c", "cpp", "h", "cs", "go", "php", "rb", "sql", "sh", "ps1", "vue",
    "svelte",
];

fn ext_of(name: &str) -> String {
    Path::new(name).extension().and_then(|e| e.to_str()).unwrap_or_default().to_lowercase()
}

fn image_mime(ext: &str) -> Option<&'static str> {
    match ext {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        _ => None,
    }
}

fn truncate(mut text: String) -> String {
    if text.chars().count() > MAX_TEXT_CHARS {
        text = text.chars().take(MAX_TEXT_CHARS).collect::<String>() + "\n[… document tronqué]";
    }
    text
}

/// Retire les balises XML et décode les entités usuelles.
fn xml_text(xml: &str, paragraph_tags: &[&str]) -> String {
    let mut out = String::with_capacity(xml.len() / 3);
    let mut rest = xml;
    while let Some(start) = rest.find('<') {
        out.push_str(&rest[..start]);
        let Some(end) = rest[start..].find('>') else { break };
        let tag = &rest[start + 1..start + end];
        let name = tag.trim_start_matches('/').split([' ', '/']).next().unwrap_or("");
        if paragraph_tags.contains(&name) && tag.starts_with('/') {
            out.push('\n');
        } else if name == "w:tab" {
            out.push('\t');
        }
        rest = &rest[start + end + 1..];
    }
    out.push_str(rest);
    out.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}

fn zip_entry(archive: &mut zip::ZipArchive<Cursor<&[u8]>>, name: &str) -> Option<String> {
    let mut file = archive.by_name(name).ok()?;
    let mut s = String::new();
    file.read_to_string(&mut s).ok()?;
    Some(s)
}

fn docx_text(bytes: &[u8]) -> Result<String, String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| "Document Word illisible.".to_string())?;
    let xml = zip_entry(&mut archive, "word/document.xml").ok_or("Document Word illisible.")?;
    Ok(xml_text(&xml, &["w:p"]))
}

/// Classeur Excel : chaque feuille en lignes de cellules séparées par des tabulations.
fn xlsx_text(bytes: &[u8]) -> Result<String, String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| "Classeur Excel illisible.".to_string())?;
    let shared: Vec<String> = zip_entry(&mut archive, "xl/sharedStrings.xml")
        .map(|xml| xml.split("<si>").skip(1).map(|si| xml_text(si, &[]).trim().to_string()).collect())
        .unwrap_or_default();
    let mut sheets: Vec<String> = archive
        .file_names()
        .filter(|n| n.starts_with("xl/worksheets/sheet") && n.ends_with(".xml"))
        .map(str::to_string)
        .collect();
    sheets.sort();
    let mut out = String::new();
    for (i, sheet) in sheets.iter().enumerate() {
        let Some(xml) = zip_entry(&mut archive, sheet) else { continue };
        out.push_str(&format!("--- Feuille {} ---\n", i + 1));
        for row in xml.split("<row").skip(1) {
            let mut cells = Vec::new();
            for cell in row.split("<c ").skip(1) {
                let shared_string = cell.split('>').next().unwrap_or("").contains("t=\"s\"");
                let value = cell
                    .split("<v>")
                    .nth(1)
                    .and_then(|v| v.split("</v>").next())
                    .map(str::to_string)
                    .or_else(|| cell.split("<t>").nth(1).and_then(|v| v.split("</t>").next()).map(str::to_string))
                    .unwrap_or_default();
                cells.push(if shared_string {
                    value.parse::<usize>().ok().and_then(|i| shared.get(i).cloned()).unwrap_or_default()
                } else {
                    value
                });
            }
            out.push_str(&cells.join("\t"));
            out.push('\n');
        }
    }
    Ok(out)
}

fn parse(name: String, bytes: Vec<u8>) -> Result<Attachment, String> {
    let size = bytes.len() as u64;
    if size > MAX_BYTES {
        return Err(format!("« {name} » dépasse 20 Mo."));
    }
    let ext = ext_of(&name);
    let b64 = || base64::engine::general_purpose::STANDARD.encode(&bytes);
    let text = |kind_text: String, mime: &str| Attachment {
        name: name.clone(),
        mime: mime.to_string(),
        size,
        kind: "text",
        data: None,
        text: Some(truncate(kind_text)),
    };
    if let Some(mime) = image_mime(&ext) {
        return Ok(Attachment { name, mime: mime.into(), size, kind: "image", data: Some(b64()), text: None });
    }
    match ext.as_str() {
        "pdf" => Ok(Attachment { name, mime: "application/pdf".into(), size, kind: "pdf", data: Some(b64()), text: None }),
        "docx" => Ok(text(docx_text(&bytes)?, "text/plain")),
        "xlsx" => Ok(text(xlsx_text(&bytes)?, "text/plain")),
        e if TEXT_EXT.contains(&e) => Ok(text(String::from_utf8_lossy(&bytes).into_owned(), "text/plain")),
        _ => {
            // Sans extension connue : on l'accepte s'il ressemble à du texte.
            match std::str::from_utf8(&bytes) {
                Ok(s) if !s.contains('\0') => Ok(text(s.to_string(), "text/plain")),
                _ => Err(format!(
                    "Je ne sais pas lire « {name} ». Formats acceptés : images, PDF, Word, Excel, texte et code."
                )),
            }
        }
    }
}

/// Lit un fichier glissé ou choisi par l'utilisateur.
#[tauri::command]
pub async fn read_attachment(path: String) -> Result<Attachment, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = Path::new(&path);
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("fichier").to_string();
        let meta = std::fs::metadata(p).map_err(|_| format!("Impossible d'ouvrir « {name} »."))?;
        if meta.is_dir() {
            return Err(format!("« {name} » est un dossier : dépose plutôt les fichiers qu'il contient."));
        }
        if meta.len() > MAX_BYTES {
            return Err(format!("« {name} » dépasse 20 Mo."));
        }
        let bytes = std::fs::read(p).map_err(|_| format!("Impossible de lire « {name} »."))?;
        parse(name, bytes)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Même chose pour un fichier déjà en mémoire (reçu sur Telegram).
#[tauri::command]
pub async fn parse_attachment(name: String, data_base64: String) -> Result<Attachment, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64)
        .map_err(|_| "Fichier illisible.".to_string())?;
    tauri::async_runtime::spawn_blocking(move || parse(name, bytes)).await.map_err(|e| e.to_string())?
}
