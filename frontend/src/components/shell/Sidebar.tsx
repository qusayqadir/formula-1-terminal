import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Boxes,
  CalendarDays,
  ChevronRight,
  LayoutDashboard,
  MessageSquare,
  Newspaper,
  PanelLeftClose,
  Plus,
  Radio,
  Rewind,
  Search,
  Sparkles,
  TerminalSquare,
  TrendingUp,
  UserRound,
  X,
} from "lucide-react";
import { FileTree, FileTreeFile, FileTreeFolder } from "@/components/ai-elements/file-tree";
import { useChatSessions } from "@/state/chatSessions";
import type { ChatSession } from "@/features/chat/types";

/** Strict-black rail. Navigation is a file-tree: folders group terminal /
 *  docs / support destinations; selection follows the router location.
 *  Identity accent stays reserved for the selected tick. */

/** Placeholder profile — swap for real account data once auth exists. */
const PROFILE = {
  name: "Qusay Qadir",
  email: "qusayqadir78@gmail.com",
  team: "McLaren",
  driver: "Lando Norris",
  circuit: "Suzuka",
  since: "2026",
} as const;

/** Profile trigger + upward glass popover. Own component: the nav tree is
 *  rendered twice (desktop rail + mobile drawer), so each copy needs its own
 *  open state / outside-click ref. */
function ProfilePill() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative min-w-0">
      {open && (
        <div className="absolute bottom-full left-0 z-40 mb-2 w-56 rounded-md border border-ink/20 bg-raised/75 p-3 shadow-[0_1px_2px_rgba(0,0,0,0.1)] backdrop-blur-sm">
          <p className="font-mono text-[10px] uppercase tracking-wider text-sub">Profile</p>
          <dl className="mt-2 space-y-1.5 font-mono text-[11px] tabular-nums">
            {[
              ["Name", PROFILE.name],
              ["Email", PROFILE.email],
              ["Fav Team", PROFILE.team],
              ["Fav Driver", PROFILE.driver],
              ["Fav Circuit", PROFILE.circuit],
              ["Member Since", PROFILE.since],
            ].map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-3">
                <dt className="flex-none text-mut">{label}</dt>
                <dd className="truncate text-right text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Profile"
        aria-expanded={open}
        title="Profile"
        className="flex w-full min-w-0 items-center gap-2 rounded-lg border border-stroke px-2 py-1.5 text-left transition-colors hover:bg-ink/[0.06]"
      >
        <span className="grid h-6 w-6 flex-none place-items-center rounded-md bg-ink/[0.08] text-mut">
          <UserRound size={13} strokeWidth={1.7} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[11.5px] font-medium leading-tight text-ink">
            {PROFILE.name}
          </span>
          <span className="block truncate font-mono text-[9.5px] leading-tight text-mut">
            {PROFILE.email}
          </span>
        </span>
      </button>
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

      {/* search stub */}
      <button
        type="button"
        title="Search — coming soon"
        className="mt-5 flex h-9 flex-none cursor-default items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-sub transition-colors hover:bg-ink/[0.04] hover:text-ink"
      >
        <Search size={15} strokeWidth={1.7} className="flex-none" />
        Search
        <kbd className="ml-auto grid h-6 w-6 place-items-center rounded-md border border-stroke font-mono text-[11px] text-mut">
          /
        </kbd>
      </button>

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
                <span className="rounded border border-stroke px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-mut">
                  soon
                </span>
              }
            />
            <FileTreeFile name="Race Replay" path="/race-replay" icon={Rewind} />
            <FileTreeFile
              name="Prediction Markets"
              path="/prediction-markets"
              icon={TrendingUp}
            />
            <FileTreeFile name="News" path="/news" icon={Newspaper} />
            <FileTreeFile name="Calendar" path="/calendar" icon={CalendarDays} />
          </FileTreeFolder>
          <ChatSessionsFolder onNavigate={handleSelect} />
          <FileTreeFolder name="docs" path="docs">
            <FileTreeFile name="Backend APIs" path="/docs/apis" icon={TerminalSquare} />
            <FileTreeFile name="Architecture" path="/docs/architecture" icon={Boxes} />
          </FileTreeFolder>
          <FileTreeFolder name="support" path="support">
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

      {/* bottom bar — profile (left) opposite the collapse control (right) */}
      <div className="mt-3 flex flex-none items-center justify-between gap-2">
        <ProfilePill />
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
