import type { QcCheck } from "../schema/qc.js";

export interface KeyframeCheckInput {
  width: number;
  height: number;
  bytes: number;
  expected: { width: number; height: number };
}

/**
 * Deterministic keyframe checks (MVP-A): right size and aspect, not empty, not a flat frame.
 * A vision judge can be added later behind the same result shape.
 */
export async function checkKeyframe(
  file: string,
  input: KeyframeCheckInput,
): Promise<{ pass: boolean; checks: QcCheck[] }> {
  const checks: QcCheck[] = [];
  const aspect = input.width / input.height;
  const expectedAspect = input.expected.width / input.expected.height;
  checks.push({
    id: "dimensions",
    status:
      input.width >= input.expected.width * 0.9 && Math.abs(aspect - expectedAspect) < 0.02
        ? "pass"
        : "fail",
    detail: `${input.width}x${input.height} (expected ~${input.expected.width}x${input.expected.height})`,
  });
  checks.push({
    id: "file_size",
    status: input.bytes > 20_000 ? "pass" : "fail",
    detail: `${Math.round(input.bytes / 1024)} KB`,
  });
  try {
    const sharp = (await import("sharp")).default;
    const stats = await sharp(file).stats();
    const spread = stats.channels.reduce((n, c) => Math.max(n, c.stdev), 0);
    checks.push({
      id: "not_flat",
      status: spread > 8 ? "pass" : "fail",
      detail: `max channel stdev ${spread.toFixed(1)}`,
    });
  } catch (err) {
    checks.push({
      id: "not_flat",
      status: "warn",
      detail: `could not compute stats: ${String(err)}`,
    });
  }
  return { pass: checks.every((c) => c.status !== "fail"), checks };
}
