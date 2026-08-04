#![no_main]

use libfuzzer_sys::fuzz_target;
use netpulse_decode::{decode_frame, LinkType};

fuzz_target!(|data: &[u8]| {
    let _ = decode_frame(LinkType::Ethernet, data);
    let _ = decode_frame(LinkType::Loopback, data);
    let _ = decode_frame(LinkType::RawIp, data);
});
