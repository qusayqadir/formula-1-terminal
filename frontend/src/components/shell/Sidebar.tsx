import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Boxes,
  CalendarDays,
  ChevronRight,
  CornerDownLeft,
  LayoutDashboard,
  MessageSquare,
  PanelLeftClose,
  Plus,
  Radio,
  Rewind,
  Search,
  Sparkles,
  TrendingUp,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { FileTree, FileTreeFile, FileTreeFolder } from "@/components/ai-elements/file-tree";
import { useChatSessions } from "@/state/chatSessions";
import type { ChatSession } from "@/features/chat/types";

/** Strict-black rail. Navigation is a file-tree: folders group terminal /
 *  docs destinations; selection follows the router location. Identity accent
 *  stays reserved for the selected tick. */

/** Every searchable destination. Keywords broaden matches beyond the label
 *  (e.g. "graph" → Architecture, "sql" → Chat). */
type SearchTarget = {
  label: string;
  path: string;
  section: string;
  icon: LucideIcon;
  keywords?: string;
};
const SEARCH_TARGETS: SearchTarget[] = [
  { label: "Dashboard", path: "/", section: "Terminal", icon: LayoutDashboard, keywords: "historical home overview" },
  { label: "Live Dashboard", path: "/live", section: "Terminal", icon: Radio, keywords: "telemetry realtime sim" },
  { label: "Race Replay", path: "/race-replay", section: "Terminal", icon: Rewind, keywords: "playback" },
  { label: "Prediction Markets", path: "/prediction-markets", section: "Terminal", icon: TrendingUp, keywords: "odds betting" },
  { label: "Calendar", path: "/calendar", section: "Terminal", icon: CalendarDays, keywords: "schedule circuits track" },
  { label: "Chat", path: "/chat", section: "Chat", icon: MessageSquare, keywords: "ask question sql rag regulation" },
  { label: "Architecture", path: "/docs/architecture", section: "Docs", icon: Boxes, keywords: "system design aws diagram graph infrastructure" },
  { label: "Creator", path: "/creator", section: "About", icon: UserRound, keywords: "author bio about" },
];

/** Search box + glass results popover. Own component: the nav tree is rendered
 *  twice (desktop rail + mobile drawer), so each copy needs its own open state,
 *  query, and outside-click ref. "/" focuses the input from anywhere. */
