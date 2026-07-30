//! STIX 2.1 JSON parser (docs/18 §4.9).
//!
//! Parses offline STIX 2.1 JSON bundle files without network egress.
//! Ignores unsupported STIX object types (Malware, Campaign, AttackPattern) as metadata
//! rather than failing parsing.

use serde::Deserialize;
use std::net::IpAddr;
use std::str::FromStr;

use super::indicator::{StixIndicator, ThreatCategory};

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct StixBundleJson {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub objects: Vec<StixObjectJson>,
}

#[derive(Debug, Deserialize)]
struct StixObjectJson {
    #[serde(rename = "type")]
    pub object_type: String,
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub pattern: Option<String>,
    #[serde(default)]
    pub confidence: Option<f32>,
}

/// Parse STIX 2.1 JSON string bundle offline.
pub fn parse_stix_bundle(json: &str) -> Result<Vec<StixIndicator>, String> {
    let bundle: StixBundleJson =
        serde_json::from_str(json).map_err(|e| format!("STIX parse error: {e}"))?;

    let mut indicators = Vec::new();

    for obj in bundle.objects {
        // Intentionally ignore unsupported STIX object types (Malware, Campaign, AttackPattern)
        if obj.object_type != "indicator" {
            continue;
        }

        let pattern = obj.pattern.unwrap_or_default();
        let name = obj.name.unwrap_or_else(|| "STIX Indicator".to_string());
        let desc = obj.description.unwrap_or_default();
        let confidence = (obj.confidence.unwrap_or(75.0) / 100.0).clamp(0.1, 0.95);

        let mut ind = StixIndicator::new(&obj.id, &name, &pattern);
        ind.description = desc;
        ind.confidence = confidence;

        // Simple pattern extraction e.g. [ipv4-addr:value = '198.51.100.4'] or [domain-name:value = 'malicious.test']
        if pattern.contains("ipv4-addr:value") || pattern.contains("ipv6-addr:value") {
            ind.category = ThreatCategory::IpAddress;
            if let Some(val) = extract_pattern_value(&pattern) {
                if let Ok(ip) = IpAddr::from_str(&val) {
                    ind.ip_value = Some(ip);
                }
            }
        } else if pattern.contains("domain-name:value") {
            ind.category = ThreatCategory::Domain;
            if let Some(val) = extract_pattern_value(&pattern) {
                ind.domain_value = Some(val);
            }
        } else if pattern.contains("url:value") {
            ind.category = ThreatCategory::Url;
        } else if pattern.contains("file:hashes") {
            ind.category = ThreatCategory::FileHash;
        }

        indicators.push(ind);
    }

    Ok(indicators)
}

fn extract_pattern_value(pattern: &str) -> Option<String> {
    let first_quote = pattern.find('\'')?;
    let rest = &pattern[first_quote + 1..];
    let second_quote = rest.find('\'')?;
    Some(rest[..second_quote].to_string())
}
