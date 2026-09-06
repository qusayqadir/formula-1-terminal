/** Chat — UI for the chat over the historical DB (spec 04).
 *  The backend (app/chatbot) is not exposed over the API yet, so replies
 *  come from a local placeholder; swap `respond()` for the real endpoint
 *  when it lands. Thread state is in-memory only.
 *
 *  Composer is a floating Skiper-style pill (bottom-center): collapsed it is
 *  a single round toggle; expanding springs it open into a typeable field
 *  with an apple-blue send button. */
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Archive, ArrowUp, X } from "lucide-react";
import { useFilters } from "@/state/filters";
import { useChatSessions } from "@/state/chatSessions";
import { ThinkingDots } from "@/components/ui/ThinkingDots";
import { SiriOrb } from "@/components/ui/SiriOrb";
import { MessageThread } from "@/features/chat/MessageThread";
import type { ChatChartSpec, ChatChartRow } from "@/features/chat/ChatChart";
import type { ChartPayload, ThinkingEvent } from "@/features/chat/types";

const SUGGESTIONS = [
  "Who won the 2021 drivers' championship, and by how many points?",
  "Which team had the most mechanical DNFs in 2016?",
  "Compare Norris and Verstappen over the 2025 season.",
  "At which circuits does pole convert to a win least often?",
];

interface RawThinkingEvent {
  kind: "tool_call" | "reason_delta";
  node?: string;
  tool?: string;
  field?: string;
  content?: string;
  done?: boolean;
}

interface StreamHandlers {
  onThreadId: (threadId: string) => void;
  onThinking: (event: RawThinkingEvent) => void;
  onChart: (chart: ChartPayload) => void;
  onFinal: (content: string) => void;
}

async function streamChat(
  question: string,
  threadId: string | null,
  handlers: StreamHandlers,
): Promise<void> {
  const response = await fetch("/api/v1/chatbot/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_query: question, thread_id: threadId }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`API error: ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const raw of events) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;

      const event = JSON.parse(data) as
        | { type: "thread"; thread_id: string }
        | ({ type: "thinking" } & RawThinkingEvent)
        | { type: "chart"; spec: ChatChartSpec; data: ChatChartRow[] }
        | { type: "final"; content: string };

      if (event.type === "thread") handlers.onThreadId(event.thread_id);
      else if (event.type === "thinking") {
        const { type: _type, ...thinkingEvent } = event;
        handlers.onThinking(thinkingEvent);
      } else if (event.type === "chart") {
        handlers.onChart({ spec: event.spec, data: event.data });
      } else if (event.type === "final") handlers.onFinal(event.content);
    }
  }
}

