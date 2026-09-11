"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiGet } from "@/lib/api";

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setData: (updater: (prev: T | null) => T | null) => void;
}

/**
 * Fetch JSON from the API and, optionally, keep polling. Polling is how the UI shows real
 * pipeline state: every tick re-reads what the job process wrote to SQLite and the run folder.
 */
export function useApi<T>(
  path: string | null,
  opts: { refreshMs?: number | null; deps?: unknown[] } = {},
): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!!path);
  const alive = useRef(true);
  const inflight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    if (!path) return;
    if (inflight.current) return inflight.current;
    const p = (async () => {
      try {
        const next = await apiGet<T>(path);
        if (!alive.current) return;
        setData(next);
        setError(null);
      } catch (err) {
        if (!alive.current) return;
        setError(
          err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err),
        );
      } finally {
        if (alive.current) setLoading(false);
        inflight.current = null;
      }
    })();
    inflight.current = p;
    return p;
  }, [path]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `refresh` already closes over `path`; callers add their own deps
  useEffect(() => {
    alive.current = true;
    setLoading(!!path);
    void refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh, ...(opts.deps ?? [])]);

  useEffect(() => {
    if (!path || !opts.refreshMs) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, opts.refreshMs);
    return () => clearInterval(id);
  }, [path, opts.refreshMs, refresh]);

  const set = useCallback(
    (updater: (prev: T | null) => T | null) => setData((prev) => updater(prev)),
    [],
  );
  return { data, error, loading, refresh, setData: set };
}
