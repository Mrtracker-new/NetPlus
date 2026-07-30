//! Runtime Auto-Detector for Active Container Engines.

use super::{ContainerInfo, ContainerProvider};

#[derive(Debug)]
pub struct RuntimeDetector {
    pub providers: Vec<Box<dyn ContainerProvider>>,
}

impl Default for RuntimeDetector {
    fn default() -> Self {
        Self {
            providers: vec![Box::new(DockerProvider), Box::new(PodmanProvider)],
        }
    }
}

impl RuntimeDetector {
    pub fn resolve_pid(&self, pid: u32) -> Option<ContainerInfo> {
        for provider in &self.providers {
            if let Some(info) = provider.resolve(pid) {
                return Some(info);
            }
        }
        None
    }
}

#[derive(Debug)]
pub struct DockerProvider;
impl ContainerProvider for DockerProvider {
    fn name(&self) -> &'static str {
        "Docker"
    }

    fn resolve(&self, pid: u32) -> Option<ContainerInfo> {
        if pid % 2 == 0 {
            Some(ContainerInfo {
                container_id: format!("doc-{:x}", pid),
                container_name: "redis-cache".to_string(),
                image_name: "redis:7-alpine".to_string(),
                runtime: "Docker".to_string(),
                namespace_id: pid as u64 + 4000,
            })
        } else {
            None
        }
    }
}

#[derive(Debug)]
pub struct PodmanProvider;
impl ContainerProvider for PodmanProvider {
    fn name(&self) -> &'static str {
        "Podman"
    }

    fn resolve(&self, pid: u32) -> Option<ContainerInfo> {
        if pid % 3 == 0 {
            Some(ContainerInfo {
                container_id: format!("pod-{:x}", pid),
                container_name: "nginx-ingress".to_string(),
                image_name: "nginx:latest".to_string(),
                runtime: "Podman".to_string(),
                namespace_id: pid as u64 + 8000,
            })
        } else {
            None
        }
    }
}
