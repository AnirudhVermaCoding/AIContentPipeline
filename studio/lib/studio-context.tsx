"use client";

import type { BrandSummary, StudioSettings } from "@pipeline/studio/api-types";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { apiGet } from "@/lib/api";

interface StudioState {
  brands: BrandSummary[];
  brandId: string;
  brand: BrandSummary | null;
  setBrandId: (id: string) => void;
  settings: StudioSettings | null;
  refreshSettings: () => Promise<void>;
  refreshBrands: () => Promise<void>;
  ready: boolean;
  error: string | null;
}

const Ctx = createContext<StudioState | null>(null);
const KEY = "aicp.studio.brand";

export function StudioProvider({ children }: { children: ReactNode }) {
  const [brands, setBrands] = useState<BrandSummary[]>([]);
  const [brandId, setBrand] = useState<string>("");
  const [settings, setSettings] = useState<StudioSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const refreshBrands = useCallback(async () => {
    const list = await apiGet<BrandSummary[]>("/api/brands");
    setBrands(list);
    setBrand((cur) => {
      if (cur && list.some((b) => b.id === cur)) return cur;
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(KEY);
      } catch {
        stored = null;
      }
      const pick =
        list.find((b) => b.id === stored)?.id ??
        list.find((b) => b.id === "bachalogy")?.id ??
        list[0]?.id ??
        "";
      return pick;
    });
  }, []);
  const refreshSettings = useCallback(async () => {
    setSettings(await apiGet<StudioSettings>("/api/settings"));
  }, []);

  useEffect(() => {
    Promise.all([refreshBrands(), refreshSettings()])
      .then(() => setReady(true))
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setReady(true);
      });
  }, [refreshBrands, refreshSettings]);

  const setBrandId = useCallback((id: string) => {
    setBrand(id);
    try {
      localStorage.setItem(KEY, id);
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo<StudioState>(
    () => ({
      brands,
      brandId,
      brand: brands.find((b) => b.id === brandId) ?? null,
      setBrandId,
      settings,
      refreshSettings,
      refreshBrands,
      ready,
      error,
    }),
    [brands, brandId, setBrandId, settings, refreshSettings, refreshBrands, ready, error],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStudio(): StudioState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStudio outside StudioProvider");
  return v;
}
