/** Compact entry point into the full Race Replay page — deliberately not a
 *  second copy of PositionsAroundPits' static strategy chart, just a pointer
 *  to the animated lap-by-lap experience, pre-linked to the dashboard's
 *  focused round so it opens exactly where you're already looking. */
import { Link } from "react-router-dom";
import { Rewind } from "lucide-react";
import { AnalyticsCard } from "@/components/ui/AnalyticsCard";
import { useSeasonResults, useSeasonRounds } from "@/lib/queries";
import { useFilters } from "@/state/filters";
import { completedRoundsWithData, focusRound } from "@/features/dashboard/selectors";
import { shortRoundName } from "@/lib/format";

export function RaceReplayPromo(props: { className?: string }) {
  const { filters } = useFilters();
  const query = useSeasonRounds(filters.year);
  const resultsQuery = useSeasonResults(filters.year, "Race");
  const rounds = completedRoundsWithData(query.data?.items, resultsQuery.data?.items);
  const round = focusRound(rounds, filters);
  const roundName = rounds.find((r) => r.number === round)?.name;

  const href = `/race-replay?y=${filters.year}${round ? `&r=${round}` : ""}`;

  return (
    <AnalyticsCard
      eyebrow="Race · Replay"
      title="Watch it lap by lap"
      subtitle={round ? `R${round} ${shortRoundName(roundName)} · ${filters.year}` : String(filters.year)}
      loading={query.isPending}
      empty={!query.isPending && !round}
      emptyText="No rounds available for this season yet."
      className={props.className}
      bodyClassName="flex flex-col items-center justify-center gap-3 p-4 text-center"
    >
      <span className="grid h-11 w-11 flex-none place-items-center rounded-lg border border-stroke bg-raised text-ink">
        <Rewind size={18} strokeWidth={1.7} />
      </span>
      <p className="max-w-56 text-xs leading-relaxed text-sub">
        Animated lap-by-lap standings, position traces and pit stops for the focused round.
      </p>
      <Link
        to={href}
        className="rounded-lg border border-stroke bg-surface px-4 py-2 text-center text-[12.5px] font-medium text-ink transition-colors hover:border-stroke-strong"
      >
        Open Race Replay →
      </Link>
    </AnalyticsCard>
  );
}
