import { useMemo } from "react";
import { AnalyticsCard } from "@/components/ui/AnalyticsCard";
import type { LiveSnapshot } from "../types";

/** I1 / I2 / speed-trap leaderboard, ranked by trap speed on each car's
 *  most recent completed lap — mirrors OpenF1's i1_speed/i2_speed/st_speed
 *  columns your live pipeline already lands (bronze.live_lap). Session-best
 *  in each column gets the purple-equivalent highlight used elsewhere
 *  (blue = session best). */

type TrapKey = "i1Kph" | "i2Kph" | "stKph";

function Column(props: { snapshot: LiveSnapshot; trapKey: TrapKey; label: string }) {
  const rows = useMemo(() => {
    return props.snapshot.drivers
      .filter((d) => d.lastLap != null)
      .map((d) => ({ row: d, value: d.lastLap![props.trapKey] }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 9);
  }, [props.snapshot.drivers, props.trapKey]);

  const best = rows[0]?.value;

  return (
    <div className="flex-1">
      <p className="eyebrow !text-mut pb-1.5">{props.label}</p>
      <div className="flex flex-col gap-1">
        {rows.map(({ row, value }, i) => (
          <div key={row.id} className="flex items-center gap-2">
            <span className="w-4 flex-none font-mono text-[12.5px] tabular-nums text-mut">{i + 1}</span>
            <span aria-hidden className="h-2 w-2 flex-none rounded-[1px]" style={{ background: row.color }} />
            <span className="w-9 flex-none font-sans text-[14px] font-medium text-ink">{row.code}</span>
            <span className="h-1 flex-1 overflow-hidden rounded-full bg-ink/[0.06]">
              <span
                className="block h-full rounded-full"
                style={{ width: `${Math.max(6, (value / (best || 1)) * 100)}%`, background: row.color }}
              />
            </span>
            <span
              className={`w-14 flex-none text-right font-mono text-[13px] tabular-nums ${
                value === best ? "font-semibold text-blue" : "text-sub"
              }`}
            >
              {value.toFixed(1)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SpeedTrapBoard(props: { snapshot: LiveSnapshot; className?: string }) {
  const hasData = props.snapshot.drivers.some((d) => d.lastLap != null);
  return (
    <AnalyticsCard
      eyebrow="Live · Timing"
      title="Speed trap leaderboard"
      subtitle="I1 / I2 / finish straight · kph · most recent lap"
      empty={!hasData}
      emptyText="Waiting for the first completed lap."
      className={props.className}
      bodyClassName="flex gap-3 p-2.5"
    >
      <Column snapshot={props.snapshot} trapKey="i1Kph" label="Intermediate 1" />
      <Column snapshot={props.snapshot} trapKey="i2Kph" label="Intermediate 2" />
      <Column snapshot={props.snapshot} trapKey="stKph" label="Finish straight" />
    </AnalyticsCard>
  );
}
