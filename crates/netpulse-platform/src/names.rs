//! Host-environment name hints (docs/08 §5.1, docs/02 §10.3): recovering names
//! for IPs from *local machine state* to complement the engine's wire-only
//! resolution (DNS answers + TLS SNI). Two local sources, both read-only and
//! egress-free:
//!
//! - **The `hosts` file** — static, admin-configured `IP name` lines. Portable,
//!   parsed with `std` only, so it works on every OS and in every build.
//! - **The OS DNS resolver cache** (Windows: the DNS Client cache) — the entries
//!   the system already resolved, including lookups that happened *before* capture
//!   started (the common reason a public IP shows no on-wire name) and any mDNS
//!   `.local` names the resolver has cached. It is read from OS state, never by
//!   issuing a query, so it introduces no network egress (docs/02 §10.3).
//!
//! This lives in `netpulse-platform` because it reads host-specific OS state, and
//! it is deliberately kept *out* of the engine pipeline: these names depend on the
//! machine NetPulse runs on, not on the captured bytes, so folding them into the
//! deterministic reconstruction would break live-vs-replay parity (docs/21 §10).
//! The shell applies them as an overlay via
//! [`CaptureStore::merge_resolution`](netpulse_storage) after each rebuild.
//!
//! Everything here fails *soft*: any source that is unavailable, unreadable, or
//! unparsable yields no hints rather than an error — a missing name is honest, a
//! fabricated one is not (docs/02 §11).

use std::collections::BTreeMap;
use std::net::IpAddr;

use netpulse_core::{HostName, NameSource};

/// Collect host-environment name hints as a deterministic `IP → names` map.
///
/// Merges the hosts file and the OS resolver cache. Ordering is stable (IPs
/// ascending via [`BTreeMap`]) so repeated calls over unchanged OS state produce
/// an identical overlay. Never returns an error: unavailable sources contribute
/// nothing.
pub fn host_name_hints() -> BTreeMap<IpAddr, Vec<HostName>> {
    let mut out: BTreeMap<IpAddr, Vec<HostName>> = BTreeMap::new();

    for (ip, name) in read_hosts_file() {
        push_unique(&mut out, ip, name, NameSource::HostsFile);
    }
    for (ip, name) in read_os_resolver_cache() {
        push_unique(&mut out, ip, name, NameSource::OsResolver);
    }

    out
}

/// Insert `(ip, name, source)` unless that exact pair is already present.
fn push_unique(
    map: &mut BTreeMap<IpAddr, Vec<HostName>>,
    ip: IpAddr,
    name: String,
    source: NameSource,
) {
    if name.is_empty() {
        return;
    }
    let entry = map.entry(ip).or_default();
    if !entry.iter().any(|h| h.name == name && h.source == source) {
        entry.push(HostName { name, source });
    }
}

/// The platform `hosts` file path. Windows keeps it under the system root
/// (honoring `SystemRoot`); Unix-likes use `/etc/hosts`.
fn hosts_path() -> std::path::PathBuf {
    #[cfg(windows)]
    {
        let root = std::env::var_os("SystemRoot")
            .unwrap_or_else(|| std::ffi::OsString::from(r"C:\Windows"));
        std::path::Path::new(&root).join(r"System32\drivers\etc\hosts")
    }
    #[cfg(not(windows))]
    {
        std::path::PathBuf::from("/etc/hosts")
    }
}

/// Parse the hosts file into `(ip, name)` pairs. Each non-comment line is
/// `IP canonical [alias...]`; every hostname token on the line maps to the IP.
/// Unparsable IPs and blank/comment lines are skipped. Read failure → no hints.
fn read_hosts_file() -> Vec<(IpAddr, String)> {
    let Ok(text) = std::fs::read_to_string(hosts_path()) else {
        return Vec::new();
    };
    parse_hosts(&text)
}

/// Pure parser for hosts-file text, split out so it is unit-testable without
/// touching the filesystem.
fn parse_hosts(text: &str) -> Vec<(IpAddr, String)> {
    let mut out = Vec::new();
    for line in text.lines() {
        // Strip inline comments and surrounding whitespace.
        let line = line.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        let mut tokens = line.split_whitespace();
        let Some(ip_tok) = tokens.next() else {
            continue;
        };
        let Ok(ip) = ip_tok.parse::<IpAddr>() else {
            continue;
        };
        for name in tokens {
            out.push((ip, name.to_string()));
        }
    }
    out
}

