import { Fragment, useMemo } from "react";
import { AnalyticsCard } from "@/components/ui/AnalyticsCard";
import { useChartTheme } from "@/components/charts/theme";
import { isDarkFill, seqColor, withAlpha } from "@/lib/colors";
import type { LiveSnapshot } from "../types";

/** Who-passed-whom heatmap. Rows = the car making the pass, columns = the
 *  car being passed; cell = count so far. Capped to the most active drivers
 *  (by combined overtakes made + suffered) — a full 20×20 grid is illegible
 *  at widget scale, and the long tail of drivers with zero involvement adds
 *  nothing. Fill follows the documented heatmap convention: sqrt-eased
 *  intensity (skewed count distributions), contrast-picked text via
 *  isDarkFill on strong cells, translucent wash + ink text on weak ones. */

const MAX_DRIVERS = 6;

export function OvertakeMatrix(props: { snapshot: LiveSnapshot; className?: string }) {
  const { snapshot } = props;
  const { t } = useChartTheme();

  const built = useMemo(() => {
    if (!snapshot.overtakes.length) return null;
    const counts = new Map<string, number>();
    const involvement = new Map<number, number>();
    for (const ev of snapshot.overtakes) {
      const key = `${ev.passingDriverId}|${ev.passedDriverId}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      involvement.set(ev.passingDriverId, (involvement.get(ev.passingDriverId) ?? 0) + 1);
      involvement.set(ev.passedDriverId, (involvement.get(ev.passedDriverId) ?? 0) + 1);
    }
    const ids = [...involvement.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_DRIVERS)
      .map(([id]) => id);
    if (ids.length < 2) return null;

    const rows = ids.map((passerId) => {
      const passer = snapshot.drivers.find((d) => d.id === passerId);
      const cells = ids.map((passedId) => {
        if (passedId === passerId) return null;
        return counts.get(`${passerId}|${passedId}`) ?? 0;
      });
      return { id: passerId, code: passer?.code ?? "—", color: passer?.color ?? t.neutral, cells };
    });
    const maxCount = Math.max(1, ...[...counts.values()]);
    const totalOvertakes = snapshot.overtakes.length;
    return { rows, maxCount, totalOvertakes, omitted: involvement.size - ids.length };
  }, [snapshot.overtakes, snapshot.drivers, t.neutral]);

  return (
    <AnalyticsCard
      eyebrow="Live · Race"
      title="Overtake matrix"
      subtitle={built ? `${built.totalOvertakes} passes so far · rows passed columns` : "no overtakes yet"}
      empty={!built}
      emptyText="No on-track passes recorded yet this session."
      className={props.className}
      bodyClassName="flex flex-col gap-1.5 overflow-auto p-2.5"
    >
      {built && (
        <>
          <div
            className="grid gap-[3px]"
            style={{ gridTemplateColumns: `44px repeat(${built.rows.length}, 1fr)` }}
          >
            <span />
            {built.rows.map((r) => (
              <span
                key={r.id}
                className="flex items-center justify-center gap-1 pb-1 font-mono text-[11px] font-semibold text-mut"
              >
                <span aria-hidden className="h-1.5 w-1.5 rounded-[1px]" style={{ background: r.color }} />
                {r.code}
              </span>
            ))}
            {built.rows.map((row) => (
              <Fragment key={row.id}>
                <span
                  key={`label-${row.id}`}
                  className="flex h-9 items-center justify-end gap-1 pr-1.5 font-mono text-[11px] font-semibold text-mut"
                >
                  {row.code}
                  <span aria-hidden className="h-1.5 w-1.5 rounded-[1px]" style={{ background: row.color }} />
                </span>
                {row.cells.map((count, ci) => {
                  if (count == null) {
                    return <div key={ci} className="h-9 rounded-[3px] bg-ink/[0.04]" />;
                  }
                  const frac = Math.sqrt(count / built.maxCount);
                  const fill = count === 0 ? withAlpha(t.ink, 0.05) : seqColor(frac, t.seqRamp);
                  const textColor = count === 0 ? t.inkMut : isDarkFill(fill) ? t.heatLabel : t.ink;
                  return (
                    <div
                      key={ci}
                      title={`${row.code} passed ${built.rows.find((_, k) => k === ci)?.code ?? ""}: ${count}×`}
                      className="flex h-9 items-center justify-center rounded-[3px] font-mono text-[14px] font-semibold tabular-nums"
                      style={{ background: fill, color: textColor }}
                    >
                      {count > 0 ? count : ""}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
          <p className="mt-auto font-mono text-[11px] text-mut">
            Row passed column, count = times so far.
            {built.omitted > 0 ? ` ${built.omitted} less-active driver${built.omitted === 1 ? "" : "s"} omitted.` : ""}
          </p>
        </>
      )}
    </AnalyticsCard>
  );
}
