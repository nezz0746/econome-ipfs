/**
 * Build SVG path strings for a simple area/line chart. Values are sampled
 * left-to-right across `width`; y is scaled to `height` (higher value = higher
 * on screen). Returns empty strings when there is nothing to draw.
 */
export function buildAreaPath(
  values: number[],
  width: number,
  height: number,
): { line: string; area: string } {
  if (values.length < 2) return { line: "", area: "" };
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  const points = values.map((v, i) => {
    const x = Math.round(i * stepX * 100) / 100;
    const y = Math.round((height - ((v - min) / span) * height) * 100) / 100;
    return `${x},${y}`;
  });
  const line = `M${points.join(" L")}`;
  const area = `${line} L${width},${height} L0,${height} Z`;
  return { line, area };
}
