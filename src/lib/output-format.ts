export const OUTPUT_ASPECT_RATIOS = ["4:5", "1:1", "3:2"] as const;

export type OutputAspectRatio = (typeof OUTPUT_ASPECT_RATIOS)[number];

export const DEFAULT_OUTPUT_ASPECT_RATIO: OutputAspectRatio = "4:5";

const LABELS: Record<OutputAspectRatio, string> = {
  "4:5": "4:5 Portrait",
  "1:1": "1:1 Square",
  "3:2": "3:2 Landscape",
};

const PARTS: Record<OutputAspectRatio, { width: number; height: number }> = {
  "4:5": { width: 4, height: 5 },
  "1:1": { width: 1, height: 1 },
  "3:2": { width: 3, height: 2 },
};

export const isOutputAspectRatio = (value: unknown): value is OutputAspectRatio =>
  typeof value === "string" &&
  (OUTPUT_ASPECT_RATIOS as readonly string[]).includes(value);

export const parseOutputAspectRatio = (
  value: unknown,
  fallback: OutputAspectRatio = DEFAULT_OUTPUT_ASPECT_RATIO,
): OutputAspectRatio => (isOutputAspectRatio(value) ? value : fallback);

export const outputAspectRatioLabel = (ratio: OutputAspectRatio): string =>
  LABELS[ratio];

export const outputAspectRatioParts = (
  ratio: OutputAspectRatio,
): { width: number; height: number } => PARTS[ratio];

export const outputAspectRatioValue = (ratio: OutputAspectRatio): number => {
  const { width, height } = PARTS[ratio];
  return width / height;
};

/** Relative error between pixel size and target ratio (0 = exact). */
export const aspectRatioRelativeError = (
  width: number,
  height: number,
  ratio: OutputAspectRatio,
): number => {
  if (width <= 0 || height <= 0) return Number.POSITIVE_INFINITY;
  const actual = width / height;
  const expected = outputAspectRatioValue(ratio);
  return Math.abs(actual - expected) / expected;
};

/** Default tolerance ~2% — allows encoder rounding without false positives. */
export const isNearOutputAspectRatio = (
  width: number,
  height: number,
  ratio: OutputAspectRatio,
  tolerance = 0.02,
): boolean => aspectRatioRelativeError(width, height, ratio) <= tolerance;

export const FORMAT_MISMATCH_WARNING =
  "Format warning: this image does not match the campaign output ratio. You can still approve or reject it.";

/**
 * Label for historical attempts whose real output ratio was never recorded.
 * Do not invent 4:5 for those rows.
 */
export const UNKNOWN_ASPECT_RATIO = "unknown";

export const formatStoredAspectRatioLabel = (value: string | null | undefined): string => {
  if (!value || value === UNKNOWN_ASPECT_RATIO) {
    return "Not recorded";
  }
  if (isOutputAspectRatio(value)) {
    return outputAspectRatioLabel(value);
  }
  return value;
};