/// Read the OS DNS resolver cache into `(ip, name)` pairs. Windows-only for now
/// (PowerShell's `Get-DnsClientCache`); other platforms return nothing until a
/// native reader is added — an empty overlay, never a fabricated one.
#[cfg(windows)]
fn read_os_resolver_cache() -> Vec<(IpAddr, String)> {
    use std::process::Command;

    // Emit CSV of (name, resolved-data) directly, avoiding locale-dependent table
    // formatting. `Data` holds the resolved address for A/AAAA records; `Name` is
    // the queried hostname. `-Type` filters to address records so we skip PTR/SOA
    // noise. Failure to spawn or non-UTF8 output → no hints.
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-DnsClientCache | Where-Object {$_.Type -eq 'A' -or $_.Type -eq 'AAAA'} \
             | ForEach-Object { \"$($_.Name)`t$($_.Data)\" }",
        ])
        .output();
    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    let Ok(text) = String::from_utf8(output.stdout) else {
        return Vec::new();
    };
    parse_resolver_lines(&text)
}

#[cfg(not(windows))]
fn read_os_resolver_cache() -> Vec<(IpAddr, String)> {
    // No portable resolver-cache reader on Unix (nscd/systemd-resolved caches are
    // not reliably introspectable without egress); contribute nothing.
    Vec::new()
}

/// Parse tab-separated `name<TAB>address` lines (the shape the Windows reader
/// emits) into `(ip, name)` pairs. Split out for testability. A `.local` name is
/// kept like any other — cached mDNS results are legitimate local hints.
#[cfg_attr(not(windows), allow(dead_code))]
fn parse_resolver_lines(text: &str) -> Vec<(IpAddr, String)> {
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split('\t');
        let (Some(name), Some(addr)) = (parts.next(), parts.next()) else {
            continue;
        };
        let name = name.trim();
        let Ok(ip) = addr.trim().parse::<IpAddr>() else {
            continue;
        };
        if !name.is_empty() {
            out.push((ip, name.to_string()));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, Ipv6Addr};

    #[test]
    fn parses_hosts_lines_with_aliases_and_comments() {
        let text = "\
# a comment\n\
127.0.0.1   localhost   local.dev  # trailing comment\n\
   \n\
192.168.1.10  printer.lan\n\
notanip  bogus\n\
::1  ip6-localhost\n";
        let got = parse_hosts(text);
        assert!(got.contains(&(IpAddr::V4(Ipv4Addr::LOCALHOST), "localhost".to_string())));
        assert!(got.contains(&(IpAddr::V4(Ipv4Addr::LOCALHOST), "local.dev".to_string())));
        assert!(got.contains(&(
            IpAddr::V4(Ipv4Addr::new(192, 168, 1, 10)),
            "printer.lan".to_string()
        )));
        assert!(got.contains(&(IpAddr::V6(Ipv6Addr::LOCALHOST), "ip6-localhost".to_string())));
        // The unparsable-IP line is dropped, not guessed.
        assert!(!got.iter().any(|(_, n)| n == "bogus"));
    }

    #[test]
    fn parses_resolver_tab_lines_including_mdns() {
        let text = "\
example.com\t93.184.216.34\n\
nas.local\t192.168.1.50\n\
malformed-line-no-tab\n\
bad.example\tnot-an-ip\n";
        let got = parse_resolver_lines(text);
        assert!(got.contains(&(
            IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34)),
            "example.com".to_string()
        )));
        // A cached mDNS `.local` name is a legitimate hint.
        assert!(got.contains(&(
            IpAddr::V4(Ipv4Addr::new(192, 168, 1, 50)),
            "nas.local".to_string()
        )));
        assert_eq!(got.len(), 2, "malformed lines dropped");
    }

    #[test]
    fn hints_are_tagged_with_their_source() {
        let mut map: BTreeMap<IpAddr, Vec<HostName>> = BTreeMap::new();
        let ip = IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1));
        push_unique(&mut map, ip, "a.lan".into(), NameSource::HostsFile);
        push_unique(&mut map, ip, "a.lan".into(), NameSource::HostsFile); // dup
        push_unique(&mut map, ip, "a.example".into(), NameSource::OsResolver);
        let names = &map[&ip];
        assert_eq!(names.len(), 2);
        assert!(names
            .iter()
            .any(|h| h.name == "a.lan" && h.source == NameSource::HostsFile));
        assert!(names
            .iter()
            .any(|h| h.name == "a.example" && h.source == NameSource::OsResolver));
    }
}
