import type { SVGProps } from "react";

/**
 * Econome brand mark (from econome.studio/logo) — a faceted gem in the brand
 * greens. Decorative by default so it isn't announced twice next to the
 * wordmark; pass `title` to give it an accessible name when it stands alone.
 */
export function EconomeMark({
  title,
  ...props
}: SVGProps<SVGSVGElement> & { title?: string }) {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative by default (aria-hidden) since the adjacent wordmark carries the name; a title element renders when `title` is passed.
    <svg
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <g stroke="#0e4226" strokeWidth={1.4} strokeLinejoin="round">
        <path d="M50 24 L34 42 L50 42 Z" fill="#2fa866" />
        <path d="M50 24 L66 42 L50 42 Z" fill="#1c7a45" />
        <path d="M34 42 L50 42 L50 58 L34 58 Z" fill="#239a59" />
        <path d="M50 42 L66 42 L66 58 L50 58 Z" fill="#0e4226" />
        <path d="M34 58 L50 58 L50 76 Z" fill="#1c7a45" />
        <path d="M66 58 L50 58 L50 76 Z" fill="#0e4226" />
      </g>
      <path
        d="M50 24 L66 42 L66 58 L50 76 L34 58 L34 42 Z"
        fill="none"
        stroke="#0e4226"
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
      <path
        d="M46 29 L48 30 L39 40 L37 39 Z"
        fill="#ffffff"
        fillOpacity={0.45}
      />
    </svg>
  );
}
