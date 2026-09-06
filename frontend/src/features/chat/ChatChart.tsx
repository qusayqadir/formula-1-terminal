/** ChatChart — renders a data-viz subgraph ChartSpec (dict) + its query rows
 *  as a terminal-styled ECharts chart inside the chat thread.
 *
 *  The spec is declarative (chart_type + x_field / y_fields / series_field /
 *  color_by), mirroring the dashboard's chart vocabulary, so this builder
 *  reuses the exact same chrome (useChartTheme helpers) and identity colors
 *  (teamColor / seqColor / fallbackSeries) rather than inventing its own —
 *  a chat chart should be indistinguishable from a dashboard widget. */
import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { EChart } from "@/components/charts/EChart";
import { useChartTheme, MONO, type ChartChrome } from "@/components/charts/theme";
import { teamColor, seqColor, withAlpha } from "@/lib/colors";

export interface ChatChartSpec {
  chart_type: "bar" | "grouped_bar" | "stacked_bar" | "line" | "area" | "scatter" | "pie";
  title: string;
  subtitle?: string | null;
  x_field: string;
  y_fields: string[];
  series_field?: string | null;
  x_label?: string | null;
  y_label?: string | null;
  color_by?: "team" | "driver" | "categorical" | "sequential";
}

export type ChatChartRow = Record<string, unknown>;

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function fmt(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return Number.isInteger(v)
    ? v.toLocaleString()
    : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function uniq(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of arr) if (!seen.has(v)) (seen.add(v), out.push(v));
  return out;
}

/** teamColor caches by numeric id; chat rows carry no id, so derive a stable
 *  one from the label. Franchise names still hit TEAM_COLOR_PATTERNS first. */
function stableId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function seriesColor(
  name: string,
  index: number,
  count: number,
  colorBy: ChatChartSpec["color_by"],
  C: ChartChrome,
): string {
  if (colorBy === "team" || colorBy === "driver") {
    // No team affiliation is available in chat rows, so identity comes from the
    // name alone: teamColor pattern-matches franchise names, else cycles the
    // CVD-safe fallback pool keyed by a stable synthetic id.
    return teamColor({ id: stableId(name), name });
  }
  if (colorBy === "sequential") {
    return seqColor(count > 1 ? index / (count - 1) : 1, C.t.seqRamp);
  }
  return C.t.fallbackSeries[index % C.t.fallbackSeries.length];
}

