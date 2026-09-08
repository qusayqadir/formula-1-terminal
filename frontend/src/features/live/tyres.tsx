/** Tyre-compound identity for the live widgets. Hexes are reused from the
 *  validated chart token set (colors.ts) — no new colors are introduced;
 *  the single-letter code always accompanies the ring, so compound is
 *  never encoded by color alone. */

import { CHART_DARK } from "@/lib/colors";
import type { TyreCompound } from "./types";

export const TYRE: Record<TyreCompound, { letter: string; color: string }> = {
  SOFT: { letter: "S", color: CHART_DARK.accent }, // #e5484d
  MEDIUM: { letter: "M", color: "#c98500" }, // fallbackSeries amber slot
  HARD: { letter: "H", color: CHART_DARK.labelBright },
  INTER: { letter: "I", color: "#199e70" }, // fallbackSeries green slot
  WET: { letter: "W", color: CHART_DARK.blue },
};

/** Pirelli-style compound marker: colored ring + letter, always circular. */
export function TyreBadge(props: { compound: TyreCompound; size?: number }) {
  const t = TYRE[props.compound];
  const size = props.size ?? 16;
  return (
    <span
      title={props.compound}
      aria-label={`${props.compound.toLowerCase()} tyre`}
      className="grid flex-none place-items-center rounded-full border-2 font-mono font-bold leading-none"
      style={{ width: size, height: size, borderColor: t.color, color: t.color, fontSize: Math.round(size * 0.48) }}
    >
      {t.letter}
    </span>
  );
}
