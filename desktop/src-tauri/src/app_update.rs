//! Close-time update handoff: outside Bridge.children so shutdown cannot kill the installer.
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{atomic::{AtomicBool, Ordering}, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
#[cfg(unix)]
use std::os::unix::{fs::OpenOptionsExt, process::CommandExt};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const DETACHED_PROCESS: u32 = 0x0000_0008;

#[derive(Default)]
pub struct CloseUpdate { armed: Mutex<Option<ArmedUpdate>>, started: AtomicBool }
impl CloseUpdate {
  fn take_for_exit(&self) -> Option<ArmedUpdate> {
    // Shutdown must preserve a pending install even if an earlier command panicked with this lock held.
    let mut armed = self.armed.lock().unwrap_or_else(|error| error.into_inner());
    if armed.is_some() && !self.started.swap(true, Ordering::AcqRel) { armed.take() } else { None }
  }
}
struct ArmedUpdate { version: String, node: String, entry: String, path: Option<String> }

fn run_directory() -> Result<PathBuf, String> {
  let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).ok_or("no home directory")?;
  Ok(PathBuf::from(home).join(".terum").join("skills").join("run"))
}
fn released(version: &str) -> bool {
  let parts: Vec<_> = version.split('.').collect();
  parts.len() == 3 && parts.iter().all(|p| !p.is_empty() && p.bytes().all(|c| c.is_ascii_digit()))
}
#[tauri::command(async)]
pub fn app_update_on_close(state: tauri::State<'_, CloseUpdate>, version: Option<String>) -> Result<(), String> {
  arm(&state, version, super::read_app_state)
}
fn arm(state: &CloseUpdate, version: Option<String>, read_launch: impl FnOnce() -> Result<Option<String>, String>) -> Result<(), String> {
  let mut armed = state.armed.lock().map_err(|e| e.to_string())?;
  // Clear any previous arm even when replacement validation fails.
  *armed = None;
  let Some(version) = version else { return Ok(()); };
  if state.started.load(Ordering::Acquire) { return Err("An update installer has already been started.".into()); }
  if !released(&version) { return Err("Update version must contain three numbers.".into()); }
  let text = read_launch()?.ok_or("No CLI launch state; launch the app through terum-skills app first.")?;
  let launch: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
  let field = |name: &str| launch[name].as_str().filter(|s| !s.trim().is_empty()).map(str::to_owned).ok_or_else(|| format!("No {name} in CLI launch state."));
  *armed = Some(ArmedUpdate { version, node: field("node")?, entry: field("entry")?, path: launch["path"].as_str().map(str::to_owned) });
  Ok(())
}
fn argv(version: &str) -> [String; 6] {
  ["app-update", "--apply-now", "--release", version, "--reason", "on-close"].map(str::to_owned)
}
fn command(armed: &ArmedUpdate, pid: u32) -> Command {
  // Use the recorded Node and entry (the same terum-skills CLI as the bridge), including GUI launch PATH.
  let mut command = Command::new(&armed.node);
  command.arg(&armed.entry).args(argv(&armed.version))
    .args(["--await-pid", &pid.to_string()])
    .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
  if let Some(path) = &armed.path { command.env("PATH", path); }
  if let Some(dir) = super::default_spawn_dir() { command.current_dir(dir); }
  command.env("TERUM_SKILLS_NO_UPDATE_NOTIFIER", "1");
  #[cfg(unix)]
  command.process_group(0);
  #[cfg(windows)]
  command.creation_flags(super::CREATE_NO_WINDOW | DETACHED_PROCESS);
  #[cfg(target_os = "macos")]
  super::disclaim::disclaim_tcc_responsibility(&mut command);
  command
}
fn spawn(armed: &ArmedUpdate) -> std::io::Result<()> {
  command(armed, std::process::id()).spawn().map(|_| ())
}
// Gregorian civil date from Unix days (400-year eras); no clock/network dependency in the shell.
fn timestamp(seconds: u64) -> String {
  let days = (seconds / 86_400) as i64 + 719_468;
  let era = days / 146_097;
  let doe = days - era * 146_097;
  let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
  let mut year = yoe + era * 400;
  let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  let mp = (5 * doy + 2) / 153;
  let day = doy - (153 * mp + 2) / 5 + 1;
  let month = mp + if mp < 10 { 3 } else { -9 };
  if month <= 2 { year += 1; }
  format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.000Z", seconds / 3600 % 24, seconds / 60 % 60, seconds % 60)
}
fn marker(version: &str, phase: &str, error: Option<&str>, seconds: u64) -> serde_json::Value {
  serde_json::json!({"schema":1,"version":version,"phase":phase,"at":timestamp(seconds),"error":error,"reason":"on-close"})
}
fn write_marker(dir: &std::path::Path, data: &serde_json::Value) -> Result<(), String> {
  std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
  let path = dir.join("app-update.json");
  let mut options = std::fs::OpenOptions::new();
  options.write(true).create(true).truncate(true);
  #[cfg(unix)]
  options.mode(0o600);
  let mut file = options.open(path).map_err(|e| e.to_string())?;
  file.write_all(data.to_string().as_bytes()).and_then(|_| file.sync_all()).map_err(|e| e.to_string())
}
fn record(version: &str, phase: &str, error: Option<&str>) -> Result<(), String> {
  let seconds = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_secs();
  write_marker(&run_directory()?, &marker(version, phase, error, seconds))
}
/// Taking the arm and reserving this process prevents duplicates even if a late arm races shutdown.
pub fn on_exit(state: &CloseUpdate) {
  if let Some(armed) = state.take_for_exit() {
    if let Err(error) = record(&armed.version, "waiting", None) {
      // Still attempt installation: an unwritable marker must not block closing or a valid update.
      log::error!("Could not record pending update: {error}");
    }
    if let Err(error) = spawn(&armed) {
      if let Err(marker_error) = record(&armed.version, "failed", Some(&format!("Could not start the installer: {error}"))) {
        // Closing must proceed even when the failure marker's disk is unwritable.
        log::error!("Update spawn failed: {error}; could not record it: {marker_error}");
      }
    }
  }
}
#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn close_argv() { assert_eq!(argv("0.12.2"), ["app-update", "--apply-now", "--release", "0.12.2", "--reason", "on-close"]); }
  #[test]
  fn versions() { for v in ["", "1.2", "1.2.3-rc1", "1.2.3/4", "-1.2.3"] { assert!(!released(v)); } assert!(released("0.12.2")); }
  #[test]
  fn timestamps() { assert_eq!(timestamp(0), "1970-01-01T00:00:00.000Z"); assert_eq!(timestamp(1_709_164_800), "2024-02-29T00:00:00.000Z"); }
  #[test]
  fn handoff_is_once_even_if_a_late_arm_arrives() {
    let state = CloseUpdate::default();
    let update = || ArmedUpdate { version: "0.12.2".into(), node: "node".into(), entry: "cli".into(), path: None };
    *state.armed.lock().unwrap() = Some(update());
    assert!(state.take_for_exit().is_some());
    *state.armed.lock().unwrap() = Some(update());
    assert!(state.take_for_exit().is_none());
  }
  #[test]
  fn disarmed_exit_is_noop() { let state = CloseUpdate::default(); on_exit(&state); on_exit(&state); assert!(state.armed.lock().unwrap().is_none()); }

  #[test]
  fn arm_validates_launch_state_and_clears_old_arms() {
    let state = CloseUpdate::default();
    for text in [None, Some("not json"), Some("{}"), Some(r#"{"node":"node"}"#), Some(r#"{"entry":"cli"}"#), Some(r#"{"node":"","entry":"cli"}"#), Some(r#"{"node":"node","entry":" "}"#)] {
      assert!(arm(&state, Some("0.12.2".into()), || Ok(text.map(str::to_owned))).is_err());
      assert!(state.armed.lock().unwrap().is_none());
    }
    assert!(arm(&state, Some("bad".into()), || panic!("invalid version must not read launch state")).is_err());
    let launch = || Ok(Some(r#"{"node":"/node","entry":"/cli","path":"/bin"}"#.into()));
    arm(&state, Some("0.12.2".into()), launch).unwrap();
    { let lock = state.armed.lock().unwrap(); let value = lock.as_ref().unwrap(); assert_eq!((&*value.node, &*value.entry, value.path.as_deref()), ("/node", "/cli", Some("/bin"))); }
    arm(&state, None, || panic!("disarm must not read launch state")).unwrap();
    assert!(state.take_for_exit().is_none());
    arm(&state, Some("0.12.2".into()), launch).unwrap();
    assert!(state.take_for_exit().is_some());
    assert!(arm(&state, Some("0.12.2".into()), || panic!("started must not read launch state")).is_err());
  }
  #[test]
  fn installer_command_preserves_launch_environment_and_parent_pid() {
    let cmd = command(&ArmedUpdate { version: "0.12.2".into(), node: "/node".into(), entry: "/cli".into(), path: Some("/recorded/path".into()) }, 42);
    assert_eq!(cmd.get_program(), "/node");
    assert_eq!(cmd.get_args().collect::<Vec<_>>(), ["/cli", "app-update", "--apply-now", "--release", "0.12.2", "--reason", "on-close", "--await-pid", "42"]);
    let env = cmd.get_envs().collect::<std::collections::BTreeMap<_, _>>();
    assert_eq!(env.get(std::ffi::OsStr::new("PATH")), Some(&Some(std::ffi::OsStr::new("/recorded/path"))));
    assert_eq!(env.get(std::ffi::OsStr::new("TERUM_SKILLS_NO_UPDATE_NOTIFIER")), Some(&Some(std::ffi::OsStr::new("1"))));
  }
  #[test]
  fn marker_contract_and_disk_round_trip() {
    let dir = std::env::temp_dir().join(format!("terum-update-marker-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
    for (phase, error) in [("waiting", None), ("failed", Some("spawn failed"))] {
      let data = marker("0.12.2", phase, error, 0);
      assert_eq!(data, serde_json::json!({"schema":1,"version":"0.12.2","phase":phase,"at":"1970-01-01T00:00:00.000Z","error":error,"reason":"on-close"}));
      write_marker(&dir, &data).unwrap();
      let saved: serde_json::Value = serde_json::from_slice(&std::fs::read(dir.join("app-update.json")).unwrap()).unwrap();
      assert_eq!(saved, data);
    }
    std::fs::remove_dir_all(&dir).unwrap();
    let file = dir.with_extension("file"); std::fs::write(&file, "occupied").unwrap();
    assert!(write_marker(&file, &marker("0.12.2", "waiting", None, 0)).is_err());
    std::fs::remove_file(file).unwrap();
  }
  #[test]
  fn poisoned_shutdown_lock_preserves_the_install() {
    let state = std::sync::Arc::new(CloseUpdate::default());
    let thread_state = state.clone();
    assert!(std::thread::spawn(move || {
      let mut lock = thread_state.armed.lock().unwrap();
      *lock = Some(ArmedUpdate { version: "0.12.2".into(), node: "node".into(), entry: "cli".into(), path: None });
      panic!("poison for recovery test");
    }).join().is_err());
    assert!(state.take_for_exit().is_some());
    assert!(state.take_for_exit().is_none());
  }
}
