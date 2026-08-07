-- Initial Capture Store Schema
-- Tier 3 durable capture metadata tables and indexes.

CREATE TABLE IF NOT EXISTS flows (
    flow_id INTEGER PRIMARY KEY NOT NULL,
    canonical_key BLOB NOT NULL,
    epoch INTEGER NOT NULL,
    l4_proto INTEGER NOT NULL,
    l7_proto INTEGER NOT NULL,
    first_ts_mono INTEGER NOT NULL,
    last_ts_wall INTEGER NOT NULL,
    bytes_up INTEGER NOT NULL,
    bytes_down INTEGER NOT NULL,
    pkts_up INTEGER NOT NULL,
    pkts_down INTEGER NOT NULL,
    rtt_us INTEGER NOT NULL,
    retransmits INTEGER NOT NULL,
    state INTEGER NOT NULL,
    process_id INTEGER,
    session_id INTEGER,
    host_id INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
    session_id INTEGER PRIMARY KEY NOT NULL,
    process_id INTEGER,
    start_ts INTEGER NOT NULL,
    trigger TEXT NOT NULL,
    causal_graph BLOB
);

CREATE TABLE IF NOT EXISTS proto_events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    flow_id INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    kind INTEGER NOT NULL,
    fields TEXT NOT NULL,
    packet_ref INTEGER,
    FOREIGN KEY (flow_id) REFERENCES flows (flow_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS findings (
    finding_id INTEGER PRIMARY KEY NOT NULL,
    category INTEGER NOT NULL,
    confidence REAL NOT NULL,
    session_id INTEGER,
    evidence_refs TEXT NOT NULL,
    evidence_expired INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES sessions (session_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS hosts (
    host_id INTEGER PRIMARY KEY NOT NULL,
    ip TEXT NOT NULL,
    rdns TEXT,
    asn_org TEXT,
    cdn TEXT,
    geo TEXT
);

CREATE TABLE IF NOT EXISTS host_resolutions (
    ip TEXT NOT NULL,
    name TEXT NOT NULL,
    source TEXT NOT NULL,
    PRIMARY KEY (ip, name, source)
);

CREATE INDEX IF NOT EXISTS idx_flows_session_id ON flows(session_id);
CREATE INDEX IF NOT EXISTS idx_flows_first_ts ON flows(first_ts_mono);
CREATE INDEX IF NOT EXISTS idx_proto_events_flow_id ON proto_events(flow_id);
CREATE INDEX IF NOT EXISTS idx_findings_session_id ON findings(session_id);
CREATE INDEX IF NOT EXISTS idx_hosts_ip ON hosts(ip);
CREATE INDEX IF NOT EXISTS idx_host_resolutions_ip_name ON host_resolutions(ip, name);
