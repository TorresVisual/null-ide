use std::{
    fs,
    path::{Path, PathBuf},
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};

use crate::error::{Error, IoCtx, Result};

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq)]
pub enum Step { Started, AsideDone, MovedIn }

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Plan { pub install: PathBuf, pub staged: PathBuf, pub aside: PathBuf }

#[derive(Serialize, Deserialize)]
struct Journal { plan: Plan, step: Step }

#[derive(Clone, Copy)]
pub struct Timing { pub retries: u32, pub delay: Duration }

impl Timing {
    pub const STANDARD: Timing = Timing { retries: 10, delay: Duration::from_millis(500) };
}

pub enum Hook { Continue, Fail, Crash }

#[derive(Debug, PartialEq)]
pub enum Recovered { Nothing, RolledBack, Committed }

fn parent_of(install: &Path) -> &Path { install.parent().unwrap_or(Path::new(".")) }

pub fn journal_path(install: &Path) -> PathBuf { parent_of(install).join(".null-update-journal.json") }
pub fn ready_marker(install: &Path) -> PathBuf { install.join(".null-ready") }

pub fn plan_for(install: &Path, tag: &str) -> Plan {
    let parent = parent_of(install);
    Plan {
        install: install.to_path_buf(),
        staged: parent.join(format!(".null-ide-stage-{tag}")),
        aside: parent.join(format!(".null-ide-bak-{tag}")),
    }
}

fn write_journal(plan: &Plan, step: Step) -> Result<()> {
    let path = journal_path(&plan.install);
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(&Journal { plan: plan.clone(), step }).map_err(|e| Error::Other(e.to_string()))?;
    fs::write(&tmp, text).ctx("write update journal")?;
    fs::rename(&tmp, &path).ctx("commit update journal")
}

fn read_journal(install: &Path) -> Option<Journal> {
    serde_json::from_str(&fs::read_to_string(journal_path(install)).ok()?).ok()
}

fn rename_retry(from: &Path, to: &Path, t: &Timing) -> Result<()> {
    let mut last = None;
    for i in 0..t.retries.max(1) {
        match fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) => last = Some(e),
        }
        if i + 1 < t.retries {
            thread::sleep(t.delay);
        }
    }
    Err(Error::Io { context: format!("rename {} -> {}", from.display(), to.display()), source: last.unwrap() })
}

fn fire(hook: &mut dyn FnMut(Step) -> Hook, step: Step) -> Result<()> {
    match hook(step) {
        Hook::Continue => Ok(()),
        Hook::Fail => Err(Error::Other(format!("injected failure after {step:?}"))),
        Hook::Crash => Err(Error::Crashed),
    }
}

pub fn swap(plan: &Plan, t: &Timing, hook: &mut dyn FnMut(Step) -> Hook) -> Result<()> {
    match run_swap(plan, t, hook) {
        Ok(()) => Ok(()),
        Err(Error::Crashed) => Err(Error::Crashed),
        Err(e) => match rollback(plan, t) {
            Ok(()) => Err(e),
            Err(r) => Err(Error::Other(format!("{e}; rollback also failed: {r}"))),
        },
    }
}

fn run_swap(plan: &Plan, t: &Timing, hook: &mut dyn FnMut(Step) -> Hook) -> Result<()> {
    // A leftover backup would be mistaken for ours by rollback. Recovery has already run, so it is garbage.
    if plan.aside.exists() {
        fs::remove_dir_all(&plan.aside).ctx("remove stale backup")?;
    }
    write_journal(plan, Step::Started)?;
    fire(hook, Step::Started)?;
    if plan.install.exists() {
        rename_retry(&plan.install, &plan.aside, t)?;
        write_journal(plan, Step::AsideDone)?;
        fire(hook, Step::AsideDone)?;
        let data = plan.aside.join("data");
        if data.exists() {
            rename_retry(&data, &plan.staged.join("data"), t)?;
        }
    }
    rename_retry(&plan.staged, &plan.install, t)?;
    // ponytail: if this journal write fails the new install stays in place with a backup beside it; harmless, cleaned by the next update.
    write_journal(plan, Step::MovedIn)?;
    fire(hook, Step::MovedIn)
}

pub fn commit(plan: &Plan) -> Result<()> {
    if plan.aside.exists() {
        fs::remove_dir_all(&plan.aside).ctx("remove the old install")?;
    }
    let _ = fs::remove_file(ready_marker(&plan.install));
    let _ = fs::remove_file(journal_path(&plan.install));
    Ok(())
}

/// Idempotent. Restores the old install when the journal (or a missing install) says it was moved aside.
pub fn rollback(plan: &Plan, t: &Timing) -> Result<()> {
    let step = read_journal(&plan.install).map(|j| j.step);
    let swapped = matches!(step, Some(Step::AsideDone | Step::MovedIn)) || !plan.install.exists();
    if plan.aside.exists() && swapped {
        let aside_data = plan.aside.join("data");
        if plan.install.exists() {
            let d = plan.install.join("data");
            if d.exists() && !aside_data.exists() {
                rename_retry(&d, &aside_data, t)?;
            }
            fs::remove_dir_all(&plan.install).ctx("remove the failed install")?;
        } else {
            let d = plan.staged.join("data");
            if d.exists() && !aside_data.exists() {
                rename_retry(&d, &aside_data, t)?;
            }
        }
        rename_retry(&plan.aside, &plan.install, t)?;
    }
    if plan.staged.exists() {
        let _ = fs::remove_dir_all(&plan.staged);
    }
    let _ = fs::remove_file(journal_path(&plan.install));
    Ok(())
}

pub fn recover(install: &Path, t: &Timing) -> Result<Recovered> {
    let Some(j) = read_journal(install) else { return Ok(Recovered::Nothing) };
    if j.step == Step::MovedIn && ready_marker(&j.plan.install).exists() {
        commit(&j.plan)?;
        Ok(Recovered::Committed)
    } else {
        rollback(&j.plan, t)?;
        Ok(Recovered::RolledBack)
    }
}
