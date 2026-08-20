//! The education content model — authored as **data**,
//! not code. A technical writer can add a module, lesson, step, or exercise
//! without touching the engine, exactly as the explanation-key content is
//! authorable in. The engine (`super::engine`) *selects* this
//! content when the user's real traffic warrants it; it never invents it.
//!
//! Every step is wired to an [`ExplanationKey`]: the same
//! identifier the dissectors emit, the explorer browses, and the animations
//! key off — one vocabulary unifies the whole education system.
//! That wiring is what keeps a lesson from ever drifting from the engine's
//! reality: a lesson about the handshake cites `tcp.flags.syn`, and the value
//! it shows is pulled from the learner's captured packet, not a textbook.

use netpulse_decode::ExplanationKey;
use serde::{Deserialize, Serialize};

/// A learner-progression level. Mirrors [`netpulse_core::Depth`]
/// so a lesson's level and the UI's disclosure mode speak the same ladder — a
/// Beginner-mode learner is offered Beginner lessons first.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default, Hash, Serialize, Deserialize,
)]
#[non_exhaustive]
pub enum Level {
    #[default]
    Beginner,
    Intermediate,
    Expert,
}

impl Level {
    /// Map to the equivalent core disclosure depth, so content authored for a
    /// level renders at the matching mode.
    pub fn as_depth(self) -> netpulse_core::Depth {
        match self {
            Level::Beginner => netpulse_core::Depth::Beginner,
            Level::Intermediate => netpulse_core::Depth::Intermediate,
            Level::Expert => netpulse_core::Depth::Expert,
        }
    }
}

/// What real-traffic moment can launch a lesson *grounded* in the learner's own
/// data. The engine watches the event stream for these and offers
/// the matching lesson citing the real evidence. A lesson
/// with [`Trigger::None`] is always available but never *grounded* on its own —
/// it falls back to a curated example.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub enum Trigger {
    /// A DNS query/response was observed — "how your computer found the address".
    DnsLookup,
    /// A TCP three-way handshake — "how a connection is established".
    TcpHandshake,
    /// A TLS handshake — "how your connection got encrypted".
    TlsHandshake,
    /// An HTTP request/response — "how your browser asked for the page".
    HttpExchange,
    /// A retransmission / loss burst — "what packet loss is and why it slows things".
    LossBurst,
    /// A fan-out across many hosts — "why one website talks to many servers".
    FanOut,
    /// A full page-load session — the flagship journey.
    PageLoad,
    /// No live trigger; conceptual lesson, curated-example grounded.
    None,
}

/// A reference to an animation embedded in a step. It is only the
/// *identifier*; the animation model itself is built from real events by
/// [`super::anim`], keyed the same way so lesson and animation stay in sync.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub enum AnimationRef {
    TcpHandshake,
    TlsHandshake,
    Multiplexing,
    FanOut,
    Degradation,
}

/// A comprehension-check kind. Grounded checks operate on the
/// learner's *own* captured evidence, which only NetPulse can generate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[non_exhaustive]
pub enum ExerciseKind {
    /// Find/point to a field or packet in real data ("point to the SYN").
    Identify,
    /// Choose the correct plain-language description.
    ExplainBack,
    /// Predict what happens next ("what follows this SYN?").
    Predict,
    /// Given a real slow session, identify the likely cause.
    Diagnose,
}

/// One selectable option for an interactive exercise.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExerciseChoice {
    pub id: &'static str,
    pub text: &'static str,
    pub is_correct: bool,
    pub feedback: &'static str,
}

/// One comprehension check within a lesson. `answer_key` names the
/// explanation key whose real value in the learner's capture is the correct
/// answer, so the engine can *derive* the answer from the fixture rather than
/// hard-coding it.
#[derive(Debug, Clone, PartialEq)]
pub struct Exercise {
    pub id: &'static str,
    pub kind: ExerciseKind,
    pub prompt: &'static str,
    /// The key whose observed value is the correct answer (for grounded checks).
    pub answer_key: Option<ExplanationKey>,
    /// Selectable multiple-choice options with deterministic evaluation.
    pub choices: &'static [ExerciseChoice],
    /// Explanatory technical feedback shown upon answer submission.
    pub explanation: &'static str,
}

