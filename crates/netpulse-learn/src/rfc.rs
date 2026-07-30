//! RFC Metadata Database & Relationship Graph.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RfcMetadata {
    pub rfc_number: u32,
    pub title: String,
    pub section: String,
    pub description: String,
    pub updated_by: Vec<u32>,
    pub obsoleted_by: Vec<u32>,
    pub see_also: Vec<u32>,
}

#[derive(Debug)]
pub struct RfcRegistry;

impl RfcRegistry {
    pub fn get(rfc_number: u32) -> Option<RfcMetadata> {
        match rfc_number {
            791 => Some(RfcMetadata {
                rfc_number: 791,
                title: "Internet Protocol".into(),
                section: "§3.1 IPv4 Header Format".into(),
                description: "Defines TTL, Header Checksum, Flags, and Fragmentation fields.".into(),
                updated_by: vec![2474, 6864],
                obsoleted_by: vec![],
                see_also: vec![8200],
            }),
            8200 => Some(RfcMetadata {
                rfc_number: 8200,
                title: "Internet Protocol, Version 6 (IPv6) Specification".into(),
                section: "§3 IPv6 Header Format".into(),
                description: "Replaces TTL with Hop Limit and replaces TOS with Traffic Class.".into(),
                updated_by: vec![],
                obsoleted_by: vec![],
                see_also: vec![791],
            }),
            9000 => Some(RfcMetadata {
                rfc_number: 9000,
                title: "QUIC: A UDP-Based Multiplexed and Secure Transport".into(),
                section: "§17 Packet Formats".into(),
                description: "Defines Long/Short Header formats, Connection IDs, and Packet Numbers.".into(),
                updated_by: vec![],
                obsoleted_by: vec![],
                see_also: vec![8999, 9001],
            }),
            _ => None,
        }
    }
}
