//! A strictly-bounded, zero-copy byte reader — the safety floor for every
//! dissector (docs/07 §8). Dissectors parse bytes controlled by remote parties,
//! so *no read may ever advance past the input slice*. This type makes that the
//! only possible behavior: every accessor returns [`Result`] and a short read is
//! a clean [`NpError::Decode`], never a panic or an over-read.
//!
//! It borrows the underlying slice (no allocation on the hot path, docs/07 §10)
//! and tracks a cursor. All multi-byte integers are read big-endian, the network
//! byte order used by every protocol NetPulse dissects.

use netpulse_core::{NpError, Result};

/// A cursor over a borrowed byte slice with bounds-checked reads.
#[derive(Debug, Clone)]
pub struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    /// Wrap a slice, positioned at the start.
    pub fn new(buf: &'a [u8]) -> Self {
        Self { buf, pos: 0 }
    }

    /// Bytes not yet consumed.
    pub fn remaining(&self) -> usize {
        self.buf.len() - self.pos
    }

    /// True when the cursor has reached the end of input.
    pub fn is_empty(&self) -> bool {
        self.remaining() == 0
    }

    /// Current cursor offset from the start of the original slice.
    pub fn position(&self) -> usize {
        self.pos
    }

    fn need(&self, n: usize) -> Result<()> {
        if self.remaining() < n {
            return Err(NpError::Decode(format!(
                "short read: need {n} bytes, have {} at offset {}",
                self.remaining(),
                self.pos
            )));
        }
        Ok(())
    }

    /// Read a single byte.
    pub fn u8(&mut self) -> Result<u8> {
        self.need(1)?;
        let v = self.buf[self.pos];
        self.pos += 1;
        Ok(v)
    }

    /// Read a big-endian `u16`.
    pub fn u16(&mut self) -> Result<u16> {
        self.need(2)?;
        let v = u16::from_be_bytes([self.buf[self.pos], self.buf[self.pos + 1]]);
        self.pos += 2;
        Ok(v)
    }

    /// Read a big-endian `u32`.
    pub fn u32(&mut self) -> Result<u32> {
        self.need(4)?;
        let mut b = [0u8; 4];
        b.copy_from_slice(&self.buf[self.pos..self.pos + 4]);
        self.pos += 4;
        Ok(u32::from_be_bytes(b))
    }

    /// Borrow the next `n` bytes without copying, advancing the cursor.
    pub fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        self.need(n)?;
        let s = &self.buf[self.pos..self.pos + n];
        self.pos += n;
        Ok(s)
    }

    /// Skip `n` bytes.
    pub fn skip(&mut self, n: usize) -> Result<()> {
        self.need(n)?;
        self.pos += n;
        Ok(())
    }

    /// Peek the next byte without advancing.
    pub fn peek_u8(&self) -> Result<u8> {
        self.need(1)?;
        Ok(self.buf[self.pos])
    }

    /// Borrow all remaining bytes without advancing the cursor.
    pub fn rest(&self) -> &'a [u8] {
        &self.buf[self.pos..]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_big_endian_and_advances() {
        let data = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07];
        let mut r = Reader::new(&data);
        assert_eq!(r.u8().unwrap(), 0x01);
        assert_eq!(r.u16().unwrap(), 0x0203);
        assert_eq!(r.u32().unwrap(), 0x04050607);
        assert!(r.is_empty());
    }

    #[test]
    fn short_read_is_clean_error_not_panic() {
        let data = [0xaa];
        let mut r = Reader::new(&data);
        assert!(r.u32().is_err());
        // Cursor must not have moved past the end on failure.
        assert_eq!(r.position(), 0);
        assert!(matches!(r.u16(), Err(NpError::Decode(_))));
    }

    #[test]
    fn take_borrows_exact_slice() {
        let data = [1, 2, 3, 4];
        let mut r = Reader::new(&data);
        assert_eq!(r.take(2).unwrap(), &[1, 2]);
        assert_eq!(r.remaining(), 2);
        assert!(r.take(3).is_err());
    }

    #[test]
    fn peek_does_not_advance() {
        let data = [9, 8];
        let r = Reader::new(&data);
        assert_eq!(r.peek_u8().unwrap(), 9);
        assert_eq!(r.position(), 0);
    }
}
