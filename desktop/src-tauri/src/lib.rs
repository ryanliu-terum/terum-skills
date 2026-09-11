//! The shell. It owns exactly three things the web frontend cannot do itself: a native window with the
//! macOS overlay chrome (tauri.conf.json), the plugins the seam's capabilities need (opener, clipboard,
//! store, dialog, window-state), and the CLI bridge below: spawn the globally installed `terum-skills` bin under
//! the Node the CLI recorded, pipe its stdout lines to the webview as events, write answers to its stdin.
//! Sleep/resume is not handled; window destruction and application exit terminate every child.
//! Frame parsing stays in TypeScript (desktop/src/backend/tauri/); Rust never interprets a line.

#[cfg(target_os = "macos")]
mod disclaim;
mod app_update;
use app_update::CloseUpdate;

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
  children: Children<Arc<Mutex<Handle>>>,
}

impl Bridge {
  const MAX_CHILDREN: usize = 8;

  fn has_capacity<T>(children: &HashMap<String, T>) -> bool {
    children.len() < Self::MAX_CHILDREN
  }
}

type Children<T> = Mutex<HashMap<String, ChildSlot<T>>>;

/// Reservations and live children occupy the same admission slots.
enum ChildSlot<T> {
  Reserved(Arc<()>),
  Live(T),
}

impl<T> ChildSlot<T> {
  fn live(&self) -> Option<&T> {
    match self { Self::Live(handle) => Some(handle), Self::Reserved(_) => None }
  }
}

/// Own an admission slot without holding the mutex during process creation.
struct Reservation<'a, T> {
  children: &'a Children<T>,
  id: String,
  token: Arc<()>,
}

impl<'a, T> Reservation<'a, T> {
  fn acquire(children: &'a Children<T>, id: String) -> Result<Self, String> {
    let mut slots = children.lock().map_err(|e| e.to_string())?;
    if slots.contains_key(&id) { return Err("id in use".into()); }
    if !Bridge::has_capacity(&slots) { return Err("too many pending terum-skills processes (8); wait for one to finish".into()); }
    let token = Arc::new(());
    slots.insert(id.clone(), ChildSlot::Reserved(token.clone()));
    Ok(Self { children, id, token })
  }

  // Construct the handle only after validating the slot, so failure leaves the caller owning its child.
  fn commit(self, make_handle: impl FnOnce() -> T) -> Result<T, String> where T: Clone {
    let mut slots = self.children.lock().map_err(|e| e.to_string())?;
    match slots.get(&self.id) {
      Some(ChildSlot::Reserved(token)) if Arc::ptr_eq(token, &self.token) => {}
      _ => return Err("process reservation released during shutdown".into()),
    }
    let handle = make_handle();
    slots.insert(self.id.clone(), ChildSlot::Live(handle.clone()));
    Ok(handle)
  }
}

impl<T> Drop for Reservation<'_, T> {
  fn drop(&mut self) {
    // Recover poison for cleanup: an unwinding spawn must never permanently consume a slot.
    let mut slots = self.children.lock().unwrap_or_else(|e| e.into_inner());
    if matches!(slots.get(&self.id), Some(ChildSlot::Reserved(token)) if Arc::ptr_eq(token, &self.token)) {
      slots.remove(&self.id);
    }
  }
}

/// Until registration succeeds, every early return must terminate and reap the untracked child.
struct PendingChild(Option<Child>);

