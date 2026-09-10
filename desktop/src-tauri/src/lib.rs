//! The shell. It owns exactly three things the web frontend cannot do itself: a native window with the
//! macOS overlay chrome (tauri.conf.json), the plugins the seam's capabilities need (opener, clipboard,
//! store, dialog, window-state), and the CLI bridge below: spawn the globally installed `terum-skills` bin under
//! the Node the CLI recorded, pipe its stdout lines to the webview as events, write answers to its stdin.
//! Sleep/resume is not handled; window destruction and application exit terminate every child.
//! Frame parsing stays in TypeScript (desktop/src/backend/tauri/); Rust never interprets a line.

#[cfg(target_os = "macos")]
mod disclaim;

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
#[cfg(unix)]
use std::os::unix::process::CommandExt;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct Bridge {
  children: Mutex<HashMap<String, Arc<Mutex<Handle>>>>,
}

impl Bridge {
  const MAX_CHILDREN: usize = 8;

  fn has_capacity<T>(children: &HashMap<String, T>) -> bool {
    children.len() < Self::MAX_CHILDREN
  }
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

/// `CREATE_NO_WINDOW` (winbase.h): start the console child without a console window. Named here rather than
/// pulled from windows-sys so the shell keeps its dependency list.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// How long every admitted child is given to act on its `cancel` frame before it is terminated. A CLI
/// that is terminated runs no cleanup — on Windows there is no signal to catch — so this is the only
/// chance a write in flight gets to release the clone's writer lock. Bounded: it delays app quit by
/// at most this much, and only while a child is live.
const CANCEL_GRACE_MS: u64 = 400;

fn event_name(id: &str) -> String {
  format!("cli:{id}")
}

/// Start `node <entry> --frames <args...>` with piped stdio. `id` is chosen by the webview so it can
/// subscribe to `cli:<id>` before the first line is emitted; lines are events `{kind: stdout|stderr|exit|error}`.
#[tauri::command]
fn cli_spawn(app: AppHandle, bridge: State<'_, Bridge>, id: String, node: String, entry: String, args: Vec<String>, cwd: Option<String>, path: Option<String>) -> Result<(), String> {
  if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') { return Err("bad id".into()); }
  // Keep admission and insertion under one lock so concurrent spawns cannot exceed the cap.
  let mut children = bridge.children.lock().map_err(|e| e.to_string())?;
  if children.contains_key(&id) { return Err("id in use".into()); }
  if !Bridge::has_capacity(&children) { return Err("too many pending terum-skills processes (8); wait for one to finish".into()); }
  let mut command = Command::new(&node);
  command.arg(&entry).arg("--frames").args(&args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
  #[cfg(unix)]
  command.process_group(0);
  // Windows: this shell is a GUI-subsystem process, so every console child it starts would get its own console
  // window (a bare node.exe window flashing on each interaction) unless the spawn says CREATE_NO_WINDOW. Stdio is
  // piped, so the child needs no console at all.
  #[cfg(windows)]
  command.creation_flags(CREATE_NO_WINDOW);
  match cwd.as_deref().filter(|dir| !dir.is_empty()) {
    Some(dir) => { command.current_dir(dir); }
    // No cwd from the webview means the child would inherit the app's LaunchServices cwd, `/`.
    // Broad startup work (an eval agent's `find`, npm probes) walking an unexpected root is what
    // strays into TCC-protected dirs — pin the spawn to a sane directory instead.
    None => { if let Some(dir) = default_spawn_dir() { command.current_dir(dir); } }
  }
  // D4: replay the recorded launch PATH; older state files inherit the shell process environment.
  if let Some(path) = path.filter(|path| !path.is_empty()) {
    command.env("PATH", path);
  }
  command.env("TERUM_SKILLS_NO_UPDATE_NOTIFIER", "1");
  // Break TCC responsibility inheritance: the Node child (and every eval agent under it) must be
  // its own responsible process, never the "Terum Skills" bundle. Must be the last change to
  // `command` before spawn — it snapshots the final argv/env. See disclaim.rs.
  #[cfg(target_os = "macos")]
  disclaim::disclaim_tcc_responsibility(&mut command);
  let mut child = command.spawn().map_err(|e| format!("could not start {node}: {e}"))?;
  let stdout = child.stdout.take().ok_or("no stdout")?;
  let stderr = child.stderr.take().ok_or("no stderr")?;
  let stdin = child.stdin.take();
  let handle = Arc::new(Mutex::new(Handle { child, stdin }));
  children.insert(id.clone(), handle.clone());
  drop(children);

  let name = event_name(&id);
  let out_app = app.clone();
  let out_name = name.clone();
  let out = std::thread::spawn(move || {
    for line in BufReader::new(stdout).lines() {
      match line {
        Ok(line) => { let _ = out_app.emit(&out_name, LineEvent::Stdout { line }); }
        Err(e) => { let _ = out_app.emit(&out_name, LineEvent::Error { message: e.to_string() }); break; }
      }
    }
  });
  let err_app = app.clone();
  let err_name = name.clone();
  let err = std::thread::spawn(move || {
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
        let _ = out.join();
        let _ = err.join();
        let _ = wait_app.emit(&name, LineEvent::Exit { code: status.code() });
        if let Some(bridge) = wait_app.try_state::<Bridge>() { if let Ok(mut children) = bridge.children.lock() { children.remove(&id); } }
        break;
      }
      std::thread::sleep(std::time::Duration::from_millis(25));
    }
  });
  Ok(())
}