/// One unit of explanation within a lesson. It carries no prose of
/// its own: `body_key` addresses the [`netpulse_decode::explain`] content store,
/// so the same authored text serves the lesson, the explorer, and the tooltip —
/// no duplication, no drift.
#[derive(Debug, Clone, PartialEq)]
pub struct Step {
    pub id: &'static str,
    /// The explanation-key providing this step's layered content.
    pub body_key: ExplanationKey,
    /// Optional animation to embed, driven by the learner's real data.
    pub anim: Option<AnimationRef>,
}

/// A single teachable concept. Its `trigger` says what real-traffic
/// moment can ground it; its steps reference explanation keys; its exercises
/// check understanding on the learner's own data.
#[derive(Debug, Clone, PartialEq)]
pub struct Lesson {
    pub id: &'static str,
    pub title: &'static str,
    pub level: Level,
    pub trigger: Trigger,
    /// Prerequisite lesson IDs that should be mastered before taking this lesson.
    pub prerequisites: &'static [&'static str],
    /// Clear, concise learning objectives.
    pub objectives: &'static [&'static str],
    /// Related explanation keys for deeper protocol exploration.
    pub related_concepts: &'static [&'static str],
    pub steps: &'static [Step],
    pub exercises: &'static [Exercise],
}

/// A themed group of lessons — the unit of the curriculum map.
#[derive(Debug, Clone, PartialEq)]
pub struct Module {
    pub id: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    pub level: Level,
    pub lessons: &'static [Lesson],
}

/// The outcome of validating a user's choice for an exercise.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExerciseValidationResult {
    pub is_correct: bool,
    pub feedback: String,
    pub explanation: String,
    pub correct_choice_index: usize,
}

// ---- Authored Curriculum Steps & Exercises -------------------

const OVERVIEW_STEPS: &[Step] = &[
    Step {
        id: "eth.layer",
        body_key: ExplanationKey("eth.addr"),
        anim: None,
    },
    Step {
        id: "ip.layer",
        body_key: ExplanationKey("ip.addr"),
        anim: None,
    },
    Step {
        id: "tcp.port.layer",
        body_key: ExplanationKey("tcp.port"),
        anim: None,
    },
];

const OVERVIEW_CHOICES: &[ExerciseChoice] = &[
    ExerciseChoice {
        id: "ov.c1",
        text: "Ethernet MAC addresses route packets across the global Internet.",
        is_correct: false,
        feedback: "MAC addresses operate only on the local link; IP addresses route across networks.",
    },
    ExerciseChoice {
        id: "ov.c2",
        text: "IP addresses route across networks, while transport ports identify specific application sockets.",
        is_correct: true,
        feedback: "Correct! IP provides host-to-host addressing (L3) while ports multiplex conversations (L4).",
    },
    ExerciseChoice {
        id: "ov.c3",
        text: "Port numbers are 32-bit addresses assigned by Internet Service Providers.",
        is_correct: false,
        feedback: "Ports are 16-bit integers (0-65535) used locally on each host.",
    },
];

const OVERVIEW_EXERCISES: &[Exercise] = &[Exercise {
    id: "overview.layers",
    kind: ExerciseKind::ExplainBack,
    prompt: "How do IP addresses and port numbers divide network responsibilities?",
    answer_key: Some(ExplanationKey("ip.addr")),
    choices: OVERVIEW_CHOICES,
    explanation: "Layer 3 (IP) delivers packets from source host to destination host across routers. Layer 4 (TCP/UDP ports) directs packets to the correct application process on that host.",
}];

