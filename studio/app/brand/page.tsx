"use client";

import type { BrandDetail, BrandProfile } from "@pipeline/studio/api-types";
import { History, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CreativeControlsEditor } from "@/components/creative-controls";
import { Money } from "@/components/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { ErrorBanner, PageHeader, Skeleton } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { useApi } from "@/hooks/use-api";
import { apiPut } from "@/lib/api";
import { useStudio } from "@/lib/studio-context";
import { formatDate } from "@/lib/utils";

type P = BrandProfile;
const toLines = (a: string[]) => a.join("\n");
const fromLines = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

function Lines({
  label,
  value,
  onChange,
  hint,
  rows = 3,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  hint?: string;
  rows?: number;
}) {
  const [text, setText] = useState(toLines(value));
  useEffect(() => setText(toLines(value)), [value]);
  return (
    <Field label={label} hint={hint ?? "One per line"}>
      <Textarea
        rows={rows}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onChange(fromLines(text))}
      />
    </Field>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card id={title.toLowerCase().replace(/\W+/g, "-")}>
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {description ? <p className="text-xs text-fg-muted">{description}</p> : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">{children}</CardContent>
    </Card>
  );
}

export default function BrandPage() {
  const { brandId, refreshBrands, settings } = useStudio();
  const { data, error, loading, refresh } = useApi<BrandDetail>(
    brandId ? `/api/brands/${brandId}` : null,
    { deps: [brandId] },
  );
  const [p, setP] = useState<P | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    if (data) setP(structuredClone(data.profile));
  }, [data]);
  const dirty = useMemo(
    () => !!data && !!p && JSON.stringify(p) !== JSON.stringify(data.profile),
    [data, p],
  );
  const set = <K extends keyof P>(key: K, value: P[K]) =>
    setP((cur) => (cur ? { ...cur, [key]: value } : cur));
  const setIn = <K extends keyof P>(key: K, patch: Partial<P[K]>) =>
    setP((cur) => (cur ? { ...cur, [key]: { ...(cur[key] as object), ...patch } as P[K] } : cur));
  async function save() {
    if (!p || !brandId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiPut<BrandDetail>(`/api/brands/${brandId}/profile`, {
        profile: p,
        note: note || null,
      });
      setSaved(res.version);
      setNote("");
      await refresh();
      await refreshBrands();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }
  if (loading && !data) return <Skeleton className="h-64" />;
  if (error && !data) return <ErrorBanner message={error} />;
  if (!data || !p) return null;
  const v = p.visual;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Brand Direction"
        description={
          <>
            Everything that makes {data.name}'s videos different. Saving writes a new version of{" "}
            <span className="mono">brands/{brandId}/brand.yaml</span>; older versions stay in
            history and every run keeps the version that produced it.
          </>
        }
        right={
          <>
            <Badge variant="outline" className="mono">
              current {data.version}
            </Badge>
            <Input
              placeholder="What changed? (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-56"
            />
            <Button onClick={save} disabled={!dirty || saving}>
              <Save /> {saving ? "Saving…" : "Save new version"}
            </Button>
          </>
        }
      />
      <ErrorBanner message={saveError} />
      {saved ? (
        <div className="rounded-md border border-ok/30 bg-ok-bg px-3 py-2 text-sm text-ok">
          Saved version {saved}. Runs already created keep their pinned direction; new runs use this
          one.
        </div>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <div className="space-y-5">
          <Section title="Brand identity">
            <Field label="Name">
              <Input value={p.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label="Tagline">
              <Input value={p.tagline} onChange={(e) => set("tagline", e.target.value)} />
            </Field>
            <Field label="Default product name">
              <Input
                value={p.product.name}
                onChange={(e) => setIn("product", { name: e.target.value })}
              />
            </Field>
            <Field label="Category">
              <Input
                value={p.product.category}
                onChange={(e) => setIn("product", { category: e.target.value })}
              />
            </Field>
            <Field label="Product description" className="sm:col-span-2">
              <Textarea
                rows={3}
                value={p.product.description}
                onChange={(e) => setIn("product", { description: e.target.value })}
              />
            </Field>
          </Section>
          <Section title="Audience">
            <Field label="Primary audience" className="sm:col-span-2">
              <Input
                value={p.audience.primary}
                onChange={(e) => setIn("audience", { primary: e.target.value })}
              />
            </Field>
            <Field label="Secondary">
              <Input
                value={p.audience.secondary}
                onChange={(e) => setIn("audience", { secondary: e.target.value })}
              />
            </Field>
            <Field label="Age range">
              <Input
                value={p.audience.age_range}
                onChange={(e) => setIn("audience", { age_range: e.target.value })}
              />
            </Field>
            <Field label="Mindset" className="sm:col-span-2">
              <Input
                value={p.audience.mindset}
                onChange={(e) => setIn("audience", { mindset: e.target.value })}
              />
            </Field>
            <Lines
              label="Pains"
              value={p.audience.pains}
              onChange={(x) => setIn("audience", { pains: x })}
            />
            <Lines
              label="Desires"
              value={p.audience.desires}
              onChange={(x) => setIn("audience", { desires: x })}
            />
          </Section>
          <Section
            title="Brand promise"
            description="Benefits and claims the writer may or may not make."
          >
            <Lines
              label="Key benefits"
              value={p.product.key_benefits}
              onChange={(x) => setIn("product", { key_benefits: x })}
            />
            <Lines
              label="Allowed claims"
              value={p.product.allowed_claims}
              onChange={(x) => setIn("product", { allowed_claims: x })}
            />
            <Lines
              label="Forbidden claims (product)"
              value={p.product.forbidden_claims}
              onChange={(x) => setIn("product", { forbidden_claims: x })}
            />
            <Lines
              label="Forbidden claims (brand-wide)"
              value={p.forbidden.claims}
              onChange={(x) => setIn("forbidden", { claims: x })}
            />
          </Section>
          <Section title="Tone">
            <Lines
              label="Voice adjectives"
              value={p.tone.voice_adjectives}
              onChange={(x) => setIn("tone", { voice_adjectives: x })}
              hint="e.g. warm, playful, plain-spoken"
            />
            <Field label="Humor">
              <Select
                value={p.tone.humor}
                onChange={(e) => setIn("tone", { humor: e.target.value as P["tone"]["humor"] })}
              >
                {["none", "light", "playful", "dry"].map((h) => (
                  <option key={h}>{h}</option>
                ))}
              </Select>
            </Field>
            <Field label="Writing style" className="sm:col-span-2">
              <Textarea
                rows={2}
                value={p.tone.writing_style}
                onChange={(e) => setIn("tone", { writing_style: e.target.value })}
              />
            </Field>
            <Lines
              label="Sample lines"
              value={p.tone.sample_lines}
              onChange={(x) => setIn("tone", { sample_lines: x })}
            />
            <Lines
              label="Avoid phrases"
              value={[...p.tone.avoid_phrases]}
              onChange={(x) => setIn("tone", { avoid_phrases: x })}
            />
          </Section>
          <Section title="Emotions">
            <Lines
              label="Primary"
              value={p.emotions.primary}
              onChange={(x) => setIn("emotions", { primary: x })}
            />
            <Lines
              label="Secondary"
              value={p.emotions.secondary}
              onChange={(x) => setIn("emotions", { secondary: x })}
            />
            <Lines
              label="Avoid"
              value={p.emotions.avoid}
              onChange={(x) => setIn("emotions", { avoid: x })}
            />
          </Section>
          <Section title="Content pillars">
            {p.content_pillars.map((c, i) => (
              <div
                key={c.id}
                className="grid gap-2 rounded-md border border-border p-3 sm:col-span-2 sm:grid-cols-3"
              >
                <Field label="Id">
                  <Input
                    value={c.id}
                    onChange={(e) =>
                      set(
                        "content_pillars",
                        p.content_pillars.map((x, j) =>
                          j === i ? { ...x, id: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label="Name">
                  <Input
                    value={c.name}
                    onChange={(e) =>
                      set(
                        "content_pillars",
                        p.content_pillars.map((x, j) =>
                          j === i ? { ...x, name: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label="Description">
                  <Input
                    value={c.description}
                    onChange={(e) =>
                      set(
                        "content_pillars",
                        p.content_pillars.map((x, j) =>
                          j === i ? { ...x, description: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </Field>
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                set("content_pillars", [
                  ...p.content_pillars,
                  {
                    id: `pillar_${p.content_pillars.length + 1}`,
                    name: "New pillar",
                    description: "",
                    example_topics: [],
                  },
                ])
              }
            >
              Add pillar
            </Button>
          </Section>
          <Section title="Visual language">
            <Field label="Style summary" className="sm:col-span-2">
              <Textarea
                rows={4}
                value={v.style_summary}
                onChange={(e) => setIn("visual", { style_summary: e.target.value })}
              />
            </Field>
            <Field label="Lighting">
              <Input
                value={v.lighting}
                onChange={(e) => setIn("visual", { lighting: e.target.value })}
              />
            </Field>
            <Field label="Color grade">
              <Input
                value={v.color_grade}
                onChange={(e) => setIn("visual", { color_grade: e.target.value })}
              />
            </Field>
            <Lines
              label="Realism rules"
              value={v.realism_rules}
              onChange={(x) => setIn("visual", { realism_rules: x })}
            />
            <Lines
              label="Forbidden styles"
              value={v.forbidden_styles}
              onChange={(x) => setIn("visual", { forbidden_styles: x })}
            />
          </Section>
          <Section title="Colors & fonts">
            {(Object.keys(v.colors) as Array<keyof typeof v.colors>).map((k) => (
              <Field key={k} label={k}>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={v.colors[k]}
                    onChange={(e) =>
                      setIn("visual", { colors: { ...v.colors, [k]: e.target.value } })
                    }
                    className="h-9 w-10 rounded border border-border"
                  />
                  <Input
                    value={v.colors[k]}
                    onChange={(e) =>
                      setIn("visual", { colors: { ...v.colors, [k]: e.target.value } })
                    }
                  />
                </div>
              </Field>
            ))}
            <Field label="Heading font">
              <Input
                value={v.fonts.heading}
                onChange={(e) =>
                  setIn("visual", { fonts: { ...v.fonts, heading: e.target.value } })
                }
              />
            </Field>
            <Field label="Body font">
              <Input
                value={v.fonts.body}
                onChange={(e) => setIn("visual", { fonts: { ...v.fonts, body: e.target.value } })}
              />
            </Field>
          </Section>
          <Section title="Camera language">
            <Lines
              label="Shot sizes"
              value={v.camera_language.shot_sizes}
              onChange={(x) =>
                setIn("visual", { camera_language: { ...v.camera_language, shot_sizes: x } })
              }
            />
            <Lines
              label="Movements"
              value={v.camera_language.movements}
              onChange={(x) =>
                setIn("visual", { camera_language: { ...v.camera_language, movements: x } })
              }
            />
            <Lines
              label="Lenses"
              value={v.camera_language.lenses}
              onChange={(x) =>
                setIn("visual", { camera_language: { ...v.camera_language, lenses: x } })
              }
            />
            <Lines
              label="Framing rules"
              value={v.camera_language.framing_rules}
              onChange={(x) =>
                setIn("visual", { camera_language: { ...v.camera_language, framing_rules: x } })
              }
            />
          </Section>
          <Section title="Pacing">
            <Field label="Duration min (s)">
              <Input
                type="number"
                value={p.pacing.duration_s.min}
                onChange={(e) =>
                  setIn("pacing", {
                    duration_s: { ...p.pacing.duration_s, min: Number(e.target.value) },
                  })
                }
              />
            </Field>
            <Field label="Duration max (s)">
              <Input
                type="number"
                value={p.pacing.duration_s.max}
                onChange={(e) =>
                  setIn("pacing", {
                    duration_s: { ...p.pacing.duration_s, max: Number(e.target.value) },
                  })
                }
              />
            </Field>
            <Field label="Hold bias">
              <Select
                value={p.pacing.hold_bias}
                onChange={(e) =>
                  setIn("pacing", { hold_bias: e.target.value as P["pacing"]["hold_bias"] })
                }
              >
                {["long", "balanced", "snappy"].map((h) => (
                  <option key={h}>{h}</option>
                ))}
              </Select>
            </Field>
            <Field label="Shots per video (min–max)">
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={p.pacing.shot_count_hint.min}
                  onChange={(e) =>
                    setIn("pacing", {
                      shot_count_hint: { ...p.pacing.shot_count_hint, min: Number(e.target.value) },
                    })
                  }
                />
                <Input
                  type="number"
                  value={p.pacing.shot_count_hint.max}
                  onChange={(e) =>
                    setIn("pacing", {
                      shot_count_hint: { ...p.pacing.shot_count_hint, max: Number(e.target.value) },
                    })
                  }
                />
              </div>
            </Field>
          </Section>
          <Section title="Voice">
            <Field label="Provider">
              <Select
                value={p.voice.provider}
                onChange={(e) => setIn("voice", { provider: e.target.value })}
              >
                <option value="cartesia">cartesia</option>
                <option value="elevenlabs">elevenlabs</option>
              </Select>
            </Field>
            <Field label="Voice id" hint="A Cartesia or ElevenLabs voice id.">
              <Input
                value={p.voice.voice_id}
                onChange={(e) => setIn("voice", { voice_id: e.target.value })}
              />
            </Field>
            <Field label="Narration policy">
              <Select
                value={p.voice.narration_policy}
                onChange={(e) =>
                  setIn("voice", {
                    narration_policy: e.target.value as P["voice"]["narration_policy"],
                  })
                }
              >
                {["always", "optional", "never"].map((h) => (
                  <option key={h}>{h}</option>
                ))}
              </Select>
            </Field>
            <Field label="Style">
              <Input
                value={p.voice.style}
                onChange={(e) => setIn("voice", { style: e.target.value })}
              />
            </Field>
            <Field label="Speed">
              <Input
                type="number"
                step="0.05"
                value={p.voice.speed}
                onChange={(e) => setIn("voice", { speed: Number(e.target.value) })}
              />
            </Field>
            <Field label="Language">
              <Input
                value={p.voice.language}
                onChange={(e) => setIn("voice", { language: e.target.value })}
              />
            </Field>
          </Section>
          <Section title="Music">
            <Field label="Policy">
              <Select
                value={p.music.policy}
                onChange={(e) => setIn("music", { policy: e.target.value as P["music"]["policy"] })}
              >
                {["never", "optional", "always"].map((h) => (
                  <option key={h}>{h}</option>
                ))}
              </Select>
            </Field>
            <Field label="Energy">
              <Select
                value={p.music.energy}
                onChange={(e) => setIn("music", { energy: e.target.value as P["music"]["energy"] })}
              >
                {["low", "medium", "high"].map((h) => (
                  <option key={h}>{h}</option>
                ))}
              </Select>
            </Field>
            <Lines
              label="Mood tags"
              value={p.music.mood_tags}
              onChange={(x) => setIn("music", { mood_tags: x })}
            />
            <Field label="Gain (dB)">
              <Input
                type="number"
                value={p.music.gain_db}
                onChange={(e) => setIn("music", { gain_db: Number(e.target.value) })}
              />
            </Field>
          </Section>
          <Section title="Caption / text policy">
            <Field label="Captions">
              <Select
                value={p.text_policy.captions}
                onChange={(e) =>
                  setIn("text_policy", { captions: e.target.value as P["text_policy"]["captions"] })
                }
              >
                {["never", "brand_hook_only", "when_needed", "always"].map((h) => (
                  <option key={h}>{h}</option>
                ))}
              </Select>
            </Field>
            <Field label="Max words on screen">
              <Input
                type="number"
                value={p.text_policy.max_words_on_screen}
                onChange={(e) =>
                  setIn("text_policy", { max_words_on_screen: Number(e.target.value) })
                }
              />
            </Field>
            <Field label="Hook style" className="sm:col-span-2">
              <Input
                value={p.text_policy.hook_style}
                onChange={(e) => setIn("text_policy", { hook_style: e.target.value })}
              />
            </Field>
          </Section>
          <Section title="CTA rules">
            <Field label="Policy">
              <Select
                value={p.cta.policy}
                onChange={(e) => setIn("cta", { policy: e.target.value as P["cta"]["policy"] })}
              >
                {["never", "soft", "always"].map((h) => (
                  <option key={h}>{h}</option>
                ))}
              </Select>
            </Field>
            <Field label="Handle">
              <Input
                value={p.cta.handle}
                onChange={(e) => setIn("cta", { handle: e.target.value })}
              />
            </Field>
            <Lines
              label="CTA patterns"
              value={p.cta.patterns}
              onChange={(x) => setIn("cta", { patterns: x })}
            />
            <Field label="End card">
              <div className="flex h-9 items-center">
                <Switch
                  checked={p.cta.end_card}
                  onCheckedChange={(x) => setIn("cta", { end_card: x })}
                />
              </div>
            </Field>
          </Section>
          <Section
            title="Forbidden"
            description="Styles, words and visuals that must never appear."
          >
            <Lines
              label="Styles"
              value={p.forbidden.styles}
              onChange={(x) => setIn("forbidden", { styles: x })}
            />
            <Lines
              label="Words"
              value={p.forbidden.words}
              onChange={(x) => setIn("forbidden", { words: x })}
            />
            <Lines
              label="Visuals"
              value={p.forbidden.visuals}
              onChange={(x) => setIn("forbidden", { visuals: x })}
            />
          </Section>
          <Section
            title="Product accuracy rules"
            description="Entities whose identity must never drift. Products from the catalog are added automatically per run."
          >
            {p.entities.map((e, i) => (
              <div
                key={e.id}
                className="grid gap-2 rounded-md border border-border p-3 sm:col-span-2"
              >
                <div className="flex items-center gap-2 text-xs text-fg-muted">
                  <Badge variant="outline">{e.kind}</Badge> {e.id}{" "}
                  {e.always_present ? "· always present" : ""}
                </div>
                <Field label="Name">
                  <Input
                    value={e.name}
                    onChange={(ev) =>
                      set(
                        "entities",
                        p.entities.map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)),
                      )
                    }
                  />
                </Field>
                <Field label="Static features (never change)">
                  <Textarea
                    rows={2}
                    value={e.static_features}
                    onChange={(ev) =>
                      set(
                        "entities",
                        p.entities.map((x, j) =>
                          j === i ? { ...x, static_features: ev.target.value } : x,
                        ),
                      )
                    }
                  />
                </Field>
              </div>
            ))}
          </Section>
          <Section
            title="Budget defaults"
            description="Per-video limits used by every run of this brand. Wallet, daily and 48-hour limits are under Budget & Usage."
          >
            <Field label="Target per video (USD)">
              <Input
                type="number"
                step="0.1"
                value={p.budget.target_usd}
                onChange={(e) => setIn("budget", { target_usd: Number(e.target.value) })}
              />
            </Field>
            <Field
              label="Hard cap per video (USD)"
              hint={
                (<Money usd={p.budget.hard_cap_usd} secondary size="sm" />) as unknown as string
              }
            >
              <Input
                type="number"
                step="0.1"
                value={p.budget.hard_cap_usd}
                onChange={(e) => setIn("budget", { hard_cap_usd: Number(e.target.value) })}
              />
            </Field>
            <Field label="Soft AI-video seconds target">
              <Input
                type="number"
                value={p.budget.ai_video_seconds_target}
                onChange={(e) =>
                  setIn("budget", { ai_video_seconds_target: Number(e.target.value) })
                }
              />
            </Field>
            <Field label="Keyframe attempts per shot">
              <Input
                type="number"
                value={p.budget.keyframe_attempts}
                onChange={(e) => setIn("budget", { keyframe_attempts: Number(e.target.value) })}
              />
            </Field>
          </Section>
          <Section
            title="Creative defaults"
            description="Where Create Video starts its Creative Freedom and Goal Focus sliders for this brand. Each run stores its own values, so changing these never alters an existing run."
          >
            <div className="sm:col-span-2">
              <CreativeControlsEditor
                value={{
                  creative_freedom:
                    p.creative_defaults?.creative_freedom ??
                    settings?.creative.defaults.creative_freedom ??
                    0.65,
                  goal_focus:
                    p.creative_defaults?.goal_focus ??
                    settings?.creative.defaults.goal_focus ??
                    0.85,
                }}
                onChange={(v) => set("creative_defaults", v)}
                settings={settings?.creative}
              />
              {!p.creative_defaults ? (
                <p className="mt-2 text-xs text-fg-subtle">
                  Not set in brand.yaml yet: the pipeline defaults apply until you move a slider and
                  save.
                </p>
              ) : null}
            </div>
          </Section>
          <Section
            title="Provider preferences"
            description="Defaults come from src/config/settings.ts; set a provider/model here to override for this brand."
          >
            {(["llm_creative", "llm_fast", "image", "video", "tts"] as const).map((k) => (
              <Field
                key={k}
                label={`${k} model`}
                hint={`current: ${data.providers[k].provider} / ${data.providers[k].model}`}
              >
                <Input
                  placeholder={data.providers[k].model}
                  value={p.providers[k]?.model ?? ""}
                  onChange={(e) =>
                    set("providers", {
                      ...p.providers,
                      [k]: e.target.value
                        ? {
                            provider: p.providers[k]?.provider ?? data.providers[k].provider,
                            model: e.target.value,
                            options: p.providers[k]?.options ?? {},
                          }
                        : undefined,
                    })
                  }
                />
              </Field>
            ))}
          </Section>
        </div>
        <div className="space-y-4">
          <Card className="sticky top-20">
            <CardHeader>
              <CardTitle className="flex items-center gap-1">
                <History className="h-4 w-4" /> Versions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-xs">
                {data.versions.map((vv) => (
                  <li
                    key={vv.version}
                    className="flex flex-col gap-0.5 border-b border-border pb-2 last:border-0"
                  >
                    <span className="mono flex items-center gap-2">
                      {vv.version}
                      {vv.current ? <Badge variant="ok">current</Badge> : null}
                    </span>
                    <span className="text-fg-muted">
                      {formatDate(vv.created_at)} · {vv.actor}
                      {vv.note ? ` · ${vv.note}` : ""}
                    </span>
                    <span className="text-fg-subtle">
                      {vv.runs_count} run{vv.runs_count === 1 ? "" : "s"} produced with this version
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11px] text-fg-subtle">
                Bachalogy default direction: playful, warm, tactile, colorful but tasteful, joyful,
                curious, clean, premium enough to earn parent trust, product-first, childlike
                without looking cheap.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
