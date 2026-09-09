/** Q1/Q2/Q3 times table for the focused round — times only, no grid/points/
 *  laps/status (those fields don't exist at qualifying-segment grain). Gap
 *  is each driver's last valid segment time (their final effort, whichever
 *  segment it landed in) vs. the pole time. */
import { useMemo } from "react";
import { AnalyticsCard } from "@/components/ui/AnalyticsCard";
import { useChartTheme } from "@/components/charts/theme";
import { useQualifyingSegments, useSeasonResults, useSeasonRounds } from "@/lib/queries";
import { useFilters } from "@/state/filters";
import { completedRoundsWithData, focusRound, visibleDriverIds } from "@/features/dashboard/selectors";
import type { SeasonEntities } from "@/features/dashboard/entities";
import { driverCode, durationToSeconds, formatGap, formatLapTime, sanitizeLapSeconds, shortRoundName } from "@/lib/format";

/** Best-in-segment time, driven by the same source data every other segment
 *  tooltip reads — kept alongside the pole time since neither is exposed by
 *  the API directly (only final position is). */
function bestOf(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v != null);
  return valid.length ? Math.min(...valid) : null;
}

/** Q1/Q2/Q3 cell content + hover detail — same frosted-glass card language as
 *  every ECharts tooltip (see useChartTheme's tip/tipRow), reimplemented in
 *  plain DOM since this is a native <table>, not a chart. Adds the one thing
 *  the table's columns don't already show: gap to that segment's fastest,
 *  not just the final gap-to-pole in the last column. */
function SegmentCell(props: {
  time: number | null;
  best: number | null;
  label: string;
  code: string;
  team: string;
  swatch: string;
}) {
  const gap = props.time != null && props.best != null ? props.time - props.best : null;
  return (
    <span className="group relative inline-block">
      {formatLapTime(props.time)}
      {props.time != null && (
        <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-ink/20 bg-raised/75 px-2 py-1.5 text-left shadow-[0_1px_2px_rgba(0,0,0,0.1)] backdrop-blur-sm group-hover:block">
          <div className="mb-0.5 font-mono text-[10px] text-sub">
            {props.code} — {props.team}
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-ink">
              <span className="h-2 w-2 flex-none rounded-[1px]" style={{ background: props.swatch }} aria-hidden />
              <span className="text-sub">{props.label}</span>
              <span className="ml-auto pl-2 text-ink">{formatLapTime(props.time)}</span>
            </div>
            <div className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-ink">
              <span className="h-2 w-2 flex-none" aria-hidden />
              <span className="text-sub">GAP TO FASTEST</span>
              <span className="ml-auto pl-2 text-ink">{formatGap(gap)}</span>
            </div>
          </div>
        </span>
      )}
    </span>
  );
}

