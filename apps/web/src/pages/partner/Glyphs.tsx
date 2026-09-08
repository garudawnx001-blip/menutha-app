/**
 * SMALL UI ICONS, DRAWN RATHER THAN TYPED.
 *
 * These were Unicode characters, and three of them were rendering as tofu
 * boxes on the owner's machine:
 *
 *   U+2BC7 ⯇ / U+2BC8 ⯈  alignment arrows on the bill editor -- Miscellaneous
 *                        Symbols and Arrows, a block most system fonts simply
 *                        do not ship. This is the ▯▯ he photographed.
 *   U+283F ⠿             a Braille cell used as a drag handle. Present on
 *                        Windows, absent on plenty of Android builds.
 *   U+270E ✎             a Dingbats pencil, which some platforms substitute
 *                        with an emoji and others drop.
 *
 * A glyph is only as reliable as the font behind it, and we do not control
 * the font on a restaurant's counter PC. An inline SVG has no such
 * dependency: it renders identically everywhere, scales to any size, and
 * takes the surrounding text colour via `currentColor` -- which is also how
 * the app draws every icon it has, so the two surfaces now agree on more than
 * the shape.
 */
import React from 'react';

type IconProps = { size?: number; title?: string };

const box = (size: number) => ({
  width: size, height: size, display: 'block', flex: '0 0 auto',
} as const);

const common = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** Text aligned to the left edge — the short lines sit left. */
export function AlignLeftIcon({ size = 16, title }: IconProps) {
  return (
    <svg {...common} style={box(size)} role={title ? 'img' : 'presentation'} aria-label={title} aria-hidden={!title}>
      {title && <title>{title}</title>}
      <path d="M4 6h16M4 12h10M4 18h13" />
    </svg>
  );
}

/** Centred — the short lines are inset equally on both sides. */
export function AlignCenterIcon({ size = 16, title }: IconProps) {
  return (
    <svg {...common} style={box(size)} role={title ? 'img' : 'presentation'} aria-label={title} aria-hidden={!title}>
      {title && <title>{title}</title>}
      <path d="M4 6h16M7 12h10M6 18h12" />
    </svg>
  );
}

/** Right — the short lines sit right. */
export function AlignRightIcon({ size = 16, title }: IconProps) {
  return (
    <svg {...common} style={box(size)} role={title ? 'img' : 'presentation'} aria-label={title} aria-hidden={!title}>
      {title && <title>{title}</title>}
      <path d="M4 6h16M10 12h10M7 18h13" />
    </svg>
  );
}

/** The drag handle: six dots, the shape everything else uses for "grab me". */
export function DragHandleIcon({ size = 16, title }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" style={box(size)} role={title ? 'img' : 'presentation'} aria-label={title} aria-hidden={!title}>
      {title && <title>{title}</title>}
      {[8, 12, 16].map((cy) => (
        <React.Fragment key={cy}>
          <circle cx="9" cy={cy} r="1.5" />
          <circle cx="15" cy={cy} r="1.5" />
        </React.Fragment>
      ))}
    </svg>
  );
}

/** Edit. */
export function PencilIcon({ size = 16, title }: IconProps) {
  return (
    <svg {...common} style={box(size)} role={title ? 'img' : 'presentation'} aria-label={title} aria-hidden={!title}>
      {title && <title>{title}</title>}
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z" />
      <path d="M14.5 6.5l3 3" />
    </svg>
  );
}

/** Printer — for the Print action on the bill. */
export function PrinterIcon({ size = 16, title }: IconProps) {
  return (
    <svg {...common} style={box(size)} role={title ? 'img' : 'presentation'} aria-label={title} aria-hidden={!title}>
      {title && <title>{title}</title>}
      <path d="M7 9V4h10v5" />
      <path d="M7 18H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
      <path d="M7 15h10v5H7z" />
    </svg>
  );
}
