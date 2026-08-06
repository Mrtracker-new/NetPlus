//! Tier 2 — the time-series metrics store. Compact numeric
//! series (bytes, packets, RTT, connection counts) at regular intervals, queried
//! as *aggregates over time* by dashboards and the timeline — not as individual
//! packets. A purpose-built layout makes "throughput of X over the last hour"
//! cheap.
//!
//! Older data is progressively **downsampled**: recent points at
//! fine resolution, older ones coarsened — the standard TSDB rollup that keeps
//! long histories small. This module implements the raw→coarse rollup and
//! range-scan query; the multi-level cascade (minute→hour→day) is the same
//! operation applied repeatedly.

use std::collections::BTreeMap;

/// Identifies one metric series: the dimension being measured,
/// e.g. "bytes_down for process 42". A small interned integer on the hot path.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct SeriesId(pub u32);

/// One time-bucketed value. Timestamps are monotonic-ns bucket starts so range
/// scans prune by time.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Point {
    pub bucket_start: u64,
    pub value: f64,
}

/// A single series stored as ordered buckets. Appends accumulate into the
/// current bucket; a new bucket opens when time crosses a resolution boundary.
#[derive(Debug, Clone)]
struct Series {
    resolution_nanos: u64,
    buckets: BTreeMap<u64, f64>,
}

impl Series {
    fn bucket_of(&self, ts: u64) -> u64 {
        ts - (ts % self.resolution_nanos)
    }

    fn add(&mut self, ts: u64, value: f64) {
        let b = self.bucket_of(ts);
        *self.buckets.entry(b).or_insert(0.0) += value;
    }
}

/// The time-series store: many series at a base resolution, with rollup support.
#[derive(Debug)]
pub struct TimeSeriesStore {
    base_resolution_nanos: u64,
    series: BTreeMap<SeriesId, Series>,
}

impl TimeSeriesStore {
    /// Create a store whose finest resolution is `base_resolution_nanos`
    /// (e.g. 1s). Older data is later rolled up to coarser resolutions.
    pub fn new(base_resolution_nanos: u64) -> Self {
        Self {
            base_resolution_nanos: base_resolution_nanos.max(1),
            series: BTreeMap::new(),
        }
    }

    /// Record `value` into `series` at monotonic time `ts`, summing within the
    /// bucket.
    pub fn record(&mut self, series: SeriesId, ts: u64, value: f64) {
        let base = self.base_resolution_nanos;
        self.series
            .entry(series)
            .or_insert_with(|| Series {
                resolution_nanos: base,
                buckets: BTreeMap::new(),
            })
            .add(ts, value);
    }

    /// Range scan: all points of `series` with bucket start in `[from, to)`,
    /// ordered by time.
    pub fn query(&self, series: SeriesId, from: u64, to: u64) -> Vec<Point> {
        match self.series.get(&series) {
            Some(s) => s
                .buckets
                .range(from..to)
                .map(|(&bucket_start, &value)| Point {
                    bucket_start,
                    value,
                })
                .collect(),
            None => Vec::new(),
        }
    }

    /// Sum of a series over `[from, to)` — the common dashboard aggregate.
    pub fn sum(&self, series: SeriesId, from: u64, to: u64) -> f64 {
        self.query(series, from, to).iter().map(|p| p.value).sum()
    }

    /// Downsample `series` into `factor`-times-coarser buckets, collapsing older
    /// fine points. Points at or after `keep_fine_from` are left
    /// at base resolution; older ones are merged. Returns the number of buckets
    /// removed, so the caller can log the size reduction.
    pub fn downsample(&mut self, series: SeriesId, factor: u64, keep_fine_from: u64) -> usize {
        let base = self.base_resolution_nanos;
        let Some(s) = self.series.get_mut(&series) else {
            return 0;
        };
        let coarse_res = base * factor.max(1);
        let before = s.buckets.len();
        let mut coarsened: BTreeMap<u64, f64> = BTreeMap::new();
        let mut kept: BTreeMap<u64, f64> = BTreeMap::new();
        for (&bucket, &value) in &s.buckets {
            if bucket >= keep_fine_from {
                kept.insert(bucket, value);
            } else {
                let cb = bucket - (bucket % coarse_res);
                *coarsened.entry(cb).or_insert(0.0) += value;
            }
        }
        coarsened.extend(kept);
        s.buckets = coarsened;
        before.saturating_sub(s.buckets.len())
    }

    /// Number of series held.
    pub fn series_count(&self) -> usize {
        self.series.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const S: SeriesId = SeriesId(1);

    #[test]
    fn accumulates_within_bucket() {
        let mut ts = TimeSeriesStore::new(1000);
        ts.record(S, 100, 5.0);
        ts.record(S, 200, 7.0); // same 1000-ns bucket [0,1000)
        ts.record(S, 1100, 3.0); // next bucket [1000,2000)
        let pts = ts.query(S, 0, 10_000);
        assert_eq!(pts.len(), 2);
        assert_eq!(
            pts[0],
            Point {
                bucket_start: 0,
                value: 12.0
            }
        );
        assert_eq!(
            pts[1],
            Point {
                bucket_start: 1000,
                value: 3.0
            }
        );
    }

    #[test]
    fn range_query_prunes_by_time() {
        let mut ts = TimeSeriesStore::new(1000);
        for t in [0u64, 1000, 2000, 3000] {
            ts.record(S, t, 1.0);
        }
        assert_eq!(ts.query(S, 1000, 3000).len(), 2); // [1000,3000)
        assert_eq!(ts.sum(S, 0, 4000), 4.0);
    }

    #[test]
    fn downsampling_coarsens_old_and_keeps_recent() {
        let mut ts = TimeSeriesStore::new(1000);
        // buckets at 0,1000,2000,3000 each value 1
        for t in [0u64, 1000, 2000, 3000] {
            ts.record(S, t, 1.0);
        }
        // Coarsen everything before t=3000 into 4x buckets (4000-ns).
        let removed = ts.downsample(S, 4, 3000);
        let pts = ts.query(S, 0, 10_000);
        // 0,1000,2000 collapse into one 4000-ns bucket at 0 (sum 3); 3000 kept.
        assert_eq!(pts.len(), 2);
        assert_eq!(
            pts[0],
            Point {
                bucket_start: 0,
                value: 3.0
            }
        );
        assert_eq!(
            pts[1],
            Point {
                bucket_start: 3000,
                value: 1.0
            }
        );
        assert_eq!(removed, 2);
    }
}
