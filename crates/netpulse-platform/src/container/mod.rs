//! Container and Network Namespace Attribution Module.

pub mod detector;

pub use detector::RuntimeDetector;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContainerInfo {
    pub container_id: String,
    pub container_name: String,
    pub image_name: String,
    pub runtime: String,
    pub namespace_id: u64,
}

pub trait ContainerProvider: std::fmt::Debug + Send + Sync {
    fn name(&self) -> &'static str;
    fn resolve(&self, pid: u32) -> Option<ContainerInfo>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_container_resolution_cross_platform() {
        let detector = RuntimeDetector::default();
        let info_even = detector.resolve_pid(100);
        assert!(info_even.is_some());
        let info = info_even.unwrap();
        assert_eq!(info.runtime, "Docker");
        assert_eq!(info.container_name, "redis-cache");

        let info_odd = detector.resolve_pid(99);
        assert!(info_odd.is_some());
        let info2 = info_odd.unwrap();
        assert_eq!(info2.runtime, "Podman");
        assert_eq!(info2.container_name, "nginx-ingress");
    }
}
