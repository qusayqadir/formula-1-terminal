import { AnalyticsCard } from "@/components/ui/AnalyticsCard";
import type { LiveSnapshot, RaceControlCategory } from "../types";

/** FIA race-control message stream, newest first. Each row: session clock,
 *  lap, category chip, message. Category colour is reinforced by the chip
 *  text itself, never colour alone. */

const CATEGORY_STYLE: Record<RaceControlCategory, string> = {
  FLAG: "bg-amber/15 text-amber",
  CLEAR: "bg-pos/15 text-pos",
  DRS: "bg-blue/15 text-blue",
  INVESTIGATION: "bg-neg/15 text-neg",
  "TRACK LIMITS": "bg-ink/10 text-sub",
  PIT: "bg-ink/10 text-sub",
  SESSION: "bg-accent/15 text-accent",
};

function clock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function RaceControlFeed(props: { snapshot: LiveSnapshot; className?: string }) {
  const messages = props.snapshot.raceControl;

  return (
    <AnalyticsCard
      eyebrow="Live · Race Control"
      title="Race control"
      subtitle={`${messages.length} messages · newest first`}
      empty={messages.length === 0}
      emptyText="No race-control messages yet."
      className={props.className}
      bodyClassName="overflow-auto"
    >
      <div className="flex flex-col">
        {messages.map((m) => (
          <div key={m.id} className="flex items-start gap-2 border-b border-stroke/60 px-2.5 py-2 last:border-0">
            <span className="w-16 flex-none pt-px font-mono text-[12.5px] tabular-nums text-mut">{clock(m.atSec)}</span>
            <span className="w-9 flex-none pt-px font-mono text-[12.5px] tabular-nums text-mut">L{m.lap}</span>
            <span
              className={`flex-none rounded-sm px-1 py-px font-mono text-[11px] font-semibold uppercase tracking-wider ${CATEGORY_STYLE[m.category]}`}
            >
              {m.category}
            </span>
            <span className="min-w-0 flex-1 font-mono text-[13px] leading-snug text-ink">{m.text}</span>
          </div>
        ))}
      </div>
    </AnalyticsCard>
  );
}