export function QualifyingSegmentsTable(props: { entities: SeasonEntities; className?: string }) {
  const { filters, toggleDriver } = useFilters();
  const { t } = useChartTheme();

  const roundsQuery = useSeasonRounds(filters.year);
  const resultsQuery = useSeasonResults(filters.year, "Race");
  const rounds = useMemo(
    () => completedRoundsWithData(roundsQuery.data?.items, resultsQuery.data?.items),
    [roundsQuery.data, resultsQuery.data],
  );
  const round = focusRound(rounds, filters);
  const roundName = rounds.find((r) => r.number === round)?.name;

  const query = useQualifyingSegments(filters.year, round);

  const rows = useMemo(() => {
    const visible = visibleDriverIds(props.entities, filters);
    const built = (query.data?.rows ?? [])
      .filter((r) => visible === null || visible.has(r.driver.id))
      .map((r) => {
        const q1 = sanitizeLapSeconds(durationToSeconds(r.q1_time));
        const q2 = sanitizeLapSeconds(durationToSeconds(r.q2_time));
        const q3 = sanitizeLapSeconds(durationToSeconds(r.q3_time));
        return { ...r, q1, q2, q3, finalTime: q3 ?? q2 ?? q1 };
      })
      .sort((a, b) => (a.final_position ?? 99) - (b.final_position ?? 99));
    const pole = built.find((r) => r.final_position === 1)?.finalTime ?? built[0]?.finalTime ?? null;
    const q1Best = bestOf(built.map((r) => r.q1));
    const q2Best = bestOf(built.map((r) => r.q2));
    const q3Best = bestOf(built.map((r) => r.q3));
    return { built, pole, q1Best, q2Best, q3Best };
  }, [query.data, filters, props.entities]);

  return (
    <AnalyticsCard
      eyebrow="Qualifying · Segment times"
      title="Q1 / Q2 / Q3 Times"
      subtitle={round ? `R${round} ${shortRoundName(roundName)}` : undefined}
      loading={query.isPending || roundsQuery.isPending}
      refreshing={query.isFetching && !query.isPending}
      error={query.error as Error | null}
      onRetry={() => query.refetch()}
      empty={!query.isPending && !query.error && rows.built.length === 0}
      emptyText="No qualifying segment times for this round."
      expandable
      className={props.className}
      bodyClassName="overflow-auto"
    >
      <table className="w-full min-w-[520px] border-collapse font-mono text-[12px] tabular-nums">
        <thead className="sticky top-0 z-10 bg-surface">
          <tr className="border-b border-stroke text-left">
            {["POS", "DRIVER", "TEAM", "Q1", "Q2", "Q3", "GAP"].map((label, i) => (
              <th
                key={label}
                className={`whitespace-nowrap px-3 py-2.5 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-mut ${
                  i >= 3 ? "text-right" : ""
                }`}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.built.map((r) => {
            const driver = props.entities.driverById.get(r.driver.id);
            const selected = filters.driverIds.includes(r.driver.id);
            const gap = r.finalTime != null && rows.pole != null ? r.finalTime - rows.pole : null;
            return (
              <tr
                key={r.driver.id}
                onClick={() => toggleDriver(r.driver.id)}
                title="Toggle driver filter"
                className={`cursor-pointer border-b border-stroke/60 transition-colors last:border-0 hover:bg-ink/[0.05] ${
                  selected ? "bg-accent/[0.07]" : ""
                }`}
              >
                <td className="px-3 py-2">
                  <span className={`font-semibold ${r.final_position === 1 ? "text-accent" : "text-ink"}`}>
                    {r.final_position != null ? `P${r.final_position}` : "—"}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  <span className="mr-2 inline-block h-2.5 w-2.5 rounded-[2px] align-middle" style={{ background: driver?.color ?? t.neutral }} aria-hidden />
                  <span className="font-sans font-medium text-ink">{driver?.code ?? driverCode(r.driver)}</span>
                </td>
                <td className="max-w-32 truncate whitespace-nowrap px-3 py-2 font-sans text-sub">{r.team.name}</td>
                <td className="px-3 py-2 text-right text-sub">
                  <SegmentCell
                    time={r.q1}
                    best={rows.q1Best}
                    label="Q1"
                    code={driver?.code ?? driverCode(r.driver)}
                    team={r.team.name}
                    swatch={driver?.color ?? t.neutral}
                  />
                </td>
                <td className="px-3 py-2 text-right text-sub">
                  <SegmentCell
                    time={r.q2}
                    best={rows.q2Best}
                    label="Q2"
                    code={driver?.code ?? driverCode(r.driver)}
                    team={r.team.name}
                    swatch={driver?.color ?? t.neutral}
                  />
                </td>
                <td className="px-3 py-2 text-right text-sub">
                  <SegmentCell
                    time={r.q3}
                    best={rows.q3Best}
                    label="Q3"
                    code={driver?.code ?? driverCode(r.driver)}
                    team={r.team.name}
                    swatch={driver?.color ?? t.neutral}
                  />
                </td>
                <td className={`px-3 py-2 text-right ${r.final_position === 1 ? "text-accent" : "text-sub"}`}>
                  {gap != null ? formatGap(gap) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </AnalyticsCard>
  );
}
