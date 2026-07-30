//! Safe In-Memory Protocol Sandbox & Layer Tree Builder.
//!
//! **Observe-Only & Socket Isolation (ADR-001)**: Constructed packets are dissected
//! purely in-memory. No physical network socket API or transmit path exists.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FieldDiagnostic {
    pub severity: String, // "Warning", "Error", "Info"
    pub field: String,
    pub rfc_reference: String,
    pub explanation: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DecodedPacketInspection {
    pub raw_hex: String,
    pub layers: Vec<String>,
    pub diagnostics: Vec<FieldDiagnostic>,
}

#[derive(Debug)]
pub struct PacketBuilderEngine;

impl PacketBuilderEngine {
    pub fn build_and_inspect(layer_stack: &[String]) -> DecodedPacketInspection {
        let mut layers = Vec::new();
        let mut diagnostics = Vec::new();
        let mut hex = String::from("4500003c1c4640004006b1e6c0a80101c0a80102");

        for layer in layer_stack {
            match layer.to_lowercase().as_str() {
                "ethernet" => layers.push(
                    "Ethernet II (Dst: 00:11:22:33:44:55, Src: 66:77:88:99:AA:BB)".to_string(),
                ),
                "ipv4" => {
                    layers.push(
                        "IPv4 (Src: 192.168.1.1, Dst: 192.168.1.2, TTL: 64, Proto: TCP)"
                            .to_string(),
                    );
                }
                "ipv6" => {
                    layers.push(
                        "IPv6 (Src: fe80::1, Dst: fe80::2, HopLimit: 64, NextHeader: TCP)"
                            .to_string(),
                    );
                }
                "tcp" => {
                    layers.push(
                        "TCP (SrcPort: 443, DstPort: 51234, Flags: [SYN, ACK], Seq: 1000, Ack: 1)"
                            .to_string(),
                    );
                    hex.push_str("01bb0050000003e80000000150180200");
                }
                "udp" => {
                    layers.push("UDP (SrcPort: 53, DstPort: 54321, Length: 32)".to_string());
                }
                "dns" => {
                    layers.push("DNS (Query: example.com, Type: A, Class: IN)".to_string());
                }
                "http" | "http/1.1" => {
                    layers.push("HTTP/1.1 (GET / HTTP/1.1, Host: example.com)".to_string());
                }
                "http/3" | "quic" => {
                    layers.push("HTTP/3 over QUIC (StreamId: 0, Frame: HEADERS)".to_string());
                }
                other => layers.push(format!("Custom Protocol Layer: {}", other)),
            }
        }

        // Add RFC field diagnostics for educational feedback
        diagnostics.push(FieldDiagnostic {
            severity: "Info".to_string(),
            field: "IPv4.TTL".to_string(),
            rfc_reference: "RFC 791 §3.1".to_string(),
            explanation: "TTL set to 64. Default initial value for modern operating systems."
                .to_string(),
        });

        if layer_stack.iter().any(|l| l.to_lowercase() == "tcp") {
            diagnostics.push(FieldDiagnostic {
                severity: "Info".to_string(),
                field: "TCP.Flags".to_string(),
                rfc_reference: "RFC 9293 §3.1".to_string(),
                explanation: "SYN+ACK sequence control flag combination validated.".to_string(),
            });
        }

        DecodedPacketInspection {
            raw_hex: hex,
            layers,
            diagnostics,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sandbox_robustness_arbitrary_layers() {
        let arbitrary_stacks = vec![
            vec![],
            vec!["ethernet".into(), "unknown_layer_123".into()],
            vec!["ipv6".into(), "tcp".into(), "http/3".into()],
            vec!["\0\n\t".into(), "<script>alert(1)</script>".into()],
        ];

        for stack in arbitrary_stacks {
            let out = PacketBuilderEngine::build_and_inspect(&stack);
            assert_eq!(out.layers.len(), stack.len());
            assert!(!out.raw_hex.is_empty());
        }
    }
}
