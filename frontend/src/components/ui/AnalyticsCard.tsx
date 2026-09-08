import { useEffect, useState, type ReactNode } from "react";
import { Maximize2, RotateCcw, X } from "lucide-react";

interface Props {
  eyebrow: string;
  title: string;
  subtitle?: string;
  /** compact local controls rendered in the header (metric toggles etc.) */
  controls?: ReactNode;
  loading?: boolean;
  /** previous data is on screen while a refetch runs — dim, don't skeleton */
  refreshing?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  empty?: boolean;
  emptyText?: string;
  expandable?: boolean;
  /** Fires whenever the fullscreen modal opens/closes. For widgets that own
   *  an imperative resource keyed to their container (e.g. a Google Maps
   *  instance) — the modal is a SECOND mount of `children`, not a resize of
   *  the compact one, so a widget that needs exactly one live instance can
   *  use this to tear its compact copy down while the modal is open. */
  onExpandedChange?: (expanded: boolean) => void;
  className?: string;
  bodyClassName?: string;
  /** Plain node, or a render function that receives whether the card is
   *  currently showing in the fullscreen expanded view — for widgets that
   *  need to scale up text/marks so they still read well at that size
   *  (e.g. a chart's label fontSize). */
  children: ReactNode | ((fullscreen: boolean) => ReactNode);
}

/** Shared shell for every analytical widget: eyebrow + title header, local
 *  controls, loading/error/empty states, optional fullscreen expansion. */
export function AnalyticsCard(props: Props) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    props.onExpandedChange?.(expanded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setExpanded(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [expanded]);

  const body = (fullscreen: boolean) =>
    props.loading ? (
      <div className="flex h-full min-h-24 flex-col gap-2 p-3">
        <div className="skeleton h-3 w-1/3 rounded" />
        <div className="skeleton min-h-16 flex-1 rounded" />
      </div>
    ) : props.error ? (
      <div className="flex h-full min-h-24 flex-col items-center justify-center gap-2 p-4 text-center">
        <p className="text-xs text-sub">Couldn’t load this dataset — {props.error.message}</p>
        {props.onRetry && (
          <button
            onClick={props.onRetry}
            className="flex items-center gap-1.5 rounded-md border border-stroke bg-raised px-2.5 py-1 text-xs text-ink transition-colors hover:border-stroke-strong"
          >
            <RotateCcw size={11} /> Retry
          </button>
        )}
      </div>
    ) : props.empty ? (
      <div className="flex h-full min-h-24 items-center justify-center p-4">
        <p className="max-w-64 text-center text-xs leading-relaxed text-mut">
          {props.emptyText ?? "No data for the current filters. Widen the selection to see results."}
        </p>
      </div>
    ) : typeof props.children === "function" ? (
      props.children(fullscreen)
    ) : (
      props.children
    );

  const card = (fullscreen: boolean) => (
    <section
      className={
        fullscreen
          ? "flex h-full flex-col overflow-hidden rounded-xl border border-stroke-strong bg-surface"
          : `flex flex-col overflow-hidden rounded-xl border border-stroke bg-surface shadow-[var(--shadow-card)] transition-colors hover:border-stroke-strong ${props.className ?? ""}`
      }
      aria-busy={props.loading || props.refreshing}
    >
      <header className="flex flex-none items-start justify-between gap-2 border-b border-stroke px-3 pb-2 pt-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-[3px] -skew-x-12 rounded-[1px] bg-accent" />
            <h2 className="eyebrow truncate">{props.eyebrow}</h2>
          </div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span title={props.title} className="truncate text-[13px] font-semibold text-ink">
              {props.title}
            </span>
            {props.subtitle && (
              <span className="truncate font-mono text-[10px] text-mut">{props.subtitle}</span>
            )}
          </div>
        </div>
        <div className="flex flex-none items-center gap-1.5">
          {props.refreshing && (
            <span
              aria-label="updating"
              className="h-2 w-2 animate-pulse rounded-full bg-amber"
            />
          )}
          {props.controls}
          {props.expandable &&
            (fullscreen ? (
              <button
                onClick={() => setExpanded(false)}
                aria-label="Close expanded view"
                className="rounded-md p-1 text-sub transition-colors hover:bg-raised hover:text-ink"
              >
                <X size={13} />
              </button>
            ) : (
              <button
                onClick={() => setExpanded(true)}
                aria-label={`Expand ${props.title}`}
                className="rounded-md p-1 text-mut transition-colors hover:bg-raised hover:text-ink"
              >
                <Maximize2 size={12} />
              </button>
            ))}
        </div>
      </header>
      <div
        className={`min-h-0 flex-1 ${props.refreshing ? "opacity-60 transition-opacity" : ""} ${props.bodyClassName ?? ""}`}
      >
        {body(fullscreen)}
      </div>
    </section>
  );

  return (
    <>
      {card(false)}
      {expanded && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={props.title}
          className="fixed inset-0 z-50 bg-black/70 p-4 backdrop-blur-sm md:p-8"
          onClick={(e) => e.target === e.currentTarget && setExpanded(false)}
        >
          <div className="h-full">{card(true)}</div>
        </div>
      )}
    </>
  );
}
