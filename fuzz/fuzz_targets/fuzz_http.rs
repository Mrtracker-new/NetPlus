#![no_main]

use libfuzzer_sys::fuzz_target;
use netpulse_decode::http;

fuzz_target!(|data: &[u8]| {
    let _ = http::dissect(data);
});