impl Drop for PendingChild {
  fn drop(&mut self) {
    if let Some(child) = self.0.as_mut() {
      #[cfg(unix)]
      // SAFETY: cli_spawn made this child a process-group leader; also stop any descendants.
      unsafe { libc::kill(-(child.id() as i32), libc::SIGKILL); }
      #[cfg(windows)]
      kill_tree(child.id());
      // Best effort termination: an already-exited child still needs to be reaped below.
      let _ = child.kill();
      let _ = child.wait();
    }
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
// Blocking commands must run off the UI thread so process creation and I/O cannot freeze repainting.
#[tauri::command(async)]
#[allow(clippy::too_many_arguments)] // Preserve the existing eight-argument webview invoke contract.
fn cli_spawn(app: AppHandle, bridge: State<'_, Bridge>, id: String, node: String, entry: String, args: Vec<String>, cwd: Option<String>, path: Option<String>) -> Result<(), String> {
  if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') { return Err("bad id".into()); }
  let reservation = Reservation::acquire(&bridge.children, id.clone())?;
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
  let mut pending = PendingChild(Some(command.spawn().map_err(|e| format!("could not start {node}: {e}"))?));
  let child = pending.0.as_mut().expect("newly spawned child");
  let stdout = child.stdout.take().ok_or("no stdout")?;
  let stderr = child.stderr.take().ok_or("no stderr")?;
  let stdin = child.stdin.take();
  let handle = reservation.commit(|| Arc::new(Mutex::new(Handle {
    child: pending.0.take().expect("child transferred once at registration"), stdin,
  })))?;

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
#[tauri::command(async)]
fn cli_write(bridge: State<'_, Bridge>, id: String, line: String) -> Result<(), String> {
  let handle = bridge.children.lock().map_err(|e| e.to_string())?.get(&id).and_then(ChildSlot::live).cloned().ok_or("no such process")?;
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

#[cfg(windows)]
async fn terminate_windows_child(handle: Arc<Mutex<Handle>>, terminate_leader: bool) -> Result<(), String> {
  // taskkill waits for an OS process; keep it off both the UI and the async executor workers.
  tauri::async_runtime::spawn_blocking(move || {
    let mut guard = handle.lock().map_err(|e| e.to_string())?;
    kill_tree(guard.child.id());
    if terminate_leader {
      // The leader may already have exited while taskkill swept its descendants.
      let _ = guard.child.kill();
    }
    Ok(())
  }).await.map_err(|e| e.to_string())?
}

/// Allow protocol cancellation 1,500 ms, then terminate the Unix process group or Windows child tree.
#[tauri::command(async)]
async fn cli_kill(bridge: State<'_, Bridge>, id: String) -> Result<(), String> {
  let handle = bridge.children.lock().map_err(|e| e.to_string())?.get(&id).and_then(ChildSlot::live).cloned().ok_or("no such process")?;
  {
    let mut guard = handle.lock().map_err(|e| e.to_string())?;
    guard.stdin.take();
  }
  let deadline = Instant::now() + Duration::from_millis(1_500);
  loop {
    let exited = {
      let mut guard = handle.lock().map_err(|e| e.to_string())?;
      guard.child.try_wait().map_err(|e| e.to_string())?.is_some()
    };
    if exited {
      // Keep the Child handle alive while sweeping descendants, even when the leader exited.
      #[cfg(windows)]
      terminate_windows_child(handle.clone(), false).await?;
      return Ok(());
    }
    if Instant::now() >= deadline { break; }
    tokio::time::sleep(Duration::from_millis(25)).await;
  }
  #[cfg(unix)]
  {
    let pid = handle.lock().map_err(|e| e.to_string())?.child.id();
    // SAFETY: spawn made this child a process-group leader; a negative pid targets that group.
    unsafe { libc::kill(-(pid as i32), libc::SIGTERM); }
    tokio::time::sleep(Duration::from_millis(500)).await;
    // Escalate the group even if its leader exited: descendants can still hold the pipes open.
    // SAFETY: this is the same process group targeted above, with no borrowed memory involved.
    unsafe { libc::kill(-(pid as i32), libc::SIGKILL); }
  }
  #[cfg(windows)]
  terminate_windows_child(handle, true).await?;
  Ok(())
}

/// Stop all admitted children while holding admission closed. Unix descendants share the group.
/// Every child is asked to stop through the protocol first: a terminated CLI runs no cleanup, so on
/// Windows a write in flight would leave the clone's writer lock directory behind for up to a minute.
/// Closing stdin is not a substitute — src/lib/frames.ts fails pending questions on end-of-input and
/// never calls the cancellation hook, so a verb that asks nothing (eval) would keep running.
// Shutdown waits are deliberately blocking: exit must not race child cleanup.
fn kill_all(bridge: &Bridge) {
  if let Ok(mut children) = bridge.children.lock() {
    if children.is_empty() { return; }
    for handle in children.values().filter_map(ChildSlot::live) {
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
      for handle in children.values().filter_map(ChildSlot::live) {
        if let Ok(guard) = handle.lock() {
          // SAFETY: cli_spawn created this child's process group; negative pid addresses that group.
          unsafe { libc::kill(-(guard.child.id() as i32), libc::SIGTERM); }
        }
      }
      std::thread::sleep(Duration::from_millis(300));
      for handle in children.values().filter_map(ChildSlot::live) {
        if let Ok(guard) = handle.lock() {
          // SAFETY: escalate the same group even when its leader has already exited.
          unsafe { libc::kill(-(guard.child.id() as i32), libc::SIGKILL); }
        }
      }
    }
    #[cfg(windows)]
    for handle in children.values().filter_map(ChildSlot::live) {
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


#[tauri::command]
fn quit(app: tauri::AppHandle) { app.exit(0); }

/// The state file `terum-skills app` writes on every launch (decision walk D1): where Node and the CLI are.
#[tauri::command(async)]
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
#[tauri::command(async)]
fn host_platform() -> &'static str {
  std::env::consts::OS
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default()
    .manage(Bridge::default())
    .manage(CloseUpdate::default())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_store::Builder::default().build())
    .plugin(tauri_plugin_clipboard_manager::init())
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![cli_spawn, cli_write, cli_kill, read_app_state, host_platform, quit, app_update::app_update_on_close]);

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
      if let tauri::WindowEvent::CloseRequested { .. } = event {
        if window.app_handle().webview_windows().len() == 1 {
          if let Some(update) = window.try_state::<CloseUpdate>() { app_update::on_exit(&update); }
        }
      }
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
      if let tauri::RunEvent::ExitRequested { .. } = event {
        if let Some(update) = app.try_state::<CloseUpdate>() { app_update::on_exit(&update); }
      }
      if let tauri::RunEvent::Exit = event {
        if let Some(bridge) = app.try_state::<Bridge>() { kill_all(&bridge); }
      }
      let _ = (app, &event);
    });
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn reservations_count_toward_capacity_and_release_exactly_one_slot() {
    let children = Mutex::new(HashMap::<String, ChildSlot<()>>::new());
    let mut reservations = (0..8).map(|id| Reservation::acquire(&children, id.to_string()).unwrap()).collect::<Vec<_>>();
    assert_eq!(Reservation::acquire(&children, "overflow".into()).err().unwrap(),
      "too many pending terum-skills processes (8); wait for one to finish");
    drop(reservations.pop());
    let replacement = Reservation::acquire(&children, "replacement".into()).unwrap();
    assert!(Reservation::acquire(&children, "overflow".into()).is_err());
    replacement.commit(|| ()).unwrap();
    assert!(Reservation::acquire(&children, "overflow".into()).is_err());
    drop(reservations);
    assert_eq!(children.lock().unwrap().len(), 1);
  }

  #[test]
  fn uncommitted_reservation_drop_frees_its_id_and_slot() {
    let children = Mutex::new(HashMap::<String, ChildSlot<()>>::new());
    let reservation = Reservation::acquire(&children, "child".into()).unwrap();
    assert_eq!(Reservation::acquire(&children, "child".into()).err().unwrap(), "id in use");
    assert!(children.try_lock().is_ok(), "process creation must run without the admission lock");
    drop(reservation);
    assert!(children.lock().unwrap().is_empty());
    Reservation::acquire(&children, "child".into()).unwrap().commit(|| ()).unwrap();
    assert_eq!(Reservation::acquire(&children, "child".into()).err().unwrap(), "id in use");
    assert!(children.lock().unwrap().get("child").unwrap().live().is_some());
  }

  #[cfg(unix)]
  #[test]
  fn failed_registration_terminates_and_reaps_its_untracked_child() {
    let children = Mutex::new(HashMap::<String, ChildSlot<()>>::new());
    let reservation = Reservation::acquire(&children, "child".into()).unwrap();
    // Reuse the test binary so the fixture needs no shell or external program.
    let child = Command::new(std::env::current_exe().unwrap()).arg("--list")
      .process_group(0).stdout(Stdio::null()).stderr(Stdio::null()).spawn().unwrap();
    let pid = child.id() as i32;
    let pending = PendingChild(Some(child));
    children.lock().unwrap().clear();
    assert!(reservation.commit(|| panic!("shutdown rejected the child")).is_err());
    drop(pending);
    // SAFETY: querying the known child PID with a valid status pointer, without blocking.
    let mut status = 0;
    assert_eq!(unsafe { libc::waitpid(pid, &mut status, libc::WNOHANG) }, -1);
    assert_eq!(std::io::Error::last_os_error().raw_os_error(), Some(libc::ECHILD));
  }

  #[test]
  fn early_error_and_unwind_both_release_the_reservation() {
    let children = Mutex::new(HashMap::<String, ChildSlot<()>>::new());
    let fail = || -> Result<(), String> {
      let _reservation = Reservation::acquire(&children, "child".into())?;
      Err("spawn failed".into())
    };
    assert_eq!(fail(), Err("spawn failed".into()));
    assert!(children.lock().unwrap().is_empty());
    assert!(std::panic::catch_unwind(|| {
      let _reservation = Reservation::acquire(&children, "child".into()).unwrap();
      panic!("spawn panicked");
    }).is_err());
    assert!(children.lock().unwrap().is_empty());
  }

  #[test]
  fn reservation_cleanup_recovers_a_poisoned_mutex() {
    let children = Mutex::new(HashMap::<String, ChildSlot<()>>::new());
    let reservation = Reservation::acquire(&children, "child".into()).unwrap();
    assert!(std::panic::catch_unwind(|| {
      let _lock = children.lock().unwrap();
      panic!("poison for cleanup test");
    }).is_err());
    assert!(reservation.commit(|| panic!("poisoned lock must reject registration")).is_err());
    assert!(children.lock().err().unwrap().into_inner().is_empty());
  }

  #[test]
  fn shutdown_invalidation_cannot_commit_or_remove_a_reused_id() {
    let children = Mutex::new(HashMap::<String, ChildSlot<()>>::new());
    let old = Reservation::acquire(&children, "child".into()).unwrap();
    children.lock().unwrap().clear(); // kill_all drains both reservations and live handles.
    assert!(old.commit(|| panic!("shutdown must reject registration")).is_err());
    let old = Reservation::acquire(&children, "child".into()).unwrap();
    children.lock().unwrap().clear();
    let replacement = Reservation::acquire(&children, "child".into()).unwrap();
    assert!(old.commit(|| panic!("stale reservation must not replace a newer one")).is_err());
    assert_eq!(children.lock().unwrap().len(), 1);
    replacement.commit(|| ()).unwrap();
    assert!(children.lock().unwrap().get("child").unwrap().live().is_some());
  }

  #[test]
  fn parallel_reservations_admit_only_eight_without_serializing_work() {
    let children = Mutex::new(HashMap::<String, ChildSlot<()>>::new());
    let barrier = std::sync::Barrier::new(16);
    std::thread::scope(|scope| {
      let threads = (0..16).map(|id| {
        let children = &children;
        let barrier = &barrier;
        scope.spawn(move || {
          let reservation = Reservation::acquire(children, id.to_string());
          // Keep every admitted reservation alive until all attempts have completed.
          barrier.wait();
          reservation.is_ok()
        })
      }).collect::<Vec<_>>();
      let admitted = threads.into_iter().map(|thread| usize::from(thread.join().unwrap())).sum::<usize>();
      assert_eq!(admitted, 8);
    });
    assert!(children.lock().unwrap().is_empty());
  }

  #[test]
  fn blocking_commands_are_dispatched_off_the_ui_thread_and_kill_waits_yield() {
    let source = include_str!("lib.rs");
    for name in ["cli_spawn", "cli_write", "cli_kill", "read_app_state", "host_platform"] {
      let start = source.find(&format!("fn {name}(")).unwrap();
      let attribute = source[..start].rfind("#[tauri::command").unwrap();
      assert!(source[attribute..start].starts_with("#[tauri::command(async)]"), "{name} must run off the UI thread");
    }
    let start = source.find("fn cli_spawn(").unwrap();
    let end = source[start..].find("let name = event_name").unwrap() + start;
    let spawn = &source[start..end];
    let reserved = spawn.find("Reservation::acquire").unwrap();
    let launched = spawn.find("command.spawn()").unwrap();
    let committed = spawn.find("reservation.commit").unwrap();
    assert!(reserved < launched && launched < committed);
    assert!(!spawn.contains("children.lock()"), "spawn must never hold the admission mutex");
    assert!(spawn.contains("could not start {node}: {e}"));
    let start = source.find("async fn cli_kill(").unwrap();
    let end = source[start..].find("fn kill_all(").unwrap() + start;
    let kill = &source[start..end];
    assert!(!kill.contains("std::thread::sleep"));
    assert!(kill.contains("tokio::time::sleep(Duration::from_millis(25)).await"));
    assert!(kill.contains("tokio::time::sleep(Duration::from_millis(500)).await"));
    assert!(kill.contains("Duration::from_millis(1_500)"));
    assert_eq!(CANCEL_GRACE_MS, 400);
    let update = include_str!("app_update.rs");
    assert!(update.contains("#[tauri::command(async)]\npub fn app_update_on_close"));
    // The Windows process wait must also yield the executor worker.
    let start = source.find("async fn terminate_windows_child(").unwrap();
    let end = source[start..].find("/// Allow protocol cancellation").unwrap() + start;
    assert!(source[start..end].contains("tauri::async_runtime::spawn_blocking"));
  }

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
