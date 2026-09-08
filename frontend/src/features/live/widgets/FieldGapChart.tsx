import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { AnalyticsCard } from "@/components/ui/AnalyticsCard";
import { EChart } from "@/components/charts/EChart";
import { useChartTheme } from "@/components/charts/theme";
import { withAlpha } from "@/lib/colors";
import type { LiveSnapshot } from "../types";

/** Whole-field "how close is the pack" view: one bar per car, length = the
 *  live interval to the car directly ahead. Answers at a glance where the
 *  bunching is and who's under immediate attack — BattleSparklines then
 *  gives the handful of closest pairs a trend line, this gives the shape
 *  of the entire field in one read. Bars are capped at a display ceiling
 *  so one lapped car's huge gap doesn't crush every close fight into
 *  invisible slivers; anything past it is marked, not hidden. */

const DISPLAY_CEILING_SEC = 3;
const BATTLE_THRESHOLD_SEC = 1;

export function FieldGapChart(props: { snapshot: LiveSnapshot; className?: string }) {
  const { snapshot } = props;
  const C = useChartTheme();
  const { t } = C;

  const option = useMemo<EChartsOption | null>(() => {
    const running = snapshot.drivers.filter((d) => d.status !== "RETIRED" && d.intervalSec != null);
    if (!running.length) return null;
    // leader has no "ahead" — keep them in the list at 0 for a continuous field read
    const rows = snapshot.drivers.filter((d) => d.status !== "RETIRED");

    const categories = rows.map((d) => `P${d.position} ${d.code}`);
    const values = rows.map((d) => {
      const raw = d.intervalSec ?? 0;
      return Math.min(raw, DISPLAY_CEILING_SEC);
    });

    return {
      animation: false,
      grid: { left: 64, right: 40, top: 4, bottom: 4 },
      tooltip: {
        ...C.baseTooltip,
        trigger: "item",
        formatter: (p: unknown) => {
          const { dataIndex } = p as { dataIndex: number };
          const d = rows[dataIndex];
          const ahead = rows[dataIndex - 1];
          if (!ahead) return C.tip(`P${d.position} ${d.code}`, [C.tipRow("GAP", "leader", { swatch: d.color })]);
          const real = d.intervalSec ?? 0;
          return C.tip(`P${d.position} ${d.code}`, [
            C.tipRow("AHEAD", `P${ahead.position} ${ahead.code}`, { swatch: ahead.color }),
            C.tipRow("INTERVAL", `+${real.toFixed(3)}s`, { swatch: d.color }),
          ]);
        },
      },
      xAxis: C.valueAxis({
        max: DISPLAY_CEILING_SEC,
        axisLabel: { ...C.axisLabel, formatter: (v: number) => (v >= DISPLAY_CEILING_SEC ? `${v}s+` : `${v}s`) },
      }),
      yAxis: C.categoryAxis(categories, { inverse: true }),
      series: [
        {
          type: "bar",
          barWidth: "62%",
          data: rows.map((d, i) => {
            const real = d.intervalSec ?? 0;
            const battling = i > 0 && real < BATTLE_THRESHOLD_SEC;
            return {
              value: values[i],
              itemStyle: {
                color: battling ? d.color : withAlpha(d.color, 0.55),
                borderColor: battling ? t.neg : "transparent",
                borderWidth: battling ? 1.5 : 0,
              },
            };
          }),
          label: {
            show: true,
            position: "right",
            formatter: (p: { dataIndex: number }) => {
              const d = rows[p.dataIndex];
              if (p.dataIndex === 0) return "LEADER";
              const real = d.intervalSec ?? 0;
              return real >= DISPLAY_CEILING_SEC ? `+${real.toFixed(1)}s` : `+${real.toFixed(3)}`;
            },
            color: t.inkSub,
            fontFamily: "JetBrains Mono Variable, monospace",
            fontSize: 12,
          },
        },
      ],
    };
  }, [snapshot.drivers, C, t]);

  return (
    <AnalyticsCard
      eyebrow="Live · Race"
      title="Field gap chart"
      subtitle={`interval to car ahead · red outline = battle (<${BATTLE_THRESHOLD_SEC.toFixed(0)}s) · capped at ${DISPLAY_CEILING_SEC}s`}
      empty={!option}
      emptyText="No timing data yet."
      expandable
      className={props.className}
      bodyClassName="p-2"
    >
      {option && <EChart option={option} />}
    </AnalyticsCard>
  );
}
