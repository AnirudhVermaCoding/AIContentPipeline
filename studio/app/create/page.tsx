"use client";

import type {
  BrandDetail,
  CreateVideoRequest,
  CreateVideoResponse,
  ProductView,
} from "@pipeline/studio/api-types";
import { AlertTriangle, ChevronDown, ChevronUp, ShieldCheck, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Money } from "@/components/money";
import { ProductReferenceStrip } from "@/components/product-refs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { ErrorBanner, PageHeader, Skeleton } from "@/components/ui/misc";
import { useApi } from "@/hooks/use-api";
import { apiPost } from "@/lib/api";
import { useStudio } from "@/lib/studio-context";
import { cn } from "@/lib/utils";

const PLATFORMS = [
  "Instagram Reels",
  "YouTube Shorts",
  "TikTok",
  "Facebook Reels",
  "Website / product page",
  "WhatsApp",
];

export default function CreatePage() {
  const { brandId, brands, settings } = useStudio();
  const router = useRouter();
  const brand = useApi<BrandDetail>(brandId ? `/api/brands/${brandId}` : null, { deps: [brandId] });
  const [productId, setProductId] = useState<string>("");
  const [goal, setGoal] = useState("");
  const [topic, setTopic] = useState("");
  const [audience, setAudience] = useState("");
  const [duration, setDuration] = useState<string>("30");
  const [platform, setPlatform] = useState(PLATFORMS[0] as string);
  const [direction, setDirection] = useState("");
  const [cta, setCta] = useState("");
  const [notes, setNotes] = useState("");
  const [title, setTitle] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [budget, setBudget] = useState("");
  const [aiSeconds, setAiSeconds] = useState("");
  const [voice, setVoice] = useState<CreateVideoRequest["advanced"]["voice"]>("brand_default");
  const [music, setMusic] = useState<CreateVideoRequest["advanced"]["music"]>("brand_default");
  const [approval, setApproval] = useState<CreateVideoRequest["advanced"]["approval_mode"]>(
    "storyboard_and_keyframes",
  );
  const [mode, setMode] = useState<"live" | "mock">("live");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateVideoResponse | null>(null);

  const products = brand.data?.products ?? [];
  const product: ProductView | null = products.find((p) => p.id === productId) ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: prefill once when the brand loads
  useEffect(() => {
    if (brand.data) {
      if (!audience) setAudience(brand.data.audience);
      if (!productId && products.length) setProductId(products[0]?.id ?? "");
      if (!cta && brand.data.profile.cta.patterns[0]) setCta(brand.data.profile.cta.patterns[0]);
    }
  }, [brand.data]);

  const rate = settings?.fx.rate ?? 84;
  const capUsd = brand.data?.budget.hard_cap_usd ?? 2.5;
  const canSubmit = !!brandId && topic.trim().length > 0 && goal.trim().length > 0 && !submitting;
  const hardBlocked = useMemo(
    () =>
      !!product &&
      product.profile.reference_policy.hard &&
      product.reference_count < product.profile.reference_policy.min,
    [product],
  );

  async function submit() {
    if (!brandId) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: CreateVideoRequest = {
        brand_id: brandId,
        product_id: productId || null,
        title: title.trim() || null,
        topic: topic.trim(),
        goal: goal.trim(),
        audience: audience.trim() || null,
        duration_s: duration ? Number(duration) : null,
        platform: platform || null,
        creative_direction: direction.trim() || null,
        cta: cta.trim() || null,
        notes: notes.trim() || null,
        advanced: {
          budget_override_usd: budget
            ? Number(budget) / (settings?.display_currency === "USD" ? 1 : rate)
            : null,
          ai_video_seconds: aiSeconds ? Number(aiSeconds) : null,
          voice,
          music,
          approval_mode: approval,
          provider_mode: mode,
          provider_overrides: Object.fromEntries(
            Object.entries(overrides)
              .filter(([, v]) => v.trim())
              .map(([k, v]) => [k, { model: v.trim() }]),
          ),
        },
      };
      const res = await apiPost<CreateVideoResponse>("/api/runs", body);
      setResult(res);
      if (!res.blocked) router.push(`/runs/${res.run.run_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!brandId) return <ErrorBanner message="Select a brand first." />;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Create Video"
        description="Choose a product, describe the goal, and the Creative Director, Storyboard artist and Router decide shots, cameras, models and pacing. You review the plan before production spends money."
      />
      {result?.blocked ? (
        <div className="rounded-md border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">
          <p className="font-medium">Not started: {result.blocked.rule} rule</p>
          <p>{result.blocked.reason}</p>
          <p className="mt-1 text-xs">
            The run was saved as stopped; you can resume it from Active Runs once the budget allows.
          </p>
        </div>
      ) : null}
      <ErrorBanner message={error} />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>What are we making?</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Brand">
                <Select value={brandId} disabled>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Product"
                hint={
                  !products.length
                    ? "No products in the catalog yet; the run uses the brand's default product description."
                    : undefined
                }
              >
                <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
                  <option value="">Brand default ({brand.data?.product_name ?? "…"})</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Video goal" className="sm:col-span-2">
                <Input
                  placeholder="e.g. Make parents want to buy the toy"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                />
              </Field>
              <Field
                label="Topic / idea"
                className="sm:col-span-2"
                hint="One line the creative director builds the concept around."
              >
                <Input
                  placeholder="e.g. The satisfaction of watching the train place dominoes"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                />
              </Field>
              <Field label="Target audience">
                <Input value={audience} onChange={(e) => setAudience(e.target.value)} />
              </Field>
              <Field label="Desired duration (seconds)">
                <Input
                  type="number"
                  min={8}
                  max={90}
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                />
              </Field>
              <Field label="Platform">
                <Select value={platform} onChange={(e) => setPlatform(e.target.value)}>
                  {PLATFORMS.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Title (optional)">
                <Input
                  placeholder="Shown in the studio; defaults to product + topic"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </Field>
              <Field
                label="Creative direction"
                className="sm:col-span-2"
                hint="Tone, what to focus on, what to avoid. The brand direction is applied automatically."
              >
                <Textarea
                  rows={4}
                  placeholder={
                    "Playful, tactile, joyful, clean product photography.\nFocus on the satisfaction of watching the train place dominoes.\nAvoid looking like a generic toy advertisement."
                  }
                  value={direction}
                  onChange={(e) => setDirection(e.target.value)}
                />
              </Field>
              <Field label="Call to action">
                <Input value={cta} onChange={(e) => setCta(e.target.value)} />
              </Field>
              <Field label="Optional notes">
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Anything else the team should know"
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <button
              type="button"
              className="flex w-full items-center justify-between px-5 py-3 text-sm font-semibold"
              onClick={() => setAdvanced((v) => !v)}
            >
              Advanced settings
              {advanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {advanced ? (
              <CardContent className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
                <Field
                  label={`Max total budget (${settings?.display_currency ?? "INR"})`}
                  hint={`Brand default: ${settings?.display_currency === "USD" ? `$${capUsd.toFixed(2)}` : `₹${Math.round(capUsd * rate)}`} per video (hard cap).`}
                >
                  <Input
                    type="number"
                    placeholder="brand default"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                  />
                </Field>
                <Field
                  label="Soft AI-video seconds target"
                  hint={`Brand default: ${brand.data?.budget.ai_video_seconds_target ?? 15} s of generated motion.`}
                >
                  <Input
                    type="number"
                    placeholder="brand default"
                    value={aiSeconds}
                    onChange={(e) => setAiSeconds(e.target.value)}
                  />
                </Field>
                <Field label="Voice">
                  <Select value={voice} onChange={(e) => setVoice(e.target.value as typeof voice)}>
                    <option value="brand_default">
                      Brand default ({brand.data?.profile.voice.narration_policy ?? "…"})
                    </option>
                    <option value="voice">Narration</option>
                    <option value="no_voice">No voice (music only)</option>
                  </Select>
                </Field>
                <Field label="Music">
                  <Select value={music} onChange={(e) => setMusic(e.target.value as typeof music)}>
                    <option value="brand_default">
                      Brand default ({brand.data?.profile.music.policy ?? "…"})
                    </option>
                    <option value="always">Always</option>
                    <option value="optional">If a matching track exists</option>
                    <option value="never">Never</option>
                  </Select>
                </Field>
                <Field
                  label="Approval mode"
                  hint="Gates stop the pipeline before money is spent on media."
                >
                  <Select
                    value={approval}
                    onChange={(e) => setApproval(e.target.value as typeof approval)}
                  >
                    <option value="storyboard_and_keyframes">
                      Review storyboard and keyframes (recommended)
                    </option>
                    <option value="keyframes_only">Review keyframes only</option>
                    <option value="storyboard_only">Review storyboard only</option>
                    <option value="auto">Fully automatic</option>
                  </Select>
                </Field>
                <Field
                  label="Providers"
                  hint="Live calls real APIs; mock produces placeholder media offline with the same accounting."
                >
                  <Select value={mode} onChange={(e) => setMode(e.target.value as "live" | "mock")}>
                    <option value="live">Live providers</option>
                    <option value="mock">Mock providers (simulation)</option>
                  </Select>
                </Field>
                {brand.data ? (
                  <div className="sm:col-span-2">
                    <p className="mb-2 text-xs font-medium text-fg-muted">
                      Model overrides (leave blank for brand defaults)
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {(
                        Object.entries(brand.data.providers) as Array<
                          [string, { provider: string; model: string }]
                        >
                      ).map(([k, v]) => (
                        <Field key={k} label={`${k} · ${v.provider}`}>
                          <Input
                            placeholder={v.model}
                            value={overrides[k] ?? ""}
                            onChange={(e) => setOverrides((o) => ({ ...o, [k]: e.target.value }))}
                          />
                        </Field>
                      ))}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            ) : null}
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={submit} disabled={!canSubmit || hardBlocked}>
              <Sparkles /> {submitting ? "Creating…" : "Generate plan"}
            </Button>
            <p className="text-xs text-fg-muted">
              Planning runs the creative director, script, narration and storyboard first; you will
              see the estimated production cost before approving it.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Product references</CardTitle>
            </CardHeader>
            <CardContent>
              {brand.loading && !brand.data ? <Skeleton className="h-24" /> : null}
              {product ? (
                <ProductReferenceStrip product={product} />
              ) : (
                <p className="text-sm text-fg-muted">
                  {products.length
                    ? "Choose a product to see its reference photos and rules."
                    : "The brand's product description will be used. Add products under Products / Assets for reference photos."}
                </p>
              )}
              {product?.warnings.length ? (
                <div
                  className={cn(
                    "mt-3 rounded-md border px-3 py-2 text-xs",
                    hardBlocked
                      ? "border-danger/30 bg-danger-bg text-danger"
                      : "border-warn/30 bg-warn-bg text-warn",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <ul className="space-y-1">
                      {product.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </div>
                  {hardBlocked ? (
                    <p className="mt-1 font-medium">
                      This product requires references before it can be generated.
                    </p>
                  ) : null}
                </div>
              ) : null}
              {product?.profile.must_preserve.length ? (
                <div className="mt-3">
                  <p className="mb-1 flex items-center gap-1 text-xs font-medium text-fg-muted">
                    <ShieldCheck className="h-3.5 w-3.5" /> Must preserve
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {product.profile.must_preserve.map((m) => (
                      <Badge key={m} variant="outline">
                        {m}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Before anything is spent</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-fg-muted">
              <p>
                Per-video hard cap: <Money usd={capUsd} secondary size="sm" />
              </p>
              <p>
                Planning (creative direction, script, narration, storyboard) is charged; media
                generation waits for your approval.
              </p>
              <p>
                Every figure in the studio is labelled: provider-reported, calculated from usage, or
                estimated.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
