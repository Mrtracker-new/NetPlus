#![no_main]

use libfuzzer_sys::fuzz_target;
use netpulse_decode::layers::ipv6;
use netpulse_decode::Reader;

fuzz_target!(|data: &[u8]| {
    let mut r = Reader::new(data);
    let _ = ipv6(&mut r);
});