const DNS_STEPS: &[Step] = &[
    Step {
        id: "dns.what",
        body_key: ExplanationKey("dns.query"),
        anim: None,
    },
    Step {
        id: "dns.response",
        body_key: ExplanationKey("dns.response"),
        anim: None,
    },
];

const DNS_CHOICES: &[ExerciseChoice] = &[
    ExerciseChoice {
        id: "dns.c1",
        text: "It translates a human-readable hostname into an IP address that routers can deliver packets to.",
        is_correct: true,
        feedback: "Correct! DNS acts as the Internet phonebook, resolving names like example.com to IP addresses.",
    },
    ExerciseChoice {
        id: "dns.c2",
        text: "It encrypts application payloads using SSL/TLS before transmission.",
        is_correct: false,
        feedback: "Encryption is handled by TLS, not standard DNS resolution.",
    },
    ExerciseChoice {
        id: "dns.c3",
        text: "It establishes the three-way TCP sequence numbers between client and server.",
        is_correct: false,
        feedback: "Connection handshake is performed by TCP after DNS resolution completes.",
    },
];

const DNS_EXERCISES: &[Exercise] = &[Exercise {
    id: "dns.identify",
    kind: ExerciseKind::Identify,
    prompt: "What is the primary role of a DNS query before connecting to a website?",
    answer_key: Some(ExplanationKey("dns.query")),
    choices: DNS_CHOICES,
    explanation: "When you enter a URL, your browser sends a DNS query over UDP port 53 (or DoH/DoT) to discover the IP address corresponding to the domain name.",
}];

const HANDSHAKE_STEPS: &[Step] = &[
    Step {
        id: "tcp.syn",
        body_key: ExplanationKey("tcp.flags.syn"),
        anim: Some(AnimationRef::TcpHandshake),
    },
    Step {
        id: "tcp.ack",
        body_key: ExplanationKey("tcp.flags.ack"),
        anim: Some(AnimationRef::TcpHandshake),
    },
];

const HANDSHAKE_SYN_CHOICES: &[ExerciseChoice] = &[
    ExerciseChoice {
        id: "tcp.c1",
        text: "SYN (Synchronize Sequence Numbers)",
        is_correct: true,
        feedback: "Correct! The client sends a packet with the SYN flag set to propose an initial sequence number (ISN).",
    },
    ExerciseChoice {
        id: "tcp.c2",
        text: "ACK (Acknowledgment)",
        is_correct: false,
        feedback: "ACK alone cannot start a connection without an initial SYN.",
    },
    ExerciseChoice {
        id: "tcp.c3",
        text: "FIN (Finish)",
        is_correct: false,
        feedback: "FIN terminates an established connection.",
    },
];

const HANDSHAKE_PREDICT_CHOICES: &[ExerciseChoice] = &[
    ExerciseChoice {
        id: "tcp.p1",
        text: "SYN-ACK: The server acknowledges the client's SYN and sends its own initial sequence number.",
        is_correct: true,
        feedback: "Spot on! The server responds with SYN-ACK, completing the second leg of the 3-way handshake in exactly 1 RTT.",
    },
    ExerciseChoice {
        id: "tcp.p2",
        text: "An immediate HTTP 200 OK response containing the website HTML.",
        is_correct: false,
        feedback: "Application data cannot be transmitted until the transport connection is fully established.",
    },
    ExerciseChoice {
        id: "tcp.p3",
        text: "A RST packet closing the socket.",
        is_correct: false,
        feedback: "RST indicates connection refusal, not successful handshake.",
    },
];

const HANDSHAKE_EXERCISES: &[Exercise] = &[
    Exercise {
        id: "tcp.identify.syn",
        kind: ExerciseKind::Identify,
        prompt: "Which packet control flag initiates a new TCP connection?",
        answer_key: Some(ExplanationKey("tcp.flags.syn")),
        choices: HANDSHAKE_SYN_CHOICES,
        explanation: "RFC 9293 §3.1 defines the 3-way handshake: Client sends SYN -> Server returns SYN-ACK -> Client replies ACK.",
    },
    Exercise {
        id: "tcp.predict",
        kind: ExerciseKind::Predict,
        prompt: "After the client transmits a SYN, what packet does the server return?",
        answer_key: Some(ExplanationKey("tcp.flags.ack")),
        choices: HANDSHAKE_PREDICT_CHOICES,
        explanation: "The server responds with SYN-ACK. Upon receiving it, the client sends a final ACK and the socket moves to the ESTABLISHED state.",
    },
];

