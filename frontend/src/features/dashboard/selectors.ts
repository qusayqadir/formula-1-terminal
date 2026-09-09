/** Pure selectors that turn reusable API datasets into widget-ready slices.
 *  Keeping these out of components lets several widgets share one query. */
import type { DashboardFilters } from "@/state/filters";
import type { ChampionshipPoint, Round, SessionResult } from "@/lib/types";
import type { SeasonEntities } from "@/features/dashboard/entities";
import type { RoundOption } from "@/features/dashboard/FilterBar";

/** Distinct rounds present in the season results, ordered. */
export function roundsFromResults(rows: SessionResult[] | undefined): RoundOption[] {
  const seen = new Map<number, string | null>();
  for (const r of rows ?? []) {
    if (r.round_number != null && !seen.has(r.round_number)) seen.set(r.round_number, r.round_name);
  }
  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([number, name]) => ({ number, name }));
}

/** Scheduled rounds that have actually taken place — drops cancelled rounds and
 *  any race still in the future (by date), so a mid-season year (e.g. 2026)
 *  defaults its focus round to the latest completed round instead of an empty
 *  future calendar slot. A complete past season is unaffected (every round is
 *  in the past). Same today/date convention as the Calendar page. */
export function completedRounds(items: Round[] | undefined): RoundOption[] {
  const today = new Date().toISOString().slice(0, 10);
  return (items ?? [])
    .filter((r) => r.number != null && !r.is_cancelled && !(r.date != null && r.date >= today))
    .sort((a, b) => (a.number as number) - (b.number as number))
    .map((r) => ({ number: r.number as number, name: r.name }));
}

/** Completed rounds that also have ingested session data. A round whose date
 *  has passed but whose results haven't been ingested yet (e.g. the newest race,
 *  still mid-pipeline) is dropped, so "Latest" resolves to the newest round the
 *  terminal actually has data for. This keeps every session-level widget on the
 *  same round as the results-driven widgets (which derive their rounds from the
 *  results payload via roundsFromResults) instead of the two families splitting
 *  across different rounds and half the dashboard rendering "no data" states.
 *  Falls back to all date-completed rounds while results are still loading, so
 *  the widgets aren't briefly empty during the initial fetch. */
export function completedRoundsWithData(
  items: Round[] | undefined,
  resultRows: SessionResult[] | undefined,
): RoundOption[] {
  const completed = completedRounds(items);
  const withData = new Set<number>();
  for (const r of resultRows ?? []) {
    if (r.round_number != null) withData.add(r.round_number);
  }
  if (withData.size === 0) return completed;
  return completed.filter((r) => withData.has(r.number));
}

/** The round session-level widgets focus on: explicit selection or latest. */
export function focusRound(rounds: RoundOption[], filters: DashboardFilters): number | null {
  if (filters.round != null) return filters.round;
  return rounds.length ? rounds[rounds.length - 1].number : null;
}

/** Driver-id visibility set implied by global driver/team selections
 *  (union; empty selection = everyone). null means "no restriction". */
export function visibleDriverIds(
  entities: SeasonEntities,
  filters: DashboardFilters,
): Set<number> | null {
  if (filters.driverIds.length === 0 && filters.teamIds.length === 0) return null;
  const ids = new Set<number>(filters.driverIds);
  for (const d of entities.drivers) {
    if (filters.teamIds.includes(d.teamId)) ids.add(d.id);
  }
  return ids;
}

export function inRoundRange(roundNumber: number | null, filters: DashboardFilters): boolean {
  if (roundNumber == null) return false;
  if (filters.roundFrom != null && roundNumber < filters.roundFrom) return false;
  if (filters.roundTo != null && roundNumber > filters.roundTo) return false;
  return true;
}

/** Rows for the focused round only (classification-style widgets). */
export function rowsForRound(rows: SessionResult[] | undefined, round: number | null): SessionResult[] {
  if (round == null) return [];
  return (rows ?? [])
    .filter((r) => r.round_number === round)
    .sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
}

/** Apply round range + entity visibility to season-scope result rows. */
export function filteredSeasonRows(
  rows: SessionResult[] | undefined,
  entities: SeasonEntities,
  filters: DashboardFilters,
): SessionResult[] {
  const visible = visibleDriverIds(entities, filters);
  return (rows ?? []).filter(
    (r) => inRoundRange(r.round_number, filters) && (visible === null || visible.has(r.driver_id)),
  );
}

export function sliceProgression(values: ChampionshipPoint[], filters: DashboardFilters) {
  return values.filter((v) => inRoundRange(v.round_number, filters));
}

/** Result-status buckets derived from the bronze status vocabulary
 *  (is_classified is NULL on every row, so status text is the only truth).
 *  Unknown strings default to mechanical — the car-failure tail is by far
 *  the largest and most varied family. */
export type StatusBucket = "finish" | "incident" | "mechanical" | "other";

const FINISH_RE = /^(Finished|Lapped|\+\d+ Laps?)$/;
const INCIDENT_RE = /^(Collision|Accident|Collision damage|Spun off|Damage|Debris)$/;
const OTHER_RE = /^(Retired|Withdrew|Did not start|Illness|Injury|Disqualified|Excluded)$/;

export function statusBucket(status: string | null): StatusBucket {
  if (status == null) return "other";
  if (FINISH_RE.test(status)) return "finish";
  if (INCIDENT_RE.test(status)) return "incident";
  if (OTHER_RE.test(status)) return "other";
  return "mechanical";
}

/** Linear-interpolated quantile of an ascending-sorted numeric array. */
export function quantileSorted(sorted: number[], p: number): number {
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export const CHAMP_METRICS = {
  points: { label: "Points", key: "points" },
  position: { label: "Position", key: "position" },
  wins: { label: "Wins", key: "win_count" },
  gap: { label: "Gap to leader", key: "gap_to_leader" },
} as const;

export type ChampMetric = keyof typeof CHAMP_METRICS;
