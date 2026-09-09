/** Running position across every lap of the focused round, one line per
 *  driver. A diamond marks the lap a driver pitted on — reading the line's
 *  shape either side of the marker (dip then climb vs. a clean pass) is how
 *  under/overcuts show up against the field. */
import { useMemo } from "react";
import type { EChartsOption, LineSeriesOption } from "echarts";
import { AnalyticsCard } from "@/components/ui/AnalyticsCard";
import { EChart } from "@/components/charts/EChart";
import { MONO, useChartTheme } from "@/components/charts/theme";
import { withAlpha } from "@/lib/colors";
import { useLapPositions, usePitStops, useSeasonResults, useSeasonRounds } from "@/lib/queries";
import { useFilters } from "@/state/filters";
import { completedRoundsWithData, focusRound, statusBucket, visibleDriverIds } from "@/features/dashboard/selectors";
import { driverCode, shortRoundName } from "@/lib/format";
import type { SeasonEntities } from "@/features/dashboard/entities";

export function PositionsAroundPits(props: { entities: SeasonEntities; className?: string }) {
  const { filters } = useFilters();
  const C = useChartTheme();
  const { t, axisLabel, baseGrid, baseTooltip, valueAxis } = C;

  const roundsQuery = useSeasonRounds(filters.year);
  const resultsQuery = useSeasonResults(filters.year, "Race");
  const rounds = useMemo(
    () => completedRoundsWithData(roundsQuery.data?.items, resultsQuery.data?.items),
    [roundsQuery.data, resultsQuery.data],
  );
  const round = focusRound(rounds, filters);
  const roundName = rounds.find((r) => r.number === round)?.name;

  const lapsQuery = useLapPositions(filters.year, round);
  const stopsQuery = usePitStops(filters.year, round);

  const option = useMemo<EChartsOption | null>(() => {
    const rows = lapsQuery.data?.rows ?? [];
    if (!rows.length) return null;
    const visible = visibleDriverIds(props.entities, filters);

    // Ground truth for "did this driver actually retire" is the results
    // dataset's status, not a gap in lap-position data — a "Lapped" car is
    // fully classified but, being a lap down, its recorded lap data
    // legitimately stops one lap short of the leader's total. Relying on the
    // data gap alone would mislabel every lapped car as a DNF (see
    // RaceReplayPage, which hit the same trap first).
    const statusByDriver = new Map<number, string | null>();
    for (const r of resultsQuery.data?.items ?? []) {
      if (r.round_number === round) statusByDriver.set(r.driver_id, r.status);
    }

    const pitLaps = new Map<number, Set<number>>(); // driverId -> lap numbers
    for (const s of stopsQuery.data?.rows ?? []) {
      if (s.lap_number == null) continue;
      let set = pitLaps.get(s.driver.id);
      if (!set) {
        set = new Set();
        pitLaps.set(s.driver.id, set);
      }
      set.add(s.lap_number);
    }

    const byDriver = new Map<number, { code: string; teamName: string; color: string; dash: "solid" | "dashed" | "dotted"; laps: { lap: number; position: number }[] }>();
    let maxLap = 0;
    for (const r of rows) {
      if (visible !== null && !visible.has(r.driver.id)) continue;
      if (r.position == null) continue;
      maxLap = Math.max(maxLap, r.lap_number);
      let d = byDriver.get(r.driver.id);
      if (!d) {
        const entity = props.entities.driverById.get(r.driver.id);
        d = {
          code: driverCode(r.driver),
          teamName: r.team?.name ?? entity?.teamName ?? "—",
          color: entity?.color ?? t.blue,
          dash: entity?.lineStyle ?? "solid",
          laps: [],
        };
        byDriver.set(r.driver.id, d);
      }
      d.laps.push({ lap: r.lap_number, position: r.position });
    }
    if (!byDriver.size) return null;

    const totalLaps = (lapsQuery.data?.metadata.total_laps as number | null) ?? maxLap;

    const series: LineSeriesOption[] = [...byDriver.entries()].map(([id, d]) => {
      const pits = pitLaps.get(id) ?? new Set<number>();
      const sorted = [...d.laps].sort((a, b) => a.lap - b.lap);
      // Real DNF, not just a lapped classified car (see statusByDriver
      // above) — falls back to the old lap-gap heuristic only if a status
      // is somehow missing for this driver/round.
      const status = statusByDriver.get(id) ?? null;
      const retired =
        status != null
          ? statusBucket(status) !== "finish"
          : sorted.length > 0 && sorted[sorted.length - 1].lap < totalLaps;
      const lastIndex = sorted.length - 1;
      return {
        name: d.code,
        type: "line",
        symbol: "circle",
        symbolSize: 0,
        lineStyle: { width: 1.75, type: d.dash, opacity: 0.85, color: d.color },
        itemStyle: { color: d.color, borderColor: t.surface, borderWidth: 1.5 },
        emphasis: { focus: "series", lineStyle: { width: 3, opacity: 1 } },
        blur: { lineStyle: { opacity: 0.08 }, itemStyle: { opacity: 0.08 }, label: { show: false } },
        endLabel: {
          show: true,
          formatter: retired ? `${d.code} DNF` : d.code,
          color: retired ? t.neg : t.labelBright,
          fontFamily: MONO,
          fontSize: 9,
          fontWeight: retired ? 700 : 400,
          distance: retired ? 10 : 8,
          // Retired drivers end mid-plot, right where the field is busiest —
          // a padded pill keeps the label legible over crossing lines
          // instead of dissolving into them.
          backgroundColor: retired ? withAlpha(t.surface, 0.88) : undefined,
          padding: retired ? [1, 4] : undefined,
          borderRadius: retired ? 3 : undefined,
        },
        labelLayout: { moveOverlap: "shiftY", hideOverlap: false },
        data: sorted.map((v, i) => {
          const isDnf = retired && i === lastIndex;
          const isPit = pits.has(v.lap);
          return {
            value: [v.lap, v.position],
            symbol: isDnf ? "circle" : isPit ? "diamond" : "circle",
            symbolSize: isDnf ? 10 : isPit ? 9 : 0,
            itemStyle: isDnf ? { color: t.neg, borderColor: t.surface, borderWidth: 2 } : undefined,
          };
        }),
        tooltip: {
          formatter: (p: unknown) => {
            const { value, dataIndex } = p as { value: [number, number]; dataIndex: number };
            const isPit = pits.has(value[0]);
            const isDnf = retired && dataIndex === lastIndex;
            return C.tip(`${d.code} — ${d.teamName}`, [
              C.tipRow("LAP", `${value[0]}`),
              C.tipRow("POSITION", `P${value[1]}`),
              ...(isPit ? [C.tipRow("PIT STOP", "yes", { swatch: d.color })] : []),
              ...(isDnf ? [C.tipRow("STATUS", "DNF / Retired", { swatch: t.neg })] : []),
            ]);
          },
        },
      };
    });

    const maxPosition = Math.max(...[...byDriver.values()].flatMap((d) => d.laps.map((l) => l.position)));

    return {
      animationDuration: 300,
      grid: { ...baseGrid, right: 72, top: 20, bottom: 10 },
      tooltip: { ...baseTooltip, trigger: "item" },
      xAxis: valueAxis({
        name: "Lap",
        nameLocation: "middle",
        nameGap: 22,
        nameTextStyle: { color: t.inkSub, fontSize: 9, fontFamily: MONO },
        min: 1,
        max: maxLap,
        minInterval: 1,
      }),
      yAxis: {
        type: "value",
        inverse: true,
        min: 1,
        max: maxPosition,
        minInterval: 1,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { ...axisLabel, formatter: "P{value}" },
        splitLine: { lineStyle: { color: t.gridLine, width: 1, type: "solid" } },
      },
      series,
    };
  }, [lapsQuery.data, stopsQuery.data, resultsQuery.data, round, filters, props.entities, C]);

  return (
    <AnalyticsCard
      eyebrow="Race · Pit Stops"
      title="Position around pit stops"
      subtitle={round ? `R${round} ${shortRoundName(roundName)} · ◆ = pit lap · red = DNF · overcut / undercut swing` : undefined}
      loading={lapsQuery.isPending || roundsQuery.isPending || resultsQuery.isPending}
      refreshing={lapsQuery.isFetching && !lapsQuery.isPending}
      error={(lapsQuery.error as Error | null) ?? (stopsQuery.error as Error | null) ?? (resultsQuery.error as Error | null)}
      onRetry={() => lapsQuery.refetch()}
      empty={!lapsQuery.isPending && !lapsQuery.error && !option}
      emptyText="No lap position data for this round."
      expandable
      className={props.className}
      bodyClassName="p-2"
    >
      {option && <EChart option={option} />}
    </AnalyticsCard>
  );
}