/// Where a cwd-less spawn lands: the CLI's own store root `~/.terum/skills` when it exists
/// (the same root `read_app_state` reads), else the home directory — never `/`.
fn default_spawn_dir() -> Option<std::path::PathBuf> {
  let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
  let home = std::path::PathBuf::from(home);
  let store = home.join(".terum").join("skills");
  if store.is_dir() { Some(store) } else if home.is_dir() { Some(home) } else { None }
}

/// Write one line (an `answer` or `cancel` frame, already serialised) to the child's stdin.
#[tauri::command]
fn cli_write(bridge: State<'_, Bridge>, id: String, line: String) -> Result<(), String> {
  let handle = bridge.children.lock().map_err(|e| e.to_string())?.get(&id).cloned().ok_or("no such process")?;
  let mut guard = handle.lock().map_err(|e| e.to_string())?;
  let stdin = guard.stdin.as_mut().ok_or("stdin closed")?;
  stdin.write_all(line.as_bytes()).and_then(|_| stdin.write_all(b"\n")).and_then(|_| stdin.flush()).map_err(|e| e.to_string())
}

/// The descendant-kill argv for a Windows child tree. Split out from the spawn so it is unit-testable on any host.
#[cfg_attr(not(any(windows, test)), allow(dead_code))] // the Windows kill path and the test below are its only callers
fn taskkill_args(pid: u32) -> [String; 4] {
  ["/PID".to_string(), pid.to_string(), "/T".to_string(), "/F".to_string()]
}

/// Windows has no process group to signal: `Child::kill` is TerminateProcess on the direct child alone,
/// so an eval's `claude.exe` grandchildren outlive it and keep spending the user's account. `taskkill /T`
/// walks the tree. Run before `Child::kill`, while the tree is still rooted at a live pid; the open Child
/// handle keeps that pid reserved, so this can never reach an unrelated process. A missing or refusing
/// taskkill.exe is not fatal — the `Child::kill` that follows is exactly today's behaviour, and there is
/// no channel here to report on.
#[cfg(windows)]
fn kill_tree(pid: u32) {
  let _ = Command::new("taskkill")
    .args(taskkill_args(pid))
    .creation_flags(CREATE_NO_WINDOW)
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .status();
}

/// Allow protocol cancellation 1,500 ms, then terminate the Unix process group or Windows child tree.
#[tauri::command]
fn cli_kill(bridge: State<'_, Bridge>, id: String) -> Result<(), String> {
  let handle = bridge.children.lock().map_err(|e| e.to_string())?.get(&id).cloned().ok_or("no such process")?;
  {
    let mut guard = handle.lock().map_err(|e| e.to_string())?;
    guard.stdin.take();
  }
  let deadline = Instant::now() + Duration::from_millis(1_500);
  loop {
    {
      let mut guard = handle.lock().map_err(|e| e.to_string())?;
      if guard.child.try_wait().map_err(|e| e.to_string())?.is_some() {
        // The leader stopped on its own, but on Windows nothing re-parents or terminates what it
        // spawned. Sweep the tree while its pid is still reserved by the handle we hold.
        #[cfg(windows)]
        kill_tree(guard.child.id());
        return Ok(());
      }
    }
    if Instant::now() >= deadline { break; }
    std::thread::sleep(Duration::from_millis(25));
  }
  #[cfg(unix)]
  {
    let pid = handle.lock().map_err(|e| e.to_string())?.child.id();
    // SAFETY: spawn made this child a process-group leader; a negative pid targets that group.
    unsafe { libc::kill(-(pid as i32), libc::SIGTERM); }
    std::thread::sleep(Duration::from_millis(500));
    // Escalate the group even if its leader exited: descendants can still hold the pipes open.
    // SAFETY: this is the same process group targeted above, with no borrowed memory involved.
    unsafe { libc::kill(-(pid as i32), libc::SIGKILL); }
  }
  #[cfg(windows)]
  {
    let mut guard = handle.lock().map_err(|e| e.to_string())?;
    kill_tree(guard.child.id());
    let _ = guard.child.kill();
  }
  Ok(())
}

