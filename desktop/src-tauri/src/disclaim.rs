//! macOS only: spawn the CLI child "disclaimed" so it — not the app bundle — is the process
//! TCC holds responsible for anything its descendants touch.
//!
//! Why: macOS attributes protected-resource access (Media Library, Photos, …) anywhere in a
//! process tree to the tree's *responsible process*. The eval verb runs `claude` with an
//! unrestricted Bash tool under this bridge's Node child, so an agent's `find`/`brew`/`npm`
//! brushing ~/Music surfaced as "'Terum Skills' would like to access Apple Music…". Terminal
//! emulators break exactly this inheritance with the private-but-long-stable libproc attribute
//! `responsibility_spawnattrs_setdisclaim` (see Chromium base/process/launch_mac.cc, sudo's
//! exec.c, kitty, WezTerm); a disclaimed child becomes its own responsible process.
//!
//! How: std::process::Command has no posix_spawn path, so we piggyback on its fork+exec.
//! A `pre_exec` closure runs in the forked child AFTER std has wired the stdio pipes, set the
//! process group, chdir'd, and reset signal handling — everything `cli_spawn`/`cli_kill` rely
//! on — and replaces std's execvp with posix_spawnp(POSIX_SPAWN_SETEXEC) carrying the disclaim
//! attribute (the same fork-then-SETEXEC shape sudo uses). On success the call never returns;
//! on any failure the closure returns Ok(()) and std's normal execvp proceeds, so the worst
//! outcome is the pre-fix behavior: the spawn still works, merely undisclaimed.

use std::collections::BTreeMap;
use std::ffi::{CString, OsString};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::process::CommandExt;
use std::process::Command;

type SetDisclaim = unsafe extern "C" fn(*mut libc::posix_spawnattr_t, libc::c_int) -> libc::c_int;

/// NUL-terminated pointer array that owns its backing CStrings. The raw pointers are only
/// dereferenced in the forked child (single-threaded by then); Send/Sync only lets the closure
/// move between threads before the fork, which is fine for owned, never-mutated buffers.
struct CStringArray {
  _owned: Vec<CString>,
  ptrs: Vec<*mut libc::c_char>,
}
unsafe impl Send for CStringArray {}
unsafe impl Sync for CStringArray {}

impl CStringArray {
  fn new(items: impl IntoIterator<Item = Vec<u8>>) -> Self {
    // Interior NULs cannot occur in real argv/env entries; drop such an entry over failing the spawn.
    let owned: Vec<CString> = items.into_iter().filter_map(|bytes| CString::new(bytes).ok()).collect();
    let mut ptrs: Vec<*mut libc::c_char> = owned.iter().map(|s| s.as_ptr() as *mut libc::c_char).collect();
    ptrs.push(std::ptr::null_mut());
    CStringArray { _owned: owned, ptrs }
  }

  /// Borrow the NUL-terminated pointer array. Taking `&self` (rather than reaching for `.ptrs`
  /// at the call site) is load-bearing: under Rust 2021 disjoint closure captures, `move ||`
  /// that names only `argv.ptrs` captures that `Vec<*mut c_char>` field alone — which is neither
  /// `Send`/`Sync` (the unsafe impls below are on the struct, not the field) nor keeps `_owned`
  /// alive, leaving the pointers dangling. Going through a method captures the whole struct.
  fn as_ptr(&self) -> *const *mut libc::c_char {
    self.ptrs.as_ptr()
  }
}

/// The symbol is private API: resolve it at runtime so a macOS release that ever drops it
/// degrades to a normal (undisclaimed) spawn instead of an app that fails to load.
fn resolve_setdisclaim() -> Option<SetDisclaim> {
  const NAME: &[u8] = b"responsibility_spawnattrs_setdisclaim\0";
  let sym = unsafe { libc::dlsym(libc::RTLD_DEFAULT, NAME.as_ptr().cast()) };
  if sym.is_null() { None } else { Some(unsafe { std::mem::transmute::<*mut libc::c_void, SetDisclaim>(sym) }) }
}

/// Arrange for `command` to exec disclaimed. Call once, after the program, args, env, and cwd
/// are final — the closure snapshots argv/envp here in the parent, because the Command's
/// internals are not readable from inside the forked child.
pub fn disclaim_tcc_responsibility(command: &mut Command) {
  let Some(setdisclaim) = resolve_setdisclaim() else { return };

  let program = command.get_program().to_os_string();
  let Ok(program_c) = CString::new(program.as_bytes()) else { return };
  let argv = CStringArray::new(
    std::iter::once(program.as_os_str())
      .chain(command.get_args())
      .map(|arg| arg.as_bytes().to_vec()),
  );

  // envp: std applies the Command's env overrides AFTER pre_exec closures run (immediately
  // before its own execvp), so the closure would otherwise exec with the parent's untouched
  // environment. Rebuild the effective child env here: parent env + Command's set/removed vars.
  let mut env: BTreeMap<OsString, OsString> = std::env::vars_os().collect();
  for (key, value) in command.get_envs() {
    match value {
      Some(value) => { env.insert(key.to_os_string(), value.to_os_string()); }
      None => { env.remove(key); }
    }
  }
  let envp = CStringArray::new(env.into_iter().map(|(key, value)| {
    let mut entry = key.as_bytes().to_vec();
    entry.push(b'=');
    entry.extend_from_slice(value.as_bytes());
    entry
  }));

  let exec_disclaimed = move || -> std::io::Result<()> {
    // SAFETY: we are between fork and exec. Everything below is direct libc calls on buffers
    // built in the parent; posix_spawnattr_init's internal allocation is the same post-fork
    // malloc that sudo and kitty rely on for this exact sequence.
    unsafe {
      let mut attr: libc::posix_spawnattr_t = std::ptr::null_mut();
      if libc::posix_spawnattr_init(&mut attr) != 0 {
        return Ok(()); // fail open: std's execvp still runs, merely undisclaimed
      }
      if libc::posix_spawnattr_setflags(&mut attr, libc::POSIX_SPAWN_SETEXEC as libc::c_short) == 0
        && setdisclaim(&mut attr, 1) == 0
      {
        // POSIX_SPAWN_SETEXEC makes this behave like exec: on success it never returns.
        // posix_spawnp (not posix_spawn) to keep execvp's PATH-search semantics.
        libc::posix_spawnp(
          std::ptr::null_mut(),
          program_c.as_ptr(),
          std::ptr::null(),
          &attr,
          argv.as_ptr(),
          envp.as_ptr(),
        );
      }
      libc::posix_spawnattr_destroy(&mut attr);
    }
    Ok(()) // any failure above falls through to std's execvp — spawn works, undisclaimed
  };
  // SAFETY: pre_exec contract — the closure performs only the fork-safe work described above,
  // on memory it owns; it never touches the parent's locks or Command state.
  unsafe { command.pre_exec(exec_disclaimed); }
}
