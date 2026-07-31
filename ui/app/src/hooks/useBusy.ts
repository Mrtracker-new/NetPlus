import { useState, useCallback, useEffect, useRef } from "react";

/**
 * Executes an async action while preventing concurrent invocations.
 * If the action is already running, additional calls immediately resolve to undefined.
 *
 * @param action - The async action handler to wrap.
 * @returns A tuple of `[busy, wrappedAction]`.
 *
 * @example
 * const [busy, handleExport] = useBusy(async (format: string) => {
 *   return await exportData(format);
 * });
 * <Button busy={busy} disabled={busy} onClick={() => handleExport("json")}>Export</Button>
 */
export function useBusy<R, T extends (...args: any[]) => Promise<R>>(
  action: T,
): [boolean, (...args: Parameters<T>) => Promise<R | undefined>] {
  const [busy, setBusy] = useState<boolean>(false);
  const busyRef = useRef<boolean>(false);
  const mountedRef = useRef<boolean>(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const wrapped = useCallback(
    async (...args: Parameters<T>): Promise<R | undefined> => {
      if (busyRef.current) return undefined;

      busyRef.current = true;
      setBusy(true);

      try {
        return await action(...args);
      } finally {
        busyRef.current = false;
        if (mountedRef.current) {
          setBusy(false);
        }
      }
    },
    [action],
  );

  return [busy, wrapped];
}
