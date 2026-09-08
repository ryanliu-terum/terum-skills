//! The shell. It owns exactly three things the web frontend cannot do itself: a native window with the
//! macOS overlay chrome (tauri.conf.json), the plugins the seam's capabilities need (opener, clipboard,
//! store, window-state), and the CLI bridge below: spawn the globally installed `terum-skills` bin under
//! the Node the CLI recorded, pipe its stdout lines to the webview as events, write answers to its stdin.
//! Frame parsing stays in TypeScript (desktop/src/backend/tauri/); Rust never interprets a line.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct Bridge {
  children: Mutex<HashMap<String, Arc<Mutex<Handle>>>>,
}

struct Handle {
  child: Child,
  stdin: Option<ChildStdin>,
}

#[derive(Clone, serde::Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum LineEvent {
  Stdout { line: String },
  Stderr { line: String },
  Exit { code: Option<i32> },
  Error { message: String },
}

fn event_name(id: &str) -> String {
  format!("cli:{id}")
}

/// Start `node <entry> --frames <args...>` with piped stdio. `id` is chosen by the webview so it can
/// subscribe to `cli:<id>` before the first line is emitted; lines are events `{kind: stdout|stderr|exit|error}`.
#[tauri::command]
fn cli_spawn(app: AppHandle, bridge: State<'_, Bridge>, id: String, node: String, entry: String, args: Vec<String>, cwd: Option<String>) -> Result<(), String> {
  if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') { return Err("bad id".into()); }
  if bridge.children.lock().map_err(|e| e.to_string())?.contains_key(&id) { return Err("id in use".into()); }
  let mut command = Command::new(&node);
  command.arg(&entry).arg("--frames").args(&args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
  if let Some(dir) = cwd.as_deref().filter(|dir| !dir.is_empty()) {
    command.current_dir(dir);
  }
  // A GUI app has no shell environment; the CLI needs only PATH-independent inputs (node and entry are absolute).
  command.env("TERUM_SKILLS_NO_UPDATE_NOTIFIER", "1");
  let mut child = command.spawn().map_err(|e| format!("could not start {node}: {e}"))?;
  let stdout = child.stdout.take().ok_or("no stdout")?;
  let stderr = child.stderr.take().ok_or("no stderr")?;
  let stdin = child.stdin.take();
  let handle = Arc::new(Mutex::new(Handle { child, stdin }));
  bridge.children.lock().map_err(|e| e.to_string())?.insert(id.clone(), handle.clone());

  let name = event_name(&id);
  let out_app = app.clone();
  let out_name = name.clone();
  std::thread::spawn(move || {
    for line in BufReader::new(stdout).lines() {
      match line {
        Ok(line) => { let _ = out_app.emit(&out_name, LineEvent::Stdout { line }); }
        Err(e) => { let _ = out_app.emit(&out_name, LineEvent::Error { message: e.to_string() }); break; }
      }
    }
  });
  let err_app = app.clone();
  let err_name = name.clone();
  std::thread::spawn(move || {
    for line in BufReader::new(stderr).lines().map_while(Result::ok) {
      let _ = err_app.emit(&err_name, LineEvent::Stderr { line });
    }
  });
  let wait_app = app.clone();
  let wait_bridge = handle.clone();
  std::thread::spawn(move || {
    // Poll rather than block on `wait()` so `cli_kill` can take the lock in between.
    loop {
      let status = { wait_bridge.lock().ok().and_then(|mut h| h.child.try_wait().ok().flatten()) };
      if let Some(status) = status {
        let _ = wait_app.emit(&name, LineEvent::Exit { code: status.code() });
        if let Some(bridge) = wait_app.try_state::<Bridge>() { if let Ok(mut children) = bridge.children.lock() { children.remove(&id); } }
        break;
      }
      std::thread::sleep(std::time::Duration::from_millis(25));
    }
  });
  Ok(())
}

/// Write one line (an `answer` or `cancel` frame, already serialised) to the child's stdin.
#[tauri::command]
fn cli_write(bridge: State<'_, Bridge>, id: String, line: String) -> Result<(), String> {
  let handle = bridge.children.lock().map_err(|e| e.to_string())?.get(&id).cloned().ok_or("no such process")?;
  let mut guard = handle.lock().map_err(|e| e.to_string())?;
  let stdin = guard.stdin.as_mut().ok_or("stdin closed")?;
  stdin.write_all(line.as_bytes()).and_then(|_| stdin.write_all(b"\n")).and_then(|_| stdin.flush()).map_err(|e| e.to_string())
}

/// Close stdin (the CLI treats that like cancel) and, if it is still running shortly after, kill it.
#[tauri::command]
fn cli_kill(bridge: State<'_, Bridge>, id: String) -> Result<(), String> {
  let handle = bridge.children.lock().map_err(|e| e.to_string())?.get(&id).cloned().ok_or("no such process")?;
  let mut guard = handle.lock().map_err(|e| e.to_string())?;
  guard.stdin.take();
  if guard.child.try_wait().map_err(|e| e.to_string())?.is_none() {
    let _ = guard.child.kill();
  }
  Ok(())
}

/// The state file `terum-skills app` writes on every launch (decision walk D1): where Node and the CLI are.
#[tauri::command]
fn read_app_state() -> Result<Option<String>, String> {
  let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).ok_or("no home directory")?;
  let path = std::path::Path::new(&home).join(".terum").join("skills").join("run").join("app.json");
  match std::fs::read_to_string(&path) {
    Ok(text) => Ok(Some(text)),
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
    Err(e) => Err(format!("{}: {e}", path.display())),
  }
}

/// What the seam's `capabilities().windowChrome` keys off: the OS, not a user agent.
#[tauri::command]
fn host_platform() -> &'static str {
  std::env::consts::OS
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default()
    .manage(Bridge::default())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_store::Builder::default().build())
    .plugin(tauri_plugin_clipboard_manager::init())
    .invoke_handler(tauri::generate_handler![cli_spawn, cli_write, cli_kill, read_app_state, host_platform]);

  #[cfg(not(any(target_os = "android", target_os = "ios")))]
  let builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());

  builder
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