const TLS_STEPS: &[Step] = &[
    Step {
        id: "tls.hello",
        body_key: ExplanationKey("tls.handshake.client_hello"),
        anim: Some(AnimationRef::TlsHandshake),
    },
    Step {
        id: "tls.server_hello",
        body_key: ExplanationKey("tls.handshake.server_hello"),
        anim: Some(AnimationRef::TlsHandshake),
    },
    Step {
        id: "tls.sni",
        body_key: ExplanationKey("tls.sni"),
        anim: None,
    },
];

const TLS_CHOICES: &[ExerciseChoice] = &[
    ExerciseChoice {
        id: "tls.c1",
        text: "Proposed cipher suites, supported TLS versions, cryptographic key exchange parameters, and Server Name Indication (SNI).",
        is_correct: true,
        feedback: "Correct! The ClientHello offers supported cryptographic capabilities so the server can select the highest mutually supported parameters.",
    },
    ExerciseChoice {
        id: "tls.c2",
        text: "The user's encrypted passwords and cookies in plaintext format.",
        is_correct: false,
        feedback: "Application data and credentials are never sent until the cryptographic session keys are established.",
    },
    ExerciseChoice {
        id: "tls.c3",
        text: "A request to bypass certificate verification.",
        is_correct: false,
        feedback: "TLS mandates certificate exchange and signature verification against trust anchors.",
    },
];

const TLS_EXERCISES: &[Exercise] = &[Exercise {
    id: "tls.explain",
    kind: ExerciseKind::ExplainBack,
    prompt: "What information does the TLS ClientHello message propose to the server?",
    answer_key: Some(ExplanationKey("tls.handshake.client_hello")),
    choices: TLS_CHOICES,
    explanation: "Under TLS 1.3 (RFC 8446), the ClientHello proposes cipher suites and key share parameters, enabling a full cryptographic handshake in just 1 RTT.",
}];

const HTTP_STEPS: &[Step] = &[
    Step {
        id: "http.request",
        body_key: ExplanationKey("http.request"),
        anim: None,
    },
    Step {
        id: "http.response",
        body_key: ExplanationKey("http.response"),
        anim: None,
    },
];

const HTTP_CHOICES: &[ExerciseChoice] = &[
    ExerciseChoice {
        id: "http.c1",
        text: "The HTTP method (e.g. GET), target URI path, headers (Host, User-Agent), and optional body payload.",
        is_correct: true,
        feedback: "Correct! An HTTP request specifies the action and resource path along with metadata headers.",
    },
    ExerciseChoice {
        id: "http.c2",
        text: "The IP address of the local Wi-Fi router.",
        is_correct: false,
        feedback: "Router IP addresses belong to network/routing headers, not the HTTP application layer.",
    },
    ExerciseChoice {
        id: "http.c3",
        text: "A hardware diagnostic report.",
        is_correct: false,
        feedback: "HTTP is an application protocol for transferring hypermedia resources.",
    },
];

const HTTP_EXERCISES: &[Exercise] = &[Exercise {
    id: "http.explain",
    kind: ExerciseKind::ExplainBack,
    prompt: "What does an HTTP request communicate to the web server?",
    answer_key: Some(ExplanationKey("http.request")),
    choices: HTTP_CHOICES,
    explanation: "RFC 9110 defines HTTP semantics: a client issues a request (Method + URI + Headers) and the server replies with a Status Code (e.g. 200 OK) and Representation Body.",
}];