/// Stop all admitted children while holding admission closed. Unix descendants share the group.
/// Every child is asked to stop through the protocol first: a terminated CLI runs no cleanup, so on
/// Windows a write in flight would leave the clone's writer lock directory behind for up to a minute.
/// Closing stdin is not a substitute — src/lib/frames.ts fails pending questions on end-of-input and
/// never calls the cancellation hook, so a verb that asks nothing (eval) would keep running.
fn kill_all(bridge: &Bridge) {
  if let Ok(mut children) = bridge.children.lock() {
    if children.is_empty() { return; }
    for handle in children.values() {
      if let Ok(mut guard) = handle.lock() {
        if let Some(stdin) = guard.stdin.as_mut() {
          // Best effort: a child whose pipe is already gone is a child that is already stopping.
          let _ = stdin.write_all(b"{\"t\":\"cancel\"}\n").and_then(|_| stdin.flush());
        }
        guard.stdin.take();
      }
    }
    std::thread::sleep(Duration::from_millis(CANCEL_GRACE_MS));
    #[cfg(unix)]
    {
      for handle in children.values() {
        if let Ok(guard) = handle.lock() {
          // SAFETY: cli_spawn created this child's process group; negative pid addresses that group.
          unsafe { libc::kill(-(guard.child.id() as i32), libc::SIGTERM); }
        }
      }
      std::thread::sleep(Duration::from_millis(300));
      for handle in children.values() {
        if let Ok(guard) = handle.lock() {
          // SAFETY: escalate the same group even when its leader has already exited.
          unsafe { libc::kill(-(guard.child.id() as i32), libc::SIGKILL); }
        }
      }
    }
    #[cfg(windows)]
    for handle in children.values() {
      if let Ok(mut guard) = handle.lock() {
        // Descendants outlive the leader here, so sweep the tree even if the leader is already gone;
        // the open Child handle keeps its pid reserved, so the sweep cannot hit an unrelated process.
        kill_tree(guard.child.id());
        let _ = guard.child.kill();
      }
    }
    children.clear();
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn taskkill_argv_targets_the_whole_child_tree() {
    assert_eq!(taskkill_args(1234), ["/PID".to_string(), "1234".to_string(), "/T".to_string(), "/F".to_string()]);
  }

  #[test]
  fn child_cap_rejects_eight_pending_entries_and_frees_removed_slots() {
    let mut children: HashMap<String, ()> = (0..7).map(|id| (id.to_string(), ())).collect();
    assert!(Bridge::has_capacity(&children));
    children.insert("7".into(), ());
    assert!(!Bridge::has_capacity(&children));
    children.insert("8".into(), ());
    assert!(!Bridge::has_capacity(&children));
    children.remove("8");
    children.remove("7");
    assert!(Bridge::has_capacity(&children));
  }
}

#[tauri::command]
fn quit(app: tauri::AppHandle) { app.exit(0); }

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
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![cli_spawn, cli_write, cli_kill, read_app_state, host_platform, quit]);

  #[cfg(not(any(target_os = "android", target_os = "ios")))]
  let builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());

  builder
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())?;
      }
      Ok(())
    })
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::Destroyed = event {
        if let Some(bridge) = window.try_state::<Bridge>() { kill_all(&bridge); }
      }
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
      #[cfg(target_os = "macos")]
      if let tauri::RunEvent::Reopen { .. } = event {
        let _ = app.emit("launch:reopen", ());
      }
      if let tauri::RunEvent::Exit = event {
        if let Some(bridge) = app.try_state::<Bridge>() { kill_all(&bridge); }
      }
      let _ = (app, &event);
    });
}
