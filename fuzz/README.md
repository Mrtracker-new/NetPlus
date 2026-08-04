# Protocol Dissector Fuzz Targets (`fuzz/`)

`cargo-fuzz` target binaries and committed seed corpora for `netpulse-decode` protocol dissectors.

---

## Security Rationale

`netpulse-decode` processes untrusted, raw network packets from hostile remote networks. To guarantee zero panics, zero infinite loops, and zero memory corruption under bad input, every protocol parser layer is fuzzed in isolation with `libFuzzer`.

---

## Available Fuzz Targets

1. **`fuzz_decode_frame`**: Top-level end-to-end decode pipeline (`decode_frame`) over `Ethernet`, `Loopback`, and `RawIp` link types.
2. **`fuzz_ethernet`**: Ethernet II framing & 802.1Q / 802.1ad (VLAN / QinQ) tag stripping.
3. **`fuzz_ipv4`**: IPv4 header parsing, options skipping, and total length clamping.
4. **`fuzz_ipv6`**: IPv6 header parsing and extension header chain traversal (Hop-by-Hop, Routing, Fragment, Destination Options).
5. **`fuzz_tcp`**: TCP header parsing, data offset validation, flags, and options handling.
6. **`fuzz_udp`**: UDP header parsing and length boundary clamping.
7. **`fuzz_dns`**: DNS query/response parsing, RDATA parsing, compression pointer loops, label caps, and MAX_POINTER_JUMPS verification.
8. **`fuzz_http`**: HTTP/1.x cleartext request line, status code parsing, host header extraction, folded/malformed header handling.
9. **`fuzz_tls`**: TLS record layer, ClientHello / ServerHello, SNI, ALPN, GREASE values, and extension loop bounds.

---

## Running Fuzzers

```sh
# Install cargo-fuzz (once):
cargo install cargo-fuzz

# Run a specific target with production libFuzzer flags:
cargo fuzz run fuzz_dns -- -max_len=4096 -timeout=5 -rss_limit_mb=4096

# Run with AddressSanitizer or UndefinedBehaviorSanitizer:
cargo fuzz run fuzz_tcp --sanitizer=address
cargo fuzz run fuzz_http --sanitizer=undefined
```

---

## Corpus & Crash Reproducers

- **Seed Corpora**: Committed under `fuzz/corpus/<target_name>/`. `cargo-fuzz` automatically uses these as initial fuzzing seeds.
- **Crash Artifacts**: Saved to `fuzz/artifacts/<target_name>/` (gitignored). When a crash is found, minimize it using `cargo fuzz tmin <target_name> <crash_file>`, move it into `fuzz/corpus/<target_name>/`, and commit it to ensure permanent regression coverage.

---

## Coverage Analysis

To inspect statement and branch coverage achieved by the corpus:

```sh
cargo fuzz coverage fuzz_dns
```

---

## In-Tree CI Test Replay

Standard `cargo test -p netpulse-decode` runs `tests/fuzz_regression.rs`, which automatically replays every seed file in `fuzz/corpus/` and runs deterministic PRNG boundary fuzzing across packet sizes `[0, 1, 2, 3..1499, 1500, 4096, 65535]`.