const LOSS_STEPS: &[Step] = &[
    Step {
        id: "loss.seq",
        body_key: ExplanationKey("tcp.seq"),
        anim: Some(AnimationRef::Degradation),
    },
    Step {
        id: "loss.window",
        body_key: ExplanationKey("tcp.window"),
        anim: Some(AnimationRef::Degradation),
    },
];

const LOSS_CHOICES: &[ExerciseChoice] = &[
    ExerciseChoice {
        id: "loss.c1",
        text: "Packet loss occurred in transit, triggering TCP retransmissions and congestion window reduction.",
        is_correct: true,
        feedback: "Correct! When packets drop, duplicate ACKs or RTO timeouts cause TCP to retransmit the missing sequence numbers.",
    },
    ExerciseChoice {
        id: "loss.c2",
        text: "The remote server changed its domain name during transmission.",
        is_correct: false,
        feedback: "Domain names do not change mid-flow; sequence number repetition indicates transport loss.",
    },
    ExerciseChoice {
        id: "loss.c3",
        text: "The TLS certificate expired during the handshake.",
        is_correct: false,
        feedback: "Certificate expiration yields a TLS alert, not repeated TCP sequence segments.",
    },
];

const LOSS_EXERCISES: &[Exercise] = &[Exercise {
    id: "loss.diagnose",
    kind: ExerciseKind::Diagnose,
    prompt: "When flow inspection shows repeated TCP sequence numbers, what is the underlying root cause?",
    answer_key: Some(ExplanationKey("tcp.seq")),
    choices: LOSS_CHOICES,
    explanation: "TCP sequence numbers ensure byte-stream ordering. Repeated sequence numbers indicate lost segments that the sender must retransmit, introducing latency stalls.",
}];

const RESET_STEPS: &[Step] = &[
    Step {
        id: "rst.flag",
        body_key: ExplanationKey("tcp.flags.rst"),
        anim: None,
    },
    Step {
        id: "fin.flag",
        body_key: ExplanationKey("tcp.flags.fin"),
        anim: None,
    },
];

const RESET_CHOICES: &[ExerciseChoice] = &[
    ExerciseChoice {
        id: "rst.c1",
        text: "The port is closed/unreachable, an intermediate firewall blocked the connection, or a half-open state was detected.",
        is_correct: true,
        feedback: "Correct! TCP RST aborts a connection immediately without waiting for in-flight data.",
    },
    ExerciseChoice {
        id: "rst.c2",
        text: "The website completed normally with full caching.",
        is_correct: false,
        feedback: "Normal completion uses clean FIN/ACK teardown, not abrupt RST.",
    },
    ExerciseChoice {
        id: "rst.c3",
        text: "DNS lookup returned an IPv6 address.",
        is_correct: false,
        feedback: "IPv6 addresses establish standard connections; RST indicates socket rejection.",
    },
];

const RESET_EXERCISES: &[Exercise] = &[Exercise {
    id: "rst.diagnose",
    kind: ExerciseKind::Diagnose,
    prompt: "What does an unexpected TCP RST (Reset) flag signify?",
    answer_key: Some(ExplanationKey("tcp.flags.rst")),
    choices: RESET_CHOICES,
    explanation: "A TCP RST packet indicates that the receiver has no matching socket for the incoming segment, or that a security device intentionally severed the connection.",
}];

const NXDOMAIN_STEPS: &[Step] = &[Step {
    id: "nxdomain.rcode",
    body_key: ExplanationKey("dns.rcode.nxdomain"),
    anim: None,
}];

