//! Tier 1 — the in-memory ring buffer. A fixed-capacity circular
//! buffer of the most recent items (raw frames, freshly-decoded packets). The
//! live pipeline and "last few seconds" UI need zero-latency access to the
//! newest data; fixed capacity guarantees a hard memory ceiling (N5) — the
//! oldest entries are overwritten, never grown past the bound.

use std::collections::VecDeque;

/// A bounded FIFO that overwrites its oldest element when full. Pushing is O(1)
/// and never allocates past `capacity`.
#[derive(Debug, Clone)]
pub struct RingBuffer<T> {
    items: VecDeque<T>,
    capacity: usize,
    /// Total items ever pushed, including those overwritten — so callers can see
    /// how many were dropped from the live window (honesty .
    total_pushed: u64,
    overwritten: u64,
}

impl<T> RingBuffer<T> {
    /// Create a ring holding at most `capacity` items (min 1).
    pub fn new(capacity: usize) -> Self {
        let capacity = capacity.max(1);
        Self {
            items: VecDeque::with_capacity(capacity),
            capacity,
            total_pushed: 0,
            overwritten: 0,
        }
    }

    /// Push an item, evicting (and returning) the oldest if the ring is full.
    pub fn push(&mut self, item: T) -> Option<T> {
        self.total_pushed += 1;
        let evicted = if self.items.len() == self.capacity {
            self.overwritten += 1;
            self.items.pop_front()
        } else {
            None
        };
        self.items.push_back(item);
        evicted
    }

    /// Items currently retained, oldest first.
    pub fn iter(&self) -> impl Iterator<Item = &T> {
        self.items.iter()
    }

    /// The most recent `n` items, oldest first.
    pub fn recent(&self, n: usize) -> impl Iterator<Item = &T> {
        let skip = self.items.len().saturating_sub(n);
        self.items.iter().skip(skip)
    }

    /// Number of items currently retained.
    pub fn len(&self) -> usize {
        self.items.len()
    }

    /// Whether the ring is empty.
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    /// Maximum items the ring will hold.
    pub fn capacity(&self) -> usize {
        self.capacity
    }

    /// How many items have been overwritten (fell out of the live window).
    pub fn overwritten(&self) -> u64 {
        self.overwritten
    }

    /// Total items ever pushed.
    pub fn total_pushed(&self) -> u64 {
        self.total_pushed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overwrites_oldest_when_full() {
        let mut r = RingBuffer::new(3);
        assert_eq!(r.push(1), None);
        assert_eq!(r.push(2), None);
        assert_eq!(r.push(3), None);
        assert_eq!(r.push(4), Some(1)); // evicts oldest
        assert_eq!(r.len(), 3);
        assert_eq!(r.iter().copied().collect::<Vec<_>>(), vec![2, 3, 4]);
    }

    #[test]
    fn tracks_overwrite_count_for_honesty() {
        let mut r = RingBuffer::new(2);
        for i in 0..5 {
            r.push(i);
        }
        assert_eq!(r.total_pushed(), 5);
        assert_eq!(r.overwritten(), 3);
    }

    #[test]
    fn recent_returns_tail() {
        let mut r = RingBuffer::new(10);
        for i in 0..5 {
            r.push(i);
        }
        assert_eq!(r.recent(2).copied().collect::<Vec<_>>(), vec![3, 4]);
    }

    #[test]
    fn zero_capacity_is_clamped_to_one() {
        let mut r = RingBuffer::new(0);
        assert_eq!(r.capacity(), 1);
        r.push("a");
        r.push("b");
        assert_eq!(r.len(), 1);
    }
}
