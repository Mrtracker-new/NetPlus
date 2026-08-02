import { useState, useEffect, useMemo, useCallback } from "react";
import type { RecordingSummary } from "@netpulse/contract";
import { query, command } from "../ipc";

export type PrivacyFilter = "all" | RecordingSummary["privacy"]["level"];

export function useRecordingsController() {
  const [recordings, setRecordings] = useState<RecordingSummary[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [privacyFilter, setPrivacyFilter] = useState<PrivacyFilter>("all");

  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const fetchRecordings = useCallback(async () => {
    setNotice(null);
    try {
      const res = await query({ kind: "listRecordings" });
      if (res.kind === "recordings") {
        setRecordings(res.recordings);
        setAnnouncement(`Loaded ${res.recordings.length} session recordings.`);
      } else {
        setRecordings([]);
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setRecordings([]);
      setNotice(errMsg);
      setAnnouncement(`Failed to load recordings: ${errMsg}`);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void fetchRecordings();
  }, [fetchRecordings]);

  const startRecording = useCallback(async () => {
    setNotice(null);
    setBusy(true);
    try {
      await command({ kind: "startRecording" });
      setIsRecording(true);
      setAnnouncement("Started live session recording.");
      await fetchRecordings();
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setNotice(errMsg);
      setAnnouncement(`Failed to start recording: ${errMsg}`);
    } finally {
      setBusy(false);
    }
  }, [fetchRecordings]);

  const stopRecording = useCallback(async () => {
    setNotice(null);
    setBusy(true);
    try {
      await command({ kind: "stopRecording" });
      setIsRecording(false);
      setAnnouncement("Stopped live session recording.");
      await fetchRecordings();
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setNotice(errMsg);
      setAnnouncement(`Failed to stop recording: ${errMsg}`);
    } finally {
      setBusy(false);
    }
  }, [fetchRecordings]);

  // Memoized Summary KPIs
  const summary = useMemo(() => {
    let totalFrames = 0;
    let safeToShareCount = 0;
    let payloadCount = 0;

    for (const r of recordings) {
      totalFrames += r.frame_count;
      if (r.privacy.contains_payloads) {
        payloadCount++;
      } else {
        safeToShareCount++;
      }
    }

    return {
      total: recordings.length,
      totalFrames,
      safeToShareCount,
      payloadCount,
    };
  }, [recordings]);

  // Filtered recordings list
  const filteredRecordings = useMemo(() => {
    return recordings.filter((r) => {
      if (privacyFilter === "all") return true;
      return r.privacy.level === privacyFilter;
    });
  }, [recordings, privacyFilter]);

  return {
    recordings,
    filteredRecordings,
    summary,
    isRecording,
    loaded,
    busy,
    notice,
    setNotice,
    privacyFilter,
    setPrivacyFilter,
    startRecording,
    stopRecording,
    refresh: fetchRecordings,
    announcement,
  };
}