const NXDOMAIN_CHOICES: &[ExerciseChoice] = &[
    ExerciseChoice {
        id: "nx.c1",
        text: "The queried domain name does not exist in the DNS hierarchy (Non-Existent Domain).",
        is_correct: true,
        feedback: "Correct! RCODE 3 (NXDOMAIN) proves authoritative resolvers have no record for the requested name.",
    },
    ExerciseChoice {
        id: "nx.c2",
        text: "The server is overloaded with too much traffic.",
        is_correct: false,
        feedback: "Server overload typically produces timeouts or SERVFAIL (RCODE 2), not NXDOMAIN.",
    },
    ExerciseChoice {
        id: "nx.c3",
        text: "The Wi-Fi router is disconnected from power.",
        is_correct: false,
        feedback: "If local network was down, queries would time out without receiving an NXDOMAIN response.",
    },
];

const NXDOMAIN_EXERCISES: &[Exercise] = &[Exercise {
    id: "nxdomain.explain",
    kind: ExerciseKind::ExplainBack,
    prompt: "What does an NXDOMAIN response code in DNS mean?",
    answer_key: Some(ExplanationKey("dns.rcode.nxdomain")),
    choices: NXDOMAIN_CHOICES,
    explanation: "RFC 1035 specifies RCODE 3 as NXDOMAIN: authoritative name servers confirmed that the domain name is unregistered or misspelled.",
}];

// ---- Authored Lessons ----------------------------------------

pub const B1_OVERVIEW: Lesson = Lesson {
    id: "b1.overview",
    title: "The network stack: from wire to app",
    level: Level::Beginner,
    trigger: Trigger::None,
    prerequisites: &[],
    objectives: &[
        "Understand layered network encapsulation (L2 Data Link, L3 Network, L4 Transport).",
        "Distinguish between MAC addresses, IP addresses, and TCP/UDP ports.",
    ],
    related_concepts: &["eth.addr", "ip.addr", "tcp.port"],
    steps: OVERVIEW_STEPS,
    exercises: OVERVIEW_EXERCISES,
};

pub const B3_DNS: Lesson = Lesson {
    id: "b3.dns",
    title: "DNS: finding addresses",
    level: Level::Beginner,
    trigger: Trigger::DnsLookup,
    prerequisites: &["b1.overview"],
    objectives: &[
        "Understand the role of Domain Name System (DNS) in name resolution.",
        "Inspect DNS queries and response records in captured traffic.",
    ],
    related_concepts: &["dns.query", "dns.response", "udp.port"],
    steps: DNS_STEPS,
    exercises: DNS_EXERCISES,
};

pub const B4_HANDSHAKE: Lesson = Lesson {
    id: "b4.handshake",
    title: "Connections: the 3-way handshake",
    level: Level::Beginner,
    trigger: Trigger::TcpHandshake,
    prerequisites: &["b3.dns"],
    objectives: &[
        "Learn the SYN -> SYN-ACK -> ACK connection sequence.",
        "Observe how Round Trip Time (RTT) affects connection setup latency.",
    ],
    related_concepts: &["tcp.flags.syn", "tcp.flags.ack", "tcp.seq"],
    steps: HANDSHAKE_STEPS,
    exercises: HANDSHAKE_EXERCISES,
};

pub const B5_ENCRYPTION: Lesson = Lesson {
    id: "b5.encryption",
    title: "Encryption: why the padlock (TLS)",
    level: Level::Beginner,
    trigger: Trigger::TlsHandshake,
    prerequisites: &["b4.handshake"],
    objectives: &[
        "Understand TLS ClientHello, ServerHello, and certificate validation.",
        "Inspect Server Name Indication (SNI) and cryptographic negotiation.",
    ],
    related_concepts: &[
        "tls.handshake.client_hello",
        "tls.handshake.server_hello",
        "tls.sni",
    ],
    steps: TLS_STEPS,
    exercises: TLS_EXERCISES,
};

pub const B2_PAGELOAD: Lesson = Lesson {
    id: "b2.pageload",
    title: "What happens when I type a URL?",
    level: Level::Beginner,
    trigger: Trigger::PageLoad,
    prerequisites: &["b3.dns", "b4.handshake", "b5.encryption"],
    objectives: &[
        "Trace the end-to-end journey of loading a webpage.",
        "Connect DNS lookup, TCP connect, TLS handshake, and HTTP exchange.",
    ],
    related_concepts: &[
        "dns.query",
        "tcp.flags.syn",
        "tls.sni",
        "http.request",
        "http.response",
    ],
    steps: HTTP_STEPS,
    exercises: HTTP_EXERCISES,
};

