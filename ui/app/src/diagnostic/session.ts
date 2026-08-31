/**
 * Diagnostic Session Lifecycle and Monotonic Race Condition Guards.
 */

let nextSessionId = 1;

/**
 * Generates a strictly monotonic session ID within the application runtime.
 */
export function generateMonotonicSessionId(): number {
  return nextSessionId++;
}

/**
 * Guards against race conditions: returns true ONLY if result belongs to active session.
 * A completed result from session N must never overwrite state belonging to session N+1.
 */
export function isValidSessionCommit(
  activeSessionId: number | null | undefined,
  resultSessionId: number
): boolean {
  if (activeSessionId === null || activeSessionId === undefined) {
    return false;
  }
  return activeSessionId === resultSessionId;
}
