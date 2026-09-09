/** Stint longevity — laps run between pit stops, one dither-kit stacked bar
 *  per driver, rendered horizontal: driver rows stack top-to-bottom, laps
 *  run left-to-right within each row. Each stint segment uses the kit's
 *  default fade-toward-the-value-line look (`fadeDirection="value"`, every
 *  other bar chart keeps this too) — the "up"/"down" screen-fade variant
 *  has a normalization bug in bar-canvas.tsx (uses the value-axis backing
 *  length to scale a category-axis row index), which compresses the fade
 *  into a barely-visible range, so this widget doesn't opt into it. The
 *  value fade itself runs continuously across each driver's WHOLE row
 *  (`fadeExtent` on paintRow, dither-paint.ts) rather than resetting solid
 *  at every stint boundary, so one long dissolve reads across all stints
 *  instead of three short, choppy ones. Compound is omitted (not in source
 *  data); segment color is purely ordinal (1st/2nd/3rd... stint), not
 *  identity —
 *  drawn from the kit's darker-reading hues first (blue/pink/grey) since
 *  most races only run 2-3 stints, saving the brighter ones for outlier
 *  strategies. Bloom is hover-gated (`bloomOnHover`) so the glow layer only
 *  redraws while the widget is actually being interacted with, not every
 *  animation frame at rest. Driver identity (team-color dot + code) lives
 *  in an HTML rail to the left of the chart — same swatch/code language as
 *  the driver results heatmap's row header — since the kit's own YAxis
 *  draws the code without a color mark. */
import { useMemo } from "react";
import { AnalyticsCard } from "@/components/ui/AnalyticsCard";
import {
  Bar,
  BarChart,
  BlockLegend,
  type BloomConfig,
  type ChartConfig,
  type DitherColor,
  Grid,
  Tooltip,
  XAxis,
} from "@/components/dither-kit";
import { useChartTheme } from "@/components/charts/theme";
import { usePitStops, useSeasonResults, useSeasonRounds } from "@/lib/queries";
import { useFilters } from "@/state/filters";
import { completedRoundsWithData, focusRound, visibleDriverIds } from "@/features/dashboard/selectors";
import { driverCode, shortRoundName } from "@/lib/format";
import type { SeasonEntities } from "@/features/dashboard/entities";

// Darkest-reading hues first (blue/pink/grey), brighter ones held in
// reserve for the rare 4th/5th+ stint.
const STINT_COLORS: DitherColor[] = ["blue", "pink", "grey", "red", "orange", "purple", "green"];

// Half the kit's "low" bloom preset (blur:3, brightness:1.35, opacity:0.7,
// saturate:1.4) — same soft glow, half as bright.
const BLOOM: BloomConfig = { blur: 3, brightness: 1.175, opacity: 0.35, saturate: 1.2 };

// Chart top/bottom margins, shared with the HTML driver rail below so its
// rows line up with the plot's category bands — left is trimmed from the
// kit's 36px default since category labels now live in the rail, not the
// chart's own YAxis, freeing that width for wider bars.
const MARGINS = { top: 10, right: 20, bottom: 22, left: 12 };

