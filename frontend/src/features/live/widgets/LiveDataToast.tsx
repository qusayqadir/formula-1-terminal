import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

/** Top-and-center disclosure shown on entering /live: there is no live race,
 *  so the terminal streams a slice of mock telemetry through the real
 *  Fargate → SQS → Lambda pipeline for illustration. Non-blocking (the page
 *  behind stays interactive) and self-dismisses after a few seconds (or on the
 *  X); it reappears on a fresh page load, the right behavior for a per-session
 *  disclosure. */

const ENTER_MS = 300;
const AUTO_DISMISS_MS = 6500;

export function LiveDataToast() {
  const [shown, setShown] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const enter = setTimeout(() => setShown(true), ENTER_MS);
    // fade itself out after a beat so the user never has to dismiss it
    const auto = setTimeout(() => setClosing(true), ENTER_MS + AUTO_DISMISS_MS);
    return () => {
      clearTimeout(enter);
      clearTimeout(auto);
    };
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
        className="fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-ink/20 via-ink/[0.05] to-transparent"
      />
      <div
        role="alertdialog"
        aria-labelledby="live-toast-title"
        className="pointer-events-auto flex w-[27rem] max-w-full items-start gap-3 rounded-xl border border-amber/40 bg-raised/95 px-4 py-3.5 shadow-[var(--shadow-pop)] backdrop-blur-sm"
      >
        <AlertTriangle size={18} strokeWidth={2} className="mt-px flex-none text-amber" />
        <div className="min-w-0 flex-1">
          <p id="live-toast-title" className="text-[13.5px] font-semibold leading-tight text-ink">
            No Live Race Detected
          </p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-sub">
            Streaming a simulated session so you can explore the live dashboard end to end.
          </p>
        </div>
        <button
          onClick={() => setClosing(true)}
          aria-label="Dismiss"
          className="-mr-1 -mt-0.5 flex-none rounded-md p-1 text-mut transition-colors hover:bg-ink/10 hover:text-ink"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