export function ChatPage() {
  const { filters } = useFilters();
  // The chat renders whichever session is active; sessions live in the shared
  // provider (multiple tabs, all in-memory — a refresh clears them). Ephemeral
  // UI state (draft, streaming indicator) stays local.
  const { activeSession, activeId, updateMessages, setThreadId, newChat, nextId } =
    useChatSessions();
  const messages = activeSession.messages;
  const [draft, setDraft] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [liveThinking, setLiveThinking] = useState<ThinkingEvent[]>([]);
  const replyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Typewriter reveal: text arrives from the network in uneven bursts (a
  // whole short sentence in one delta, then a multi-second silent gap for
  // nodes with no reason text). Revealing raw deltas as they land looks
  // instant-then-frozen. Instead each reason line has a target (the full raw
  // text received so far) and a revealed length that a single rAF loop
  // advances at a steady pace, catching up faster if the backlog grows —
  // same trick Claude/Cursor-style streaming UIs use to look smooth
  // regardless of network jitter.
  const revealTargets = useRef<Map<number, string>>(new Map());
  const revealedLengths = useRef<Map<number, number>>(new Map());
  const revealRaf = useRef<number | null>(null);
  const revealLastFrame = useRef(0);
  const REVEAL_CHARS_PER_SEC = 55;

  const stopReveal = () => {
    if (revealRaf.current !== null) cancelAnimationFrame(revealRaf.current);
    revealRaf.current = null;
    revealTargets.current.clear();
    revealedLengths.current.clear();
  };

  const startReveal = () => {
    if (revealRaf.current !== null) return;
    revealLastFrame.current = performance.now();
    const tick = (now: number) => {
      const dt = now - revealLastFrame.current;
      revealLastFrame.current = now;
      setLiveThinking((prev) => {
        let next: ThinkingEvent[] | null = null;
        revealTargets.current.forEach((target, idx) => {
          const revealed = revealedLengths.current.get(idx) ?? 0;
          if (revealed >= target.length) return;
          const backlog = target.length - revealed;
          // Steady pace normally; if a field finished streaming well ahead
          // of the reveal (e.g. a short reason during a fast node) or the
          // backlog is large, close the gap faster instead of lagging.
          const paced = (REVEAL_CHARS_PER_SEC * dt) / 1000;
          const chars = Math.max(1, Math.round(backlog > 50 ? backlog * 0.12 : paced));
          const newRevealed = Math.min(target.length, revealed + chars);
          revealedLengths.current.set(idx, newRevealed);
          if (!next) next = [...prev];
          if (next[idx]) next[idx] = { ...next[idx], content: target.slice(0, newRevealed) };
        });
        return next ?? prev;
      });
      let pending = false;
      revealTargets.current.forEach((target, idx) => {
        if ((revealedLengths.current.get(idx) ?? 0) < target.length) pending = true;
      });
      if (pending) {
        revealRaf.current = requestAnimationFrame(tick);
      } else {
        revealRaf.current = null;
      }
    };
    revealRaf.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking, liveThinking]);

  useEffect(() => () => clearTimeout(replyTimer.current), []);

  // focus the field once the pill has sprung open
  useEffect(() => {
    if (composerOpen) {
      const t = setTimeout(() => inputRef.current?.focus(), 180);
      return () => clearTimeout(t);
    }
  }, [composerOpen]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question) return;
    // Pin this turn to the session it was asked in, so the answer lands here
    // even if the user switches tabs mid-stream.
    const sid = activeId;
    const startThreadId = activeSession.threadId;
    updateMessages(sid, (m) => [...m, { id: nextId.current++, role: "user", content: question }]);
    setDraft("");
    setComposerOpen(true);
    inputRef.current?.focus();
    setThinking(true);
    setLiveThinking([]);
    stopReveal();
    clearTimeout(replyTimer.current);

    const assistantId = nextId.current++;
    const thinkingEvents: ThinkingEvent[] = [];
    // The chart event arrives just before the final text; stash it and fold it
    // into the assistant message when `final` lands.
    let pendingChart: ChartPayload | null = null;
    // Maps "node:field" -> index in thinkingEvents/liveThinking for a
    // reason_delta line that's still being appended to.
    const openLines = new Map<string, number>();

    try {
      await streamChat(question, startThreadId, {
        onThreadId: (threadId) => {
          setThreadId(sid, threadId);
        },
        // Rendered live while the agent works. tool_call lines appear
        // instantly; reason text is fed into the typewriter reveal buffer
        // rather than rendered directly, so it plays out at a steady pace
        // regardless of how bursty the network deltas are. Once the final
        // answer lands the live feed is cleared and folded into that
        // message's expandable thinking trace (with the full, untruncated
        // text — the reveal pacing is a display effect only).
        onThinking: (event) => {
          if (event.kind === "tool_call") {
            const finalized: ThinkingEvent = { kind: "tool_call", node: event.node, tool: event.tool };
            thinkingEvents.push(finalized);
            setLiveThinking((prev) => [...prev, finalized]);
            return;
          }

          const key = `${event.node}:${event.field}`;
          const idx = openLines.get(key);
          if (idx === undefined) {
            const line: ThinkingEvent = { kind: "reason", node: event.node, field: event.field, content: event.content ?? "" };
            thinkingEvents.push(line);
            const newIdx = thinkingEvents.length - 1;
            openLines.set(key, newIdx);
            revealTargets.current.set(newIdx, event.content ?? "");
            revealedLengths.current.set(newIdx, 0);
            setLiveThinking((prev) => [...prev, { ...line, content: "" }]);
            startReveal();
          } else {
            thinkingEvents[idx] = {
              ...thinkingEvents[idx],
              content: (thinkingEvents[idx].content ?? "") + (event.content ?? ""),
            };
            revealTargets.current.set(idx, thinkingEvents[idx].content ?? "");
            startReveal();
          }
          if (event.done) openLines.delete(key);
        },
        onChart: (chart) => {
          pendingChart = chart;
        },
        onFinal: (content) => {
          setThinking(false);
          setLiveThinking([]);
          stopReveal();
          updateMessages(sid, (m) => [
            ...m,
            {
              id: assistantId,
              role: "assistant",
              content,
              thinking: thinkingEvents,
              chart: pendingChart ?? undefined,
            },
          ]);
        },
      });
    } catch (error) {
      updateMessages(sid, (m) => [
        ...m,
        {
          id: assistantId,
          role: "assistant",
          content: `Error: Could not process your question. ${error instanceof Error ? error.message : "Unknown error"}`,
        },
      ]);
    } finally {
      setThinking(false);
      setLiveThinking([]);
      stopReveal();
    }
  };

  useEffect(() => stopReveal, []);

  return (
    <div className="relative flex h-full flex-col">
      {/* header */}
      <header className="flex flex-none flex-wrap items-end justify-between gap-2 border-b border-stroke px-5 py-4">
        <div>
          <p className="eyebrow">Home / Chat</p>
          <h1 className="mt-0.5 text-lg font-semibold tracking-tight text-ink">Chat</h1>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-stroke px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-accent">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
          Live · backend connected
        </span>
      </header>

      {/* thread — extra bottom padding keeps content clear of the floating pill */}
      <div ref={threadRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-5 pb-32 pt-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center pt-16 text-center">
              <p className="eyebrow">Ask the database</p>
              <h2 className="mt-2 max-w-md text-xl font-semibold tracking-tight text-ink">
                Every classification, standing and circuit from 2011 to 2026.
              </h2>
              <p className="mt-2 max-w-sm text-xs leading-relaxed text-sub">
                Answers will be grounded in the ingested results database once the chat
                backend is wired up. Try one of these to see the flow:
              </p>
              <div className="mt-6 grid w-full max-w-xl gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-xl border border-stroke bg-surface px-3.5 py-3 text-left text-xs leading-relaxed text-sub transition-colors hover:border-stroke-strong hover:text-ink"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <MessageThread messages={messages}>
              {thinking && (
                <div className="flex gap-3">
                  <span
                    aria-hidden
                    className="mt-1 h-4 w-[3px] flex-none -skew-x-12 rounded-[1px] bg-accent animate-pulse"
                  />
                  <div className="min-w-0">
                    <p className="eyebrow !text-mut">F1 Terminal</p>
                    {liveThinking.length === 0 ? (
                      <div className="mt-2">
                        <ThinkingDots />
                      </div>
                    ) : (
                      <ul className="mt-1.5 space-y-1">
                        {liveThinking.map((t, i) => (
                          <li
                            key={i}
                            className="font-mono text-[11px] leading-relaxed text-sub last:text-ink"
                          >
                            {t.kind === "tool_call" ? (
                              <>
                                <span className="text-mut">calling</span> {t.tool}
                              </>
                            ) : (
                              t.content
                            )}
                            {i === liveThinking.length - 1 && (
                              <span
                                aria-hidden
                                className="ml-0.5 inline-block h-[11px] w-[6px] translate-y-[1px] animate-pulse bg-accent/70"
                              />
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </MessageThread>
          )}
        </div>
      </div>

      {/* floating composer — Skiper-style expanding pill */}
      <div className="pointer-events-none absolute inset-x-0 bottom-6 z-20 flex justify-center px-4">
        <motion.div
          layout
          initial={{ scale: 0, y: "100%" }}
          animate={{ scale: 1, y: 0 }}
          transition={{ type: "spring", bounce: 0.16, layout: { type: "spring", bounce: 0.16 } }}
          style={{ borderRadius: 9999 }}
          className="pointer-events-auto flex h-12 max-w-full items-center overflow-hidden border border-stroke bg-raised shadow-[var(--shadow-pop)]"
        >
          {!composerOpen ? (
            <button
              onClick={() => setComposerOpen(true)}
              aria-label="Ask a question"
              className="flex h-12 items-center gap-2 truncate whitespace-nowrap px-5 text-[13px] text-sub transition-colors hover:text-ink"
            >
              {/* fade the orb+label in only after the pill has shrunk, so no
                  content is visible mid-collapse; the orb only exists while
                  the composer is closed */}
              <motion.span
                key="orb"
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3, duration: 0.2 }}
                className="flex items-center"
              >
                <SiriOrb size={20} />
              </motion.span>
              <motion.span
                key="label"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3, duration: 0.2 }}
              >
                Ask AI!
              </motion.span>
            </button>
          ) : (
            <AnimatePresence>
              <motion.div
                key="field"
                initial={{ opacity: 0, filter: "blur(4px)" }}
                animate={{ opacity: 1, filter: "blur(0px)" }}
                transition={{ delay: 0.15 }}
                className="flex w-[min(640px,calc(100vw-4rem))] items-center gap-1 pl-1.5 pr-1.5"
              >
                <button
                  onClick={() => setComposerOpen(false)}
                  aria-label="Collapse composer"
                  className="grid h-9 w-9 flex-none place-items-center rounded-full text-mut transition-colors hover:text-ink"
                >
                  <X size={14} />
                </button>
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") send(draft);
                    if (e.key === "Escape") setComposerOpen(false);
                  }}
                  placeholder={`Ask about the ${filters.year} season, a driver, a circuit…`}
                  aria-label="Chat message"
                  className="h-full min-w-0 flex-1 bg-transparent px-1.5 text-[13px] text-ink outline-none placeholder:text-mut"
                />
                {messages.length > 0 && (
                  <button
                    onClick={newChat}
                    title="New chat (keeps this one as a tab under Chat)"
                    aria-label="New chat"
                    className="grid h-9 w-9 flex-none place-items-center rounded-full text-mut transition-colors hover:bg-ink/[0.05] hover:text-ink"
                  >
                    <Archive size={14} />
                  </button>
                )}
                <motion.button
                  initial={{ opacity: 0, scale: 0.5, filter: "blur(4px)" }}
                  animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                  transition={{ delay: 0.25 }}
                  onClick={() => send(draft)}
                  disabled={!draft.trim()}
                  aria-label="Send message"
                  className="grid h-9 w-9 flex-none place-items-center rounded-full bg-accent text-white transition-opacity hover:opacity-90 active:scale-95 disabled:opacity-30"
                >
                  <ArrowUp size={15} strokeWidth={2.2} />
                </motion.button>
              </motion.div>
            </AnimatePresence>
          )}
        </motion.div>
      </div>
    </div>
  );
}
