/** Q1 → Q2 → Q3 lap times for every driver in the focused round. Only final
 *  qualifying position exists in the source data (no per-segment position),
 *  so elimination is inferred from a driver having no time in the next
 *  segment — lines simply stop there instead of carrying a fabricated value. */
import { useMemo, useState } from "react";
import type * as echarts from "echarts";
import type { EChartsOption, LineSeriesOption } from "echarts";
import { AnalyticsCard } from "@/components/ui/AnalyticsCard";
import { EChart } from "@/components/charts/EChart";
import { MONO, useChartTheme } from "@/components/charts/theme";
import { useNearestLineHover } from "@/components/charts/useNearestLineHover";
import { withAlpha } from "@/lib/colors";
import { useQualifyingSegments, useSeasonResults, useSeasonRounds } from "@/lib/queries";
import { useFilters } from "@/state/filters";
import { completedRoundsWithData, focusRound } from "@/features/dashboard/selectors";
import type { SeasonEntities } from "@/features/dashboard/entities";
import { durationToSeconds, driverCode, sanitizeLapSeconds, shortRoundName } from "@/lib/format";

const SEGMENTS = ["Q1", "Q2", "Q3"] as const;

export function QualifyingSegments(props: { entities: SeasonEntities; className?: string }) {
  const { filters } = useFilters();
  const C = useChartTheme();
  const { t, axisLabel, baseTooltip } = C;
  const [chart, setChart] = useState<echarts.ECharts | null>(null);
  useNearestLineHover(chart);

  const roundsQuery = useSeasonRounds(filters.year);
  const resultsQuery = useSeasonResults(filters.year, "Race");
  const rounds = useMemo(
    () => completedRoundsWithData(roundsQuery.data?.items, resultsQuery.data?.items),
    [roundsQuery.data, resultsQuery.data],
  );
  const round = focusRound(rounds, filters);
  const roundName = rounds.find((r) => r.number === round)?.name;

  const query = useQualifyingSegments(filters.year, round);

  const option = useMemo<EChartsOption | null>(() => {
    const visible = filters.driverIds.length || filters.teamIds.length
      ? new Set(
          props.entities.drivers
            .filter((d) => filters.driverIds.includes(d.id) || filters.teamIds.includes(d.teamId))
            .map((d) => d.id),
        )
      : null;
    const rows = (query.data?.rows ?? []).filter(
      (r) => visible === null || visible.has(r.driver.id),
    );
    if (!rows.length) return null;

    const times = rows.map((r) => ({
      code: driverCode(r.driver),
      teamName: r.team.name,
      finalPosition: r.final_position,
      color: props.entities.driverById.get(r.driver.id)?.color ?? t.neutral,
      values: [r.q1_time, r.q2_time, r.q3_time].map((v) => sanitizeLapSeconds(durationToSeconds(v))),
    }));

    const series: LineSeriesOption[] = times
      .sort((a, b) => (a.finalPosition ?? 99) - (b.finalPosition ?? 99))
      .map((r) => ({
        name: r.code,
        type: "line",
        connectNulls: false,
        symbol: "circle",
        symbolSize: 7,
        lineStyle: { width: 2.25, color: r.color, opacity: 0.88 },
        itemStyle: { color: r.color, borderColor: t.surface, borderWidth: 1.5 },
        emphasis: { focus: "series", lineStyle: { width: 3, opacity: 1 } },
        blur: { lineStyle: { opacity: 0.08 }, itemStyle: { opacity: 0.08 }, label: { show: false } },
        endLabel: {
          show: true,
          formatter: () => r.code,
          color: t.labelBright,
          fontFamily: MONO,
          fontSize: 9,
          distance: 8,
          // Every eliminated driver's label lands on the same x (their exit
          // segment), so labels stack densely — a padded pill keeps each one
          // legible against the gridlines and neighboring lines.
          backgroundColor: withAlpha(t.surface, 0.85),
          padding: [1, 4],
          borderRadius: 3,
        },
        labelLayout: { moveOverlap: "shiftY" },
        tooltip: {
          formatter: (p: unknown) => {
            const idx = (p as { dataIndex: number }).dataIndex;
            const val = r.values[idx];
            return C.tip(`${r.code} — ${r.teamName}`, [
              C.tipRow(SEGMENTS[idx], val != null ? `${val.toFixed(3)}s` : "eliminated / no time"),
              C.tipRow("FINAL POS", r.finalPosition != null ? `P${r.finalPosition}` : "—"),
            ]);
          },
        },
        data: r.values,
      }));

    const allValues = times.flatMap((r) => r.values).filter((v): v is number => v != null);
    if (!allValues.length) return null;
    const lo = Math.min(...allValues);
    const hi = Math.max(...allValues);
    const pad = Math.max((hi - lo) * 0.08, 0.2);

    return {
      animationDuration: 300,
      grid: { left: 8, right: 84, top: 20, bottom: 10, containLabel: true },
      tooltip: { ...baseTooltip, trigger: "item" },
      xAxis: {
        type: "category",
        data: [...SEGMENTS],
        boundaryGap: false,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { ...axisLabel, fontSize: 10, fontWeight: 600 },
      },
      yAxis: {
        type: "value",
        inverse: true,
        min: Number((lo - pad).toFixed(1)),
        max: Number((hi + pad).toFixed(1)),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { ...axisLabel, formatter: (v: number) => v.toFixed(1) },
        splitLine: { lineStyle: { color: t.gridLine, width: 1, type: "solid" } },
      },
      series,
    };
  }, [query.data, filters, props.entities, C]);

  return (
    <AnalyticsCard
      eyebrow="Qualifying · Q1 → Q2 → Q3"
      title="Qualifying Segments"
      subtitle={round ? `R${round} ${shortRoundName(roundName)}` : undefined}
      loading={query.isPending || roundsQuery.isPending}
      refreshing={query.isFetching && !query.isPending}
      error={query.error as Error | null}
      onRetry={() => query.refetch()}
      empty={!query.isPending && !query.error && !option}
      emptyText="No qualifying segment times for this round."
      expandable
      className={props.className}
      bodyClassName="p-2"
    >
      {option && <EChart option={option} onChartReady={setChart} />}
    </AnalyticsCard>
  );
}
