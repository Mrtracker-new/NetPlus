//! Asynchronous Task Supervisor & Lifecycle Manager.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TaskStatus {
    Starting,
    Running,
    Stopped,
    Failed(String),
}

#[derive(Debug)]
pub struct TaskSupervisor {
    tasks: HashMap<String, TaskStatus>,
    shutdown_signal: Arc<AtomicBool>,
}

impl Default for TaskSupervisor {
    fn default() -> Self {
        Self {
            tasks: HashMap::new(),
            shutdown_signal: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl TaskSupervisor {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register_task(&mut self, name: impl Into<String>) {
        self.tasks.insert(name.into(), TaskStatus::Running);
    }

    pub fn get_status(&self, name: &str) -> Option<&TaskStatus> {
        self.tasks.get(name)
    }

    pub fn shutdown(&mut self) {
        self.shutdown_signal.store(true, Ordering::SeqCst);
        for status in self.tasks.values_mut() {
            *status = TaskStatus::Stopped;
        }
    }

    pub fn is_shutting_down(&self) -> bool {
        self.shutdown_signal.load(Ordering::SeqCst)
    }
}
