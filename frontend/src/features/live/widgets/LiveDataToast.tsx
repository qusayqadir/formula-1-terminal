import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

/** Top-and-center disclosure shown on entering /live: there is no live race,
 *  so the terminal streams a slice of mock telemetry through the real
 *  Fargate → SQS → Lambda pipeline for illustration. Non-blocking (the page
 *  behind stays interactive); stays until the user dismisses it (no
 *  auto-dismiss); reappears on a fresh page load, which is the right behavior
 *  for a per-session disclosure. */

export function LiveDataToast() {
  const [shown, setShown] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const enter = setTimeout(() => setShown(true), 300);
    return () => clearTimeout(enter);
  }, []);

  if (!shown) return null;

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 top-5 z-50 flex justify-center px-4 transition-all duration-300 ${
        closing ? "-translate-y-2 opacity-0" : "translate-y-0 opacity-100"
      }`}
      onTransitionEnd={() => closing && setShown(false)}
    >
      {/* soft non-blocking dim so the notice reads above the dashboard behind it */}
      <div
        aria-hidden
        className="fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-ink/25 via-ink/10 to-transparent"
      />
      <div
        role="alertdialog"
        aria-labelledby="live-toast-title"
        className="pointer-events-auto flex w-[26rem] max-w-full items-start gap-3 rounded-xl border border-amber/40 bg-raised/95 p-4 shadow-[var(--shadow-pop)] backdrop-blur-sm"
      >
        <AlertTriangle size={18} strokeWidth={2} className="mt-0.5 flex-none text-amber" />
        <div className="min-w-0">
          <p id="live-toast-title" className="text-[14px] font-semibold text-ink">
            No Live Race Currently Detected
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-sub">
            Mock race data running through SQS, and Lambda consumers for the middle 10
            laps of the Bahrain Grand Prix, for illustration. Substitute Lambda Message Producer. 
          </p>
        </div>
        <button
          onClick={() => setClosing(true)}
          aria-label="Dismiss"
          className="flex-none rounded-md p-1 text-mut transition-colors hover:bg-ink/10 hover:text-ink"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
