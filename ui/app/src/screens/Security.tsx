// Security — the Security Engine surface (docs/17). NetPulse surfaces *suspicious
// behaviour* as calm, confidence-labelled cards — never modal alarms, never
// "MALWARE DETECTED" (docs/17 §3.1, §7.1, docs/01 X4). Every finding explains
// itself: it scores its confidence, links its evidence, names why the behaviour
// might be *innocent*, and suggests only a non-destructive action (docs/17 §3.3,
// §7.3). The user can mark a finding "expected" to teach the engine and suppress
// benign recurrences (docs/17 §7.2) — kept local, never uploaded (docs/01 X3).

import { useEffect, useState } from "react";
import type { SecurityFinding } from "@netpulse/contract";
import { EmptyState, Notice, Spinner, EvidenceChips } from "@netpulse/components";
import { query } from "../ipc";
import { useDisclosure } from "../modes/DisclosureContext";
import { ConfidenceMeter, IncidentTimelineViz } from "@netpulse/viz";
import { useEvidenceNavigation } from "../context/EvidenceNavigationContext";

function toErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const KIND_LABEL: Record<SecurityFinding["kind"], string> = {
  unexpected_egress: "Unexpected app access",
  beaconing: "Regular check-ins",
  port_scan: "Port scanning",
  dns_anomaly: "DNS burst",
  connection_storm: "Connection storm",
  bandwidth_anomaly: "Unusual volume",
  ml_feature_anomaly: "ML Feature Anomaly",
  threat_intel_match: "Threat Intel Match",
  app_profile_breach: "Profile Breach",
  behavioral_chain: "Multi-Stage Chain",
};

function FindingCard({
  finding,
  expected,
  onMarkExpected,
}: {
  finding: SecurityFinding;
  expected: boolean;
  onMarkExpected: () => void;
}) {
  const { shows } = useDisclosure();
  const { navigateToEvidence } = useEvidenceNavigation();

  return (
    <article className={expected ? "np-finding np-finding--expected" : "np-finding"}>
      <header className="np-finding__head">
        <span className="np-finding__title">{finding.title}</span>
        <span className="np-finding__kind">{KIND_LABEL[finding.kind]}</span>
      </header>

      <div className="np-finding__confidence">
        <ConfidenceMeter percent={finding.confidence_percent} qualitative={finding.qualitative} />
        <span className="np-confidence-word">{finding.qualitative}</span>
      </div>

      <p className="np-finding__explanation">{finding.explanation}</p>

      {finding.technical && shows("intermediate") && (
        <p className="np-finding__technical">{finding.technical}</p>
      )}

      {finding.corroboration.length > 0 && (
        <p className="np-finding__corroboration">
          Also seen: {finding.corroboration.map((k) => KIND_LABEL[k]).join(", ")}
        </p>
      )}

      <details className="np-finding__benign">
        <summary>Why this might be normal</summary>
        <ul>
          {finding.benign_explanations.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      </details>

      <footer className="np-finding__foot">
        <span className="np-finding__action">{finding.suggested_action}</span>
        <EvidenceChips evidence={finding.evidence} onNavigate={navigateToEvidence} />
        <button
          className="np-finding__expected-btn"
          disabled={expected}
          onClick={onMarkExpected}
        >
          {expected ? "Marked expected" : "Mark as expected"}
        </button>
      </footer>
    </article>
  );
}

export function Security() {
  const { depth } = useDisclosure();
  const { navigateToEvidence } = useEvidenceNavigation();
  const [findings, setFindings] = useState<SecurityFinding[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [expected, setExpected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    query({ kind: "securityFindings", from_mono_nanos: 0, to_mono_nanos: Number.MAX_SAFE_INTEGER })
      .then((res) => {
        if (!cancelled) setFindings(res.kind === "findings" ? res.findings : []);
      })
      .catch((e) => {
        if (!cancelled) setNotice(toErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [depth]);

  function keyOf(f: SecurityFinding): string {
    return `${f.kind}:${f.evidence.map((e) => e.id).join(",")}`;
  }

  if (!loaded) {
    return <Spinner />;
  }

  const byCat = (c: SecurityFinding["category"]) =>
    findings.filter((f) => f.category === c).length;
  const summary = [
    { label: "Findings", value: findings.length },
    { label: "Anomaly", value: byCat("anomaly") },
    { label: "Suspicious", value: byCat("suspicious") },
    { label: "Informational", value: byCat("informational") },
  ];

  return (
    <section className="np-security" aria-label="Security findings">
      <Notice message={notice} onDismiss={() => setNotice(null)} />
      {findings.length === 0 ? (
        <EmptyState>
          Nothing looks unusual. Findings appear here — calmly, with their reasons — if they do.
        </EmptyState>
      ) : (
        <>
          <div className="np-kpis">
            {summary.map((s) => (
              <div className="np-kpi" key={s.label}>
                <div className="np-kpi__label">{s.label}</div>
                <div className="np-kpi__value">{s.value}</div>
              </div>
            ))}
          </div>

          <IncidentTimelineViz findings={findings} onNavigateEvidence={navigateToEvidence} />

          {findings.map((f) => {
            const k = keyOf(f);
            return (
              <FindingCard
                key={k}
                finding={f}
                expected={expected.has(k)}
                onMarkExpected={() => setExpected((prev) => new Set(prev).add(k))}
              />
            );
          })}
        </>
      )}
    </section>
  );
}