pub const I4_LOSS: Lesson = Lesson {
    id: "i4.loss",
    title: "Latency, loss, retransmission",
    level: Level::Intermediate,
    trigger: Trigger::LossBurst,
    prerequisites: &["b4.handshake"],
    objectives: &[
        "Identify packet loss signatures and TCP sequence number repetition.",
        "Understand how retransmissions and bufferbloat degrade user experience.",
    ],
    related_concepts: &["tcp.seq", "tcp.window", "ip.ttl"],
    steps: LOSS_STEPS,
    exercises: LOSS_EXERCISES,
};

pub const I1_RESET: Lesson = Lesson {
    id: "i1.reset",
    title: "Connection resets & refusals (RST)",
    level: Level::Intermediate,
    trigger: Trigger::None,
    prerequisites: &["b4.handshake"],
    objectives: &[
        "Understand the difference between orderly FIN teardown and abrupt RST resets.",
        "Diagnose firewall blocking and port unreachable scenarios.",
    ],
    related_concepts: &["tcp.flags.rst", "tcp.flags.fin"],
    steps: RESET_STEPS,
    exercises: RESET_EXERCISES,
};

pub const I2_NXDOMAIN: Lesson = Lesson {
    id: "i2.nxdomain",
    title: "DNS failures & domain not found",
    level: Level::Intermediate,
    trigger: Trigger::None,
    prerequisites: &["b3.dns"],
    objectives: &[
        "Diagnose domain resolution failures and DNS RCODE 3 (NXDOMAIN).",
        "Understand the difference between DNS timeouts and non-existent domains.",
    ],
    related_concepts: &["dns.rcode.nxdomain", "dns.query"],
    steps: NXDOMAIN_STEPS,
    exercises: NXDOMAIN_EXERCISES,
};

const MODULE_BASICS_LESSONS: &[Lesson] = &[
    B1_OVERVIEW,
    B3_DNS,
    B4_HANDSHAKE,
    B5_ENCRYPTION,
    B2_PAGELOAD,
];
const MODULE_DIAGNOSTICS_LESSONS: &[Lesson] = &[I4_LOSS, I1_RESET, I2_NXDOMAIN];

/// The authored curriculum grouped into coherent modules.
pub const CURRICULUM: &[Module] = &[
    Module {
        id: "m.basics",
        title: "How the web loads",
        description:
            "Foundations of internet communication from DNS resolution to full page rendering.",
        level: Level::Beginner,
        lessons: MODULE_BASICS_LESSONS,
    },
    Module {
        id: "m.diagnosing",
        title: "Diagnosing performance & errors",
        description:
            "Identifying packet loss, retransmissions, connection resets, and resolution failures.",
        level: Level::Intermediate,
        lessons: MODULE_DIAGNOSTICS_LESSONS,
    },
];

/// Look up a lesson by id across the whole curriculum.
pub fn lesson(id: &str) -> Option<&'static Lesson> {
    CURRICULUM
        .iter()
        .flat_map(|m| m.lessons.iter())
        .find(|l| l.id == id)
}

/// The first lesson whose trigger matches an observed teachable moment.
pub fn lesson_for_trigger(trigger: Trigger) -> Option<&'static Lesson> {
    if trigger == Trigger::None {
        return None;
    }
    CURRICULUM
        .iter()
        .flat_map(|m| m.lessons.iter())
        .find(|l| l.trigger == trigger)
}

