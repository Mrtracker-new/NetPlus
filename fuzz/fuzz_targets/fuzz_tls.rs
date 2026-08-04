#![no_main]

use libfuzzer_sys::fuzz_target;
use netpulse_decode::tls;

fuzz_target!(|data: &[u8]| {
    let _ = tls::dissect(data);
});