function SearchBox({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SEARCH_TARGETS;
    return SEARCH_TARGETS.filter((t) =>
      `${t.label} ${t.section} ${t.keywords ?? ""}`.toLowerCase().includes(q),
    );
  }, [query]);

  useEffect(() => setActive(0), [query]);

  // "/" focuses search (unless typing in another field); outside-click closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/") return;
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, []);

  const go = (path: string) => {
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
    onNavigate(path);
  };

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[active]) go(results[active].path);
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div ref={ref} className="relative mt-5 flex-none">
      <div className="flex h-9 items-center gap-2.5 rounded-lg border border-stroke px-2.5 text-[13px] transition-colors focus-within:border-stroke-strong">
        <Search size={15} strokeWidth={1.7} className="flex-none text-sub" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={onInputKey}
          placeholder="Search"
          className="min-w-0 flex-1 bg-transparent text-sub placeholder:text-mut focus:text-ink focus:outline-none"
        />
        {!query && (
          <kbd className="grid h-6 w-6 flex-none place-items-center rounded-md border border-stroke font-mono text-[11px] text-mut">
            /
          </kbd>
        )}
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-md border border-ink/20 bg-raised/75 py-1 shadow-[0_1px_2px_rgba(0,0,0,0.1)] backdrop-blur-sm">
          {results.length === 0 ? (
            <p className="px-3 py-2 font-mono text-[11px] text-mut">No matches</p>
          ) : (
            <ul role="listbox">
              {results.map((t, i) => {
                const Icon = t.icon;
                return (
                  <li key={t.path} role="option" aria-selected={i === active}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(t.path)}
                      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] transition-colors ${
                        i === active ? "bg-ink/[0.07] text-ink" : "text-sub hover:bg-ink/[0.04]"
                      }`}
                    >
                      <Icon size={14} strokeWidth={1.7} className="flex-none text-mut" />
                      <span className="min-w-0 flex-1 truncate">{t.label}</span>
                      <span className="flex-none font-mono text-[9.5px] uppercase tracking-wider text-mut">
                        {t.section}
                      </span>
                      {i === active && (
                        <CornerDownLeft size={12} className="flex-none text-mut" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** The "chat" folder is dynamic: one row per in-memory chat session (a tab),
 *  plus a "+" to start a new one. Selection follows the active session (not a
 *  route), since every session lives at /chat. */
function ChatSessionsFolder({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { sessions, activeId, newChat, selectSession, removeSession } = useChatSessions();
  const location = useLocation();
  const [open, setOpen] = useState(true);
  const onChat = location.pathname === "/chat";

  const label = (s: ChatSession) => {
    const firstUser = s.messages.find((m) => m.role === "user");
    return firstUser ? firstUser.content.slice(0, 28) : "New chat";
  };

  return (
    <li role="treeitem" aria-expanded={open}>
      {/* folder header: expand toggle + label + new-chat (+) */}
      <div className="group relative flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium text-accent transition-colors duration-150 hover:bg-accent/[0.08]">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-2.5"
        >
          <ChevronRight
            size={13}
            strokeWidth={2}
            className={`flex-none text-accent/70 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
          />
          <MessageSquare size={15} strokeWidth={1.7} className="flex-none text-accent" />
          <span className="truncate">chat</span>
        </button>
        <button
          type="button"
          onClick={() => {
            newChat();
            onNavigate("/chat");
          }}
          title="New chat"
          aria-label="New chat"
          className="grid h-6 w-6 flex-none place-items-center rounded-md text-accent/80 transition-colors hover:bg-accent/[0.14] hover:text-accent"
        >
          <Plus size={14} strokeWidth={2} />
        </button>
      </div>

      {open && (
        <ul role="group" className="ml-[18px] mt-[3px] space-y-[3px] border-l border-stroke pl-2">
          {/* newest chat on top — the provider keeps sessions in creation order */}
          {[...sessions].reverse().map((s) => {
            const selected = onChat && s.id === activeId;
            return (
              <li key={s.id} role="treeitem" aria-selected={selected}>
                <div
                  className={`group relative flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] tracking-[-0.01em] transition-colors duration-150 ${
                    selected
                      ? "bg-ink/[0.07] font-medium text-ink"
                      : "text-sub hover:bg-ink/[0.04] hover:text-ink"
                  }`}
                >
                  {selected && (
                    <span aria-hidden className="absolute left-0 h-4 w-0.5 rounded-r bg-accent" />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      selectSession(s.id);
                      onNavigate("/chat");
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2.5"
                  >
                    <MessageSquare size={15} strokeWidth={1.7} className="ml-1.5 flex-none" />
                    <span className="truncate">{label(s)}</span>
                  </button>
                  {sessions.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSession(s.id)}
                      title="Delete chat"
                      aria-label="Delete chat"
                      className="grid h-6 w-6 flex-none place-items-center rounded-md text-mut opacity-0 transition-opacity hover:text-neg group-hover:opacity-100"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

export function Sidebar(props: {
  open: boolean;
  onClose: () => void;
  onCollapse: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [promoDismissed, setPromoDismissed] = useState(
    () => localStorage.getItem("f1-chat-promo-dismissed") === "1",
  );
  const dismissPromo = () => {
    localStorage.setItem("f1-chat-promo-dismissed", "1");
    setPromoDismissed(true);
  };

  const handleSelect = (path: string) => {
    navigate(path);
    props.onClose();
  };

  const nav = (
    <nav className="flex h-full flex-col bg-rail px-3 pb-4 pt-4" aria-label="Primary">
      {/* header: brand + collapse / theme controls */}
      <div className="flex h-12 flex-none items-center gap-2 rounded-xl border border-stroke bg-ink/[0.04] px-3">
        <p className="text-[14px] font-semibold tracking-tight text-ink">F1 Terminal</p>
        <span className="ml-auto" />
        <button
          onClick={props.onClose}
          aria-label="Close menu"
          className="rounded-md p-1 text-mut hover:text-ink lg:hidden"
        >
          <X size={14} />
        </button>
      </div>

      {/* global page search */}
      <SearchBox onNavigate={handleSelect} />

      {/* file-tree navigation */}
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        <FileTree
          defaultExpanded={new Set(["terminal", "chat", "docs"])}
          selectedPath={location.pathname}
          onSelect={handleSelect}
        >
          <FileTreeFolder name="terminal" path="terminal">
            <FileTreeFile name="Dashboard" path="/" icon={LayoutDashboard} />
            <FileTreeFile
              name="Live Dashboard"
              path="/live"
              icon={Radio}
              badge={
                <span className="flex items-center gap-1 rounded border border-neg/40 bg-neg/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-neg">
                  <span aria-hidden className="h-1 w-1 animate-pulse rounded-full bg-neg" />
                  sim
                </span>
              }
            />
            <FileTreeFile name="Race Replay" path="/race-replay" icon={Rewind} />
            <FileTreeFile
              name="Prediction Markets"
              path="/prediction-markets"
              icon={TrendingUp}
            />
            <FileTreeFile name="Calendar" path="/calendar" icon={CalendarDays} />
          </FileTreeFolder>
          <ChatSessionsFolder onNavigate={handleSelect} />
          <FileTreeFolder name="docs" path="docs">
            <FileTreeFile name="Architecture" path="/docs/architecture" icon={Boxes} />
            <FileTreeFile name="Creator" path="/creator" icon={UserRound} />
          </FileTreeFolder>
        </FileTree>
      </div>

      {/* bottom promo card */}
      {!promoDismissed && (
        <div className="relative mt-4 flex-none rounded-xl border border-stroke bg-ink/[0.04] p-4">
          <button
            onClick={dismissPromo}
            aria-label="Dismiss"
            className="absolute right-2.5 top-2.5 rounded-md p-1 text-mut transition-colors hover:text-ink"
          >
            <X size={13} />
          </button>
          <span className="grid h-9 w-9 place-items-center rounded-lg border border-stroke bg-surface text-ink">
            <Sparkles size={15} strokeWidth={1.7} />
          </span>
          <p className="mt-3 text-[13.5px] font-semibold text-ink">Chat preview</p>
          <p className="mt-1 text-xs leading-relaxed text-sub">
            Ask the historical database questions in plain English.
          </p>
          <NavLink
            to="/chat"
            onClick={props.onClose}
            className="mt-3 block rounded-lg border border-stroke bg-surface py-2 text-center text-[12.5px] font-medium text-ink transition-colors hover:border-stroke-strong"
          >
            Open Chat
          </NavLink>
        </div>
      )}

      {/* bottom bar — collapse control */}
      <div className="mt-3 flex flex-none items-center justify-end">
        <button
          onClick={props.onCollapse}
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
          className="hidden flex-none rounded-lg border border-stroke p-2 text-mut transition-colors hover:bg-ink/[0.06] hover:text-ink lg:block"
        >
          <PanelLeftClose size={15} strokeWidth={1.7} />
        </button>
      </div>
    </nav>
  );

  return (
    <>
      {/* mobile drawer (desktop rail is rendered by AppShell) */}
      <div className="hidden h-full lg:block">{nav}</div>
      {props.open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={props.onClose} />
          <aside className="absolute inset-y-0 left-0 w-[264px] border-r border-stroke-strong bg-rail shadow-2xl">
            {nav}
          </aside>
        </div>
      )}
    </>
  );
}
