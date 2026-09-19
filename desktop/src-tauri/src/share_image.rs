//! User-initiated PNG export. The destination is selected by the native dialog, never a webview path.
use tauri_plugin_dialog::DialogExt;

fn validate(name: &str, bytes: &[u8]) -> Result<(), String> {
  let stem = name.strip_suffix(".png").ok_or("Expected a PNG filename.")?;
  if stem.is_empty() || stem.len() > 100 || !stem.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_') {
    return Err("Invalid PNG filename.".into());
  }
  if bytes.len() > 20 * 1024 * 1024 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
    return Err("Expected a PNG image smaller than 20 MB.".into());
  }
  Ok(())
}
#[tauri::command]
pub async fn save_share_image(app: tauri::AppHandle, name: String, bytes: Vec<u8>) -> Result<bool, String> {
  validate(&name, &bytes)?;
  tauri::async_runtime::spawn_blocking(move || {
    let selected = app.dialog().file().set_file_name(&name).add_filter("PNG image", &["png"]).blocking_save_file();
    let Some(selected) = selected else { return Ok(false); };
    let path = selected.into_path().map_err(|e| e.to_string())?;
    std::fs::write(path, bytes).map_err(|e| format!("Could not save PNG: {e}"))?;
    Ok(true)
  }).await.map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
  use super::validate;
  #[test]
  fn rejects_paths_and_non_png_data() {
    let png = b"\x89PNG\r\n\x1a\n";
    assert!(validate("skill-benchmark.png", png).is_ok());
    assert!(validate(&format!("{}.png", "a".repeat(100)), png).is_ok());
    assert!(validate(&format!("{}.png", "a".repeat(101)), png).is_err());
    for name in ["../skill.png", "a/b.png", "a\\b.png", "x.jpg", ".png"] { assert!(validate(name, png).is_err()); }
    assert!(validate("x.png", b"not a png").is_err());
    assert!(validate("x.png", &vec![0; 20 * 1024 * 1024 + 1]).is_err());
  }
}
