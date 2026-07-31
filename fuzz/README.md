# Protocol Dissector Fuzz Targets (`fuzz/`)

`cargo-fuzz` targets for protocol dissectors in `netpulse-decode` and hostile packet parsers.

---

## Security Rationale

`netpulse-decode` processes untrusted network bytes sent by remote endpoints. To prevent memory safety bugs, panics, and infinite loops, every protocol dissector has a dedicated fuzz target.

## Running Fuzzers

```sh
# Install cargo-fuzz (once):
cargo install cargo-fuzz

# Run fuzz target for DNS dissector:
cargo fuzz run fuzz_dns

# Run fuzz target for HTTP dissector:
cargo fuzz run fuzz_http
```
