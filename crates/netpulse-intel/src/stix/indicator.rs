//! STIX indicator domain structures (docs/18 §4.9).

use std::net::IpAddr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ThreatCategory {
    IpAddress,
    Domain,
    Url,
    FileHash,
    Unknown,
}

impl ThreatCategory {
    pub fn name(self) -> &'static str {
        match self {
            ThreatCategory::IpAddress => "IP Indicator",
            ThreatCategory::Domain => "Domain Indicator",
            ThreatCategory::Url => "URL Indicator",
            ThreatCategory::FileHash => "File Hash Indicator",
            ThreatCategory::Unknown => "Threat Indicator",
        }
    }
}

/// Domain model for an offline STIX 2.1 threat intelligence indicator.
#[derive(Debug, Clone, PartialEq)]
pub struct StixIndicator {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: ThreatCategory,
    pub pattern: String,
    pub ip_value: Option<IpAddr>,
    pub domain_value: Option<String>,
    pub confidence: f32,
}

impl StixIndicator {
    pub fn new(id: impl Into<String>, name: impl Into<String>, pattern: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            description: String::new(),
            category: ThreatCategory::Unknown,
            pattern: pattern.into(),
            ip_value: None,
            domain_value: None,
            confidence: 0.75,
        }
    }
}
