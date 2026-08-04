#![no_main]

use libfuzzer_sys::fuzz_target;
use netpulse_decode::layers::ipv4;
use netpulse_decode::Reader;

fuzz_target!(|data: &[u8]| {
    let mut r = Reader::new(data);
    let _ = ipv4(&mut r);
});
