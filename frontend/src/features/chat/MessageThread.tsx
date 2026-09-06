/** Presentational, read-only render of a chat transcript: user bubbles,
 *  assistant answers with an expandable thinking trace, and charts. Shared by
 *  the live Chat page (settled messages) and the archived-chats page.
 *
 *  Each chart is pinned to the assistant turn that produced it and stays there
 *  as the thread grows — asking a new question never moves, hides, or overlaps
 *  an earlier turn's chart. */
import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { ChatChart } from "@/features/chat/ChatChart";
import type { Message } from "@/features/chat/types";

export function MessageThread({
  messages,
  children,
}: {
  messages: Message[];
  children?: ReactNode;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  return (
    <div className="space-y-6">
      {messages.map((m) =>
        m.role === "user" ? (
          <div key={m.id} className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-br-md border border-stroke bg-ink/[0.05] px-4 py-2.5">
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{m.content}</p>
            </div>
          </div>
        ) : (
          <div key={m.id} className="flex gap-3">
            <span
              aria-hidden
              className="mt-1 h-4 w-[3px] flex-none -skew-x-12 rounded-[1px] bg-accent"
            />
            <div className="min-w-0">
              <p className="eyebrow !text-mut">F1 Terminal</p>
              {m.thinking && m.thinking.length > 0 && (
                <div className="mt-1.5">
                  <button
                    onClick={() =>
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(m.id)) next.delete(m.id);
                        else next.add(m.id);
                        return next;
                      })
                    }
                    className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-mut transition-colors hover:text-sub"
                  >
                    <ChevronDown
                      size={11}
                      className={`transition-transform ${expanded.has(m.id) ? "rotate-180" : ""}`}
                    />
                    Thinking ({m.thinking.length})
                  </button>
                  {expanded.has(m.id) && (
                    <ul className="mt-1.5 space-y-1 border-l border-stroke pl-2.5">
                      {m.thinking.map((t, i) => (
                        <li key={i} className="font-mono text-[11px] leading-relaxed text-sub">
                          {t.kind === "tool_call" ? (
                            <>
                              <span className="text-mut">calling</span> {t.tool}
                            </>
                          ) : (
                            t.content
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink">
                {m.content}
              </p>
              {m.chart && <ChatChart spec={m.chart.spec} data={m.chart.data} />}
            </div>
          </div>
        ),
      )}
      {children}
    </div>
  );
}
