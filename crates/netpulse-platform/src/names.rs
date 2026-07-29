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

/// Maximum number of DNS resolver cache entries parsed defensively to prevent unbounded allocation.
pub const MAX_RESOLVER_ENTRIES: usize = 10_000;

/// Normalize a hostname: trim whitespace, strip trailing dots, and convert to lowercase.
pub fn normalize_hostname(name: &str) -> String {
    let mut s = name.trim().to_lowercase();
    if s.ends_with('.') && s.len() > 1 {
        s.pop();
    }
    s
}

/// Read the OS DNS resolver cache into `(ip, name)` pairs.
///
/// Executes `%SystemRoot%\System32\ipconfig.exe /displaydns` safely without PowerShell string
/// interpolation or execution policy dependencies. Enforces a 2-second non-busy process timeout.
/// Fails soft (returns empty vector) on any missing executable, timeout, non-zero exit code, or
/// non-English localized label mismatch — an optimization overlay, never a correctness dependency.
#[cfg(windows)]
fn read_os_resolver_cache() -> Vec<(IpAddr, String)> {
    use std::path::PathBuf;
    use std::process::{Command, Stdio};
    use std::thread::sleep;
    use std::time::Duration;

    let sys_root = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    let ipconfig_path = sys_root.join("System32").join("ipconfig.exe");

    let child = Command::new(&ipconfig_path)
        .arg("/displaydns")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn();

    let mut child = match child {
        Ok(c) => c,
        Err(e) => {
            tracing::debug!(
                event = "resolver_cache.spawn_failed",
                path = %ipconfig_path.display(),
                error = %e,
                "Failed to spawn system ipconfig.exe"
            );
            return Vec::new();
        }
    };

    // Poll child status with non-busy sleep (25ms cadence, max 80 iterations = 2.0 seconds)
    let timeout = Duration::from_millis(2000);
    let poll_interval = Duration::from_millis(25);
    let start = std::time::Instant::now();
    let mut finished = false;

    while start.elapsed() < timeout {
        match child.try_wait() {
            Ok(Some(_status)) => {
                finished = true;
                break;
            }
            Ok(None) => sleep(poll_interval),
            Err(_) => break,
        }
    }

    if !finished {
        tracing::debug!(
            event = "resolver_cache.timeout",
            "ipconfig /displaydns execution exceeded 2.0s time budget; terminating child"
        );
        let _ = child.kill();
        let _ = child.wait();
        return Vec::new();
    }

    let output = match child.wait_with_output() {
        Ok(o) => o,
        Err(e) => {
            tracing::debug!(
                event = "resolver_cache.read_failed",
                error = %e,
                "Failed to read ipconfig stdout"
            );
            return Vec::new();
        }
    };

    if !output.status.success() {
        return Vec::new();
    }

    let text = String::from_utf8_lossy(&output.stdout);
    parse_displaydns_output(&text)
}

#[cfg(not(windows))]
fn read_os_resolver_cache() -> Vec<(IpAddr, String)> {
    Vec::new()
}

/// Parse Windows `ipconfig /displaydns` output into deduplicated, deterministically sorted `(ip, name)` pairs.
///
/// Supports standard `ipconfig /displaydns` blocks as well as tab-separated fallback lines.
/// Normalizes hostnames (lowercased, trailing dots stripped) and caps output at [`MAX_RESOLVER_ENTRIES`].
pub fn parse_displaydns_output(text: &str) -> Vec<(IpAddr, String)> {
    use std::collections::HashSet;

    let mut set: HashSet<(IpAddr, String)> = HashSet::new();
    let mut current_name: Option<String> = None;

    for line in text.lines() {
        if set.len() >= MAX_RESOLVER_ENTRIES {
            break;
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Support tab-separated fallback format: name<TAB>address
        if let Some((name_part, addr_part)) = trimmed.split_once('\t') {
            let name = normalize_hostname(name_part);
            if let Ok(ip) = addr_part.trim().parse::<IpAddr>() {
                if !name.is_empty() {
                    set.insert((ip, name));
                }
            }
            continue;
        }

        // Key-value pair format: Record Name . . . . . : example.com
        if let Some((key, val)) = trimmed.split_once(':') {
            let key_norm = key.trim().to_lowercase();
            let val_str = val.trim();

            if key_norm.starts_with("record name") {
                if !val_str.is_empty() {
                    current_name = Some(normalize_hostname(val_str));
                } else {
                    current_name = None;
                }
            } else if key_norm.contains("record")
                || key_norm.contains("address")
                || key_norm.contains("data")
            {
                if let Ok(ip) = val_str.parse::<IpAddr>() {
                    if let Some(ref name) = current_name {
                        if !name.is_empty() {
                            set.insert((ip, name.clone()));
                        }
                    }
                }
            }
        }
    }

    // Sort deterministically by (name, ip) for reproducible behavior
    let mut list: Vec<(IpAddr, String)> = set.into_iter().collect();
    list.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(&b.0)));
    list
}

/// Legacy alias preserved for backwards compatibility in unit tests.
#[allow(dead_code)]
fn parse_resolver_lines(text: &str) -> Vec<(IpAddr, String)> {
    parse_displaydns_output(text)
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

    #[test]
    fn test_normalize_hostname() {
        assert_eq!(normalize_hostname(" EXAMPLE.COM. "), "example.com");
        assert_eq!(normalize_hostname("nas.local."), "nas.local");
        assert_eq!(normalize_hostname("  foo.bar  "), "foo.bar");
    }

    #[test]
    fn test_parse_displaydns_output_key_value_blocks() {
        let text = "\
    Record Name . . . . . : Example.COM.\n\
    Record Type . . . . . : 1\n\
    Time To Live  . . . . : 280\n\
    Data Length . . . . . : 4\n\
    Section . . . . . . . : Answer\n\
    A (Host) Record . . . : 93.184.216.34\n\
    \n\
    Record Name . . . . . : ipv6.example.com\n\
    Record Type . . . . . : 28\n\
    AAAA Record . . . . . : 2606:4700:4700::1111\n\
";
        let got = parse_displaydns_output(text);
        assert_eq!(got.len(), 2);
        assert_eq!(
            got[0],
            (
                IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34)),
                "example.com".to_string()
            )
        );
        assert_eq!(
            got[1],
            (
                "2606:4700:4700::1111".parse().unwrap(),
                "ipv6.example.com".to_string()
            )
        );
    }

    #[test]
    fn test_deduplication_and_deterministic_sorting() {
        let text = "\
b.example.com\t10.0.0.2\n\
a.example.com\t10.0.0.1\n\
b.example.com\t10.0.0.2\n\
";
        let got = parse_displaydns_output(text);
        assert_eq!(got.len(), 2);
        assert_eq!(
            got[0],
            (
                IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1)),
                "a.example.com".to_string()
            )
        );
        assert_eq!(
            got[1],
            (
                IpAddr::V4(Ipv4Addr::new(10, 0, 0, 2)),
                "b.example.com".to_string()
            )
        );
    }
}