export function TireStints(props: { entities: SeasonEntities; className?: string }) {
  const { filters } = useFilters();
  const { t } = useChartTheme();
  const roundsQuery = useSeasonRounds(filters.year);
  const resultsQuery = useSeasonResults(filters.year, "Race");
  const rounds = useMemo(
    () => completedRoundsWithData(roundsQuery.data?.items, resultsQuery.data?.items),
    [roundsQuery.data, resultsQuery.data],
  );
  const round = focusRound(rounds, filters);
  const roundName = rounds.find((r) => r.number === round)?.name;

  const query = usePitStops(filters.year, round);

  const built = useMemo(() => {
    const rows = query.data?.rows ?? [];
    if (!rows.length) return null;
    const totalLaps =
      (query.data?.metadata.total_laps as number | null) ?? Math.max(...rows.map((r) => r.lap_number ?? 0));
    const visible = visibleDriverIds(props.entities, filters);

    const byDriver = new Map<number, { code: string; name: string; color: string; laps: number[] }>();
    for (const r of rows) {
      if (r.lap_number == null) continue;
      if (visible !== null && !visible.has(r.driver.id)) continue;
      let d = byDriver.get(r.driver.id);
      if (!d) {
        const entity = props.entities.driverById.get(r.driver.id);
        d = {
          code: driverCode(r.driver),
          name: entity?.name ?? `${r.driver.forename ?? ""} ${r.driver.surname ?? ""}`.trim(),
          color: entity?.color ?? t.neutral,
          laps: [],
        };
        byDriver.set(r.driver.id, d);
      }
      d.laps.push(r.lap_number);
    }
    if (!byDriver.size) return null;

    const order = new Map(props.entities.drivers.map((d, i) => [d.id, i]));
    const drivers = [...byDriver.entries()].sort(
      (a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99),
    );

    let maxStints = 0;
    const chartRows = drivers.map(([, d]) => {
      const stopLaps = [...d.laps].sort((a, b) => a - b);
      const stints: number[] = [];
      let start = 0;
      for (const lap of stopLaps) {
        stints.push(lap - start);
        start = lap;
      }
      stints.push(totalLaps - start);
      maxStints = Math.max(maxStints, stints.length);
      const row: Record<string, string | number> = { code: d.code, driverLabel: `${d.code} — ${d.name}` };
      stints.forEach((len, i) => {
        row[`stint${i + 1}`] = len;
      });
      return row;
    });

    const config: ChartConfig = {};
    for (let i = 0; i < maxStints; i++) {
      config[`stint${i + 1}`] = { label: `Stint ${i + 1}`, color: STINT_COLORS[i % STINT_COLORS.length] };
    }

    const driverRail = drivers.map(([id, d]) => ({ id, code: d.code, name: d.name, color: d.color }));

    return { chartRows, config, maxStints, totalLaps, driverRail };
  }, [query.data, filters, props.entities, t.neutral]);

  return (
    <AnalyticsCard
      eyebrow="Race · Pit Stops"
      title="Stint longevity"
      subtitle={round ? `R${round} ${shortRoundName(roundName)} · laps run between stops · compound omitted` : undefined}
      loading={query.isPending || roundsQuery.isPending}
      refreshing={query.isFetching && !query.isPending}
      error={query.error as Error | null}
      onRetry={() => query.refetch()}
      empty={!query.isPending && !query.error && !built}
      emptyText="No pit-stop data for this round."
      expandable
      className={props.className}
      bodyClassName="flex flex-col gap-1.5 p-3"
    >
      {built && (
        <>
          <BlockLegend config={built.config} align="end" className="flex-none" />
          <div className="flex min-h-0 flex-1 gap-2">
            <div
              className="flex w-14 flex-none flex-col"
              style={{ paddingTop: MARGINS.top, paddingBottom: MARGINS.bottom }}
            >
              {built.driverRail.map((d) => (
                <span
                  key={d.id}
                  className="flex flex-1 items-center whitespace-nowrap font-mono text-[13px] font-semibold text-sub"
                >
                  <span aria-hidden className="mr-1.5 inline-block h-2.5 w-2.5 flex-none rounded-full align-middle" style={{ background: d.color }} />
                  {d.code}
                </span>
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <BarChart
                data={built.chartRows}
                config={built.config}
                stackType="stacked"
                orientation="horizontal"
                margins={MARGINS}
                bloom={BLOOM}
                bloomOnHover
              >
                <Grid />
                <XAxis />
                <Tooltip
                  labelKey="driverLabel"
                  valueFormatter={(v, name) => (v > 0 ? `${v} laps · ${built.config[name]?.label ?? name}` : "—")}
                  transition={{ type: "spring", stiffness: 900, damping: 42, mass: 0.4 }}
                />
                {Array.from({ length: built.maxStints }, (_, i) => (
                  <Bar key={i} dataKey={`stint${i + 1}`} variant="gradient" isClickable />
                ))}
              </BarChart>
            </div>
          </div>
        </>
      )}
    </AnalyticsCard>
  );
}
