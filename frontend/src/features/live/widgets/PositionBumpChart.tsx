import { useMemo } from "react";
import type { EChartsOption, LineSeriesOption } from "echarts";
import { AnalyticsCard } from "@/components/ui/AnalyticsCard";
import { EChart } from "@/components/charts/EChart";
import { MONO, useChartTheme } from "@/components/charts/theme";
import { compareColor } from "../compareColors";
import type { LiveSnapshot } from "../types";

/** Live position-vs-lap bump chart, all 20 cars — the classification's
 *  shape over the whole race at a glance, same construction as the
 *  historical dashboard's BumpChart / Race Replay's position trace, just
 *  fed by the live engine's per-lap capture instead of the bronze lap
 *  table. Selected (compared) drivers get a thicker line + persistent
 *  end-label; the rest recede on hover via ECharts' series focus/blur. */

export function PositionBumpChart(props: {
  snapshot: LiveSnapshot;
  selectedIds: [number | null, number | null];
  className?: string;
}) {
  const { snapshot, selectedIds } = props;
  const C = useChartTheme();
  const { t } = C;

  const option = useMemo<EChartsOption | null>(() => {
    const history = snapshot.positionHistory;
    if (history.length < 2) return null;

    const byDriver = new Map<number, [number, number][]>();
    for (const entry of history) {
      entry.order.forEach((driverId, idx) => {
        let pts = byDriver.get(driverId);
        if (!pts) {
          pts = [];
          byDriver.set(driverId, pts);
        }
        pts.push([entry.lap, idx + 1]);
      });
    }

    const maxPosition = Math.max(...history.map((h) => h.order.length));
    const driverA = snapshot.drivers.find((d) => d.id === selectedIds[0]);
    const driverB = snapshot.drivers.find((d) => d.id === selectedIds[1]);
    const series: LineSeriesOption[] = [...byDriver.entries()].map(([driverId, points]) => {
      const row = snapshot.drivers.find((d) => d.id === driverId);
      const selected = selectedIds.includes(driverId);
      // team-mates share an identity colour — B gets lightened so both
      // highlighted lines stay distinguishable when overlaid
      const color = row && driverId === driverB?.id && driverA ? compareColor("b", driverA, driverB) : row?.color ?? t.neutral;
      return {
        name: row?.code ?? String(driverId),
        type: "line",
        symbol: "circle",
        symbolSize: 0,
        lineStyle: { width: selected ? 3 : 1.25, opacity: selected ? 1 : 0.55, color },
        itemStyle: { color, borderColor: t.surface, borderWidth: 1.5 },
        emphasis: { focus: "series", lineStyle: { width: 3.5, opacity: 1 } },
        blur: { lineStyle: { opacity: 0.06 }, itemStyle: { opacity: 0.06 }, label: { show: false } },
        z: selected ? 10 : 1,
        endLabel: {
          show: true,
          formatter: row?.code ?? "",
          color: selected ? t.labelBright : t.inkMut,
          fontFamily: MONO,
          fontSize: selected ? 10 : 8.5,
          fontWeight: selected ? 700 : 400,
          distance: 8,
        },
        labelLayout: { moveOverlap: "shiftY", hideOverlap: false },
        data: points,
      };
    });

    return {
      animation: false,
      grid: { ...C.baseGrid, left: 36, right: 44, top: 14, bottom: 8 },
      tooltip: {
        ...C.baseTooltip,
        trigger: "item",
        formatter: (p: unknown) => {
          const { seriesName, value, color } = p as { seriesName: string; value: [number, number]; color: string };
          return C.tip(null, [
            C.tipRow("LAP", `${value[0]}`, { swatch: color }),
            C.tipRow(seriesName, `P${value[1]}`),
          ]);
        },
      },
      xAxis: C.valueAxis({ min: 1, max: history[history.length - 1].lap, minInterval: 1 }),
      yAxis: {
        type: "value",
        inverse: true,
        min: 1,
        max: maxPosition,
        minInterval: 1,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { ...C.axisLabel, formatter: "P{value}" },
        splitLine: { lineStyle: { color: t.gridLine, width: 1, type: "solid" } },
      },
      series,
    };
  }, [snapshot, selectedIds, C, t]);

  return (
    <AnalyticsCard
      eyebrow="Live · Race"
      title="Position bump chart"
      subtitle="every car · classification vs. lap · live"
      empty={!option}
      emptyText="Waiting for the leader to complete a lap."
      expandable
      className={props.className}
      bodyClassName="p-2"
    >
      {option && <EChart option={option} />}
    </AnalyticsCard>
  );
}