/// Validate a user's choice index for a specific exercise in a lesson.
pub fn validate_exercise_choice(
    lesson_id: &str,
    exercise_id: &str,
    choice_index: usize,
) -> Option<ExerciseValidationResult> {
    let l = lesson(lesson_id)?;
    let ex = l.exercises.iter().find(|e| e.id == exercise_id)?;
    let choice = ex.choices.get(choice_index)?;
    let correct_idx = ex.choices.iter().position(|c| c.is_correct).unwrap_or(0);

    Some(ExerciseValidationResult {
        is_correct: choice.is_correct,
        feedback: choice.feedback.to_string(),
        explanation: ex.explanation.to_string(),
        correct_choice_index: correct_idx,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use netpulse_decode::explain;

    #[test]
    fn curriculum_keys_all_resolve_at_all_depths() {
        // Every step's explanation key must resolve to content at all three
        // depths — the "no dead ends" invariant applied to the curriculum.
        for module in CURRICULUM {
            for lesson in module.lessons {
                for step in lesson.steps {
                    let ex = explain(step.body_key).unwrap_or_else(|| {
                        panic!("lesson {} step {} has no content", lesson.id, step.id)
                    });
                    for depth in [
                        netpulse_decode::DisclosureDepth::Beginner,
                        netpulse_decode::DisclosureDepth::Intermediate,
                        netpulse_decode::DisclosureDepth::Expert,
                    ] {
                        assert!(!ex.at(depth).trim().is_empty());
                    }
                }
                // Grounded exercises must cite a resolvable key too.
                for exercise in lesson.exercises {
                    if let Some(key) = exercise.answer_key {
                        assert!(explain(key).is_some(), "exercise {} key", exercise.id);
                    }
                }
            }
        }
    }

    #[test]
    fn lesson_ids_are_unique() {
        let mut ids: Vec<&str> = CURRICULUM
            .iter()
            .flat_map(|m| m.lessons.iter())
            .map(|l| l.id)
            .collect();
        let total = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), total, "duplicate lesson id in curriculum");
    }

    #[test]
    fn trigger_maps_to_lesson() {
        assert_eq!(
            lesson_for_trigger(Trigger::TlsHandshake).map(|l| l.id),
            Some("b5.encryption")
        );
        assert!(lesson_for_trigger(Trigger::None).is_none());
    }

    #[test]
    fn level_maps_to_depth() {
        assert_eq!(Level::Beginner.as_depth(), netpulse_core::Depth::Beginner);
        assert_eq!(Level::Expert.as_depth(), netpulse_core::Depth::Expert);
    }

    #[test]
    fn exercise_choices_have_single_correct_answer() {
        for module in CURRICULUM {
            for lesson in module.lessons {
                for ex in lesson.exercises {
                    let correct_count = ex.choices.iter().filter(|c| c.is_correct).count();
                    assert_eq!(
                        correct_count, 1,
                        "exercise {} in lesson {} must have exactly one correct choice",
                        ex.id, lesson.id
                    );
                }
            }
        }
    }

    #[test]
    fn validate_exercise_choice_returns_accurate_feedback() {
        let correct = validate_exercise_choice("b4.handshake", "tcp.identify.syn", 0)
            .expect("exercise exists");
        assert!(correct.is_correct);
        assert_eq!(correct.correct_choice_index, 0);
        assert!(correct.feedback.contains("Correct"));

        let incorrect = validate_exercise_choice("b4.handshake", "tcp.identify.syn", 1)
            .expect("exercise exists");
        assert!(!incorrect.is_correct);
        assert_eq!(incorrect.correct_choice_index, 0);
    }

    #[test]
    fn prerequisite_ids_are_valid_lessons() {
        for module in CURRICULUM {
            for lesson in module.lessons {
                for &prereq in lesson.prerequisites {
                    assert!(
                        lesson_lookup_exists(prereq),
                        "prerequisite {} in lesson {} does not exist in curriculum",
                        prereq,
                        lesson.id
                    );
                }
            }
        }
    }

    fn lesson_lookup_exists(id: &str) -> bool {
        CURRICULUM
            .iter()
            .flat_map(|m| m.lessons.iter())
            .any(|l| l.id == id)
    }
}
