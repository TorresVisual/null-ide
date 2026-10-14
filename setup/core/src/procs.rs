use sysinfo::{Pid, ProcessRefreshKind, RefreshKind, System};

#[derive(Clone, Debug, PartialEq)]
pub struct Running { pub pid: u32, pub name: String }

fn processes() -> System {
    System::new_with_specifics(RefreshKind::new().with_processes(ProcessRefreshKind::everything()))
}

pub fn pid_alive(pid: u32) -> bool {
    processes().process(Pid::from_u32(pid)).is_some()
}
