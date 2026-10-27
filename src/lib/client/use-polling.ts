"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { api, errorMessage } from "./api";

/**
 * Fetches `url` now and then every `intervalMs` while the tab is visible, which keeps the
 * dashboard current without websockets (which serverless hosting does not keep open).
 */
// The type parameter documents the expected response shape for each caller.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function usePolling<T>(url: string | null, intervalMs: number): {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const urlRef = useRef(url);
  useEffect(() => {
    urlRef.current = url;
  }, [url]);

  const refresh = useCallback(async () => {
    const current = urlRef.current;
    if (!current) return;
    try {
      const result = await api<T>(current);
      if (urlRef.current === current) {
        setData(result);
        setError(null);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!url) return undefined;
    let cancelled = false;
    const tick = async () => {
      if (!cancelled && document.visibilityState === "visible") await refresh();
    };
    void refresh();
    const timer = window.setInterval(() => void tick(), intervalMs);
    const onVisible = () => void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [url, intervalMs, refresh]);

  return { data, error, loading, refresh };
}