function buildOption(
  spec: ChatChartSpec,
  rows: ChatChartRow[],
  C: ChartChrome,
): EChartsOption | null {
  if (!rows.length || !spec.x_field || !spec.y_fields?.length) return null;

  const isArea = spec.chart_type === "area";
  const isLine = spec.chart_type === "line" || isArea;
  const isStacked = spec.chart_type === "stacked_bar" || isArea;

  // ── pie ───────────────────────────────────────────────────────────────
  if (spec.chart_type === "pie") {
    const y = spec.y_fields[0];
    const data = rows.map((r, i) => {
      const name = String(r[spec.x_field] ?? "—");
      return {
        name,
        value: num(r[y]),
        itemStyle: { color: seriesColor(name, i, rows.length, spec.color_by, C) },
      };
    });
    return {
      tooltip: {
        ...C.baseTooltip,
        trigger: "item",
        formatter: (p: any) =>
          C.tip(p.name, [C.tipRow(spec.y_label ?? y, fmt(p.value), { swatch: p.color })]),
      },
      series: [
        {
          type: "pie",
          radius: ["45%", "72%"],
          data,
          label: { color: C.t.inkSub, fontFamily: MONO, fontSize: 10 },
          labelLine: { lineStyle: { color: C.t.axisLine } },
        },
      ],
    };
  }

  // ── scatter (numeric x vs y) ────────────────────────────────────────────
  if (spec.chart_type === "scatter") {
    const y = spec.y_fields[0];
    const data = rows.map((r) => [num(r[spec.x_field]), num(r[y])]);
    return {
      grid: C.baseGrid,
      tooltip: {
        ...C.baseTooltip,
        trigger: "item",
        formatter: (p: any) =>
          C.tip(null, [
            C.tipRow(spec.x_label ?? spec.x_field, fmt(p.value[0])),
            C.tipRow(spec.y_label ?? y, fmt(p.value[1]), { swatch: p.color }),
          ]),
      },
      xAxis: C.valueAxis({ scale: true }),
      yAxis: C.valueAxis(),
      series: [{ type: "scatter", symbolSize: 8, itemStyle: { color: C.t.blue }, data }],
    };
  }

  // ── category-based bar / line / area (optional series_field pivot) ──────
  let categories: string[];
  let seriesInputs: { name: string; data: number[] }[];

  if (spec.series_field) {
    const xVals = uniq(rows.map((r) => String(r[spec.x_field] ?? "—")));
    const sVals = uniq(rows.map((r) => String(r[spec.series_field!] ?? "—")));
    const y = spec.y_fields[0];
    const lookup = new Map<string, number>();
    for (const r of rows) {
      lookup.set(`${r[spec.x_field]}||${r[spec.series_field!]}`, num(r[y]));
    }
    categories = xVals;
    seriesInputs = sVals.map((s) => ({
      name: s,
      data: xVals.map((x) => lookup.get(`${x}||${s}`) ?? 0),
    }));
  } else {
    categories = rows.map((r) => String(r[spec.x_field] ?? "—"));
    seriesInputs = spec.y_fields.map((f) => ({ name: f, data: rows.map((r) => num(r[f])) }));
  }

  const count = seriesInputs.length;
  const series = seriesInputs.map((s, i) => {
    const color = seriesColor(s.name, i, count, spec.color_by, C);
    if (isLine) {
      return {
        name: s.name,
        type: "line" as const,
        data: s.data,
        symbol: "circle",
        symbolSize: 5,
        showSymbol: s.data.length <= 40,
        lineStyle: { width: 2, color },
        itemStyle: { color },
        ...(isArea
          ? { areaStyle: { color: withAlpha(color, 0.18) }, stack: isStacked ? "total" : undefined }
          : {}),
      };
    }
    return {
      name: s.name,
      type: "bar" as const,
      data: s.data,
      itemStyle: { color, borderRadius: [2, 2, 0, 0] as [number, number, number, number] },
      barMaxWidth: 22,
      ...(isStacked ? { stack: "total" } : {}),
    };
  });

  const multi = count > 1;
  return {
    grid: { ...C.baseGrid, bottom: multi ? 22 : 4 },
    legend: multi ? C.legendStyle : undefined,
    tooltip: {
      ...C.baseTooltip,
      trigger: "axis",
      formatter: (params: any) => {
        const arr = Array.isArray(params) ? params : [params];
        const head = arr[0]?.axisValueLabel ?? arr[0]?.name ?? "";
        return C.tip(
          String(head),
          arr.map((p: any) => C.tipRow(p.seriesName ?? "", fmt(p.value), { swatch: p.color })),
        );
      },
    },
    xAxis: C.categoryAxis(categories, {
      axisLabel: { ...C.axisLabel, rotate: categories.length > 8 ? 35 : 0 },
    }),
    yAxis: C.valueAxis(),
    series,
  };
}

export function ChatChart({ spec, data }: { spec: ChatChartSpec; data: ChatChartRow[] }) {
  const C = useChartTheme();
  const option = useMemo(() => buildOption(spec, data, C), [spec, data, C]);
  if (!option) return null;

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-stroke bg-surface shadow-[var(--shadow-card)]">
      <div className="flex items-start gap-2 border-b border-stroke px-3 py-2">
        <span aria-hidden className="mt-1 h-2.5 w-[3px] flex-none -skew-x-12 bg-accent" />
        <div className="min-w-0">
          <p className="eyebrow !text-mut">Data · Chart</p>
          <p className="truncate text-[13px] font-semibold tracking-tight text-ink">{spec.title}</p>
          {spec.subtitle && <p className="mt-0.5 text-[11px] text-sub">{spec.subtitle}</p>}
        </div>
      </div>
      <div className="p-2">
        <EChart option={option} className="h-[300px] w-full" />
      </div>
    </div>
  );
}
