/** In-memory multi-session store for the chat feature, lifted above the router
 *  so every session (and the active selection) survives navigating around the
 *  app. Each session is a tab under /chat and is fully followable. Deliberately
 *  NOT persisted — a browser refresh clears all sessions. */
import {
  createContext,
  useContext,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { ChatSession, Message } from "@/features/chat/types";

interface ChatSessionsValue {
  sessions: ChatSession[];
  activeId: string;
  activeSession: ChatSession;
  /** Start a fresh empty chat (reusing an existing empty one if present) and
   *  make it active; the current chat stays as a tab. */
  newChat: () => void;
  selectSession: (id: string) => void;
  removeSession: (id: string) => void;
  updateMessages: (sessionId: string, update: SetStateAction<Message[]>) => void;
  setThreadId: (sessionId: string, threadId: string | null) => void;
  /** Monotonic message-id source, shared across sessions so ids never collide. */
  nextId: MutableRefObject<number>;
}

const ChatSessionsContext = createContext<ChatSessionsValue | null>(null);

function makeId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `s_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

const freshSession = (): ChatSession => ({ id: makeId(), messages: [], threadId: null });

export function ChatSessionsProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(freshSession);
  const [sessions, setSessions] = useState<ChatSession[]>([initial]);
  const [activeId, setActiveId] = useState(initial.id);
  const nextId = useRef(1);

  const activeSession = sessions.find((s) => s.id === activeId) ?? sessions[0];

  const newChat = () => {
    // Avoid piling up blank tabs: if a session is already empty, just go there.
    const empty = sessions.find((s) => s.messages.length === 0);
    if (empty) {
      setActiveId(empty.id);
      return;
    }
    const created = freshSession();
    setSessions((prev) => [...prev, created]);
    setActiveId(created.id);
  };

  const selectSession = (id: string) => setActiveId(id);

  const removeSession = (id: string) =>
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      const ensured = next.length ? next : [freshSession()];
      if (id === activeId) setActiveId(ensured[ensured.length - 1].id);
      return ensured;
    });

  const updateMessages = (sessionId: string, update: SetStateAction<Message[]>) =>
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId
          ? {
              ...s,
              messages:
                typeof update === "function"
                  ? (update as (m: Message[]) => Message[])(s.messages)
                  : update,
            }
          : s,
      ),
    );

  const setThreadId = (sessionId: string, threadId: string | null) =>
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, threadId } : s)));

  return (
    <ChatSessionsContext.Provider
      value={{
        sessions,
        activeId,
        activeSession,
        newChat,
        selectSession,
        removeSession,
        updateMessages,
        setThreadId,
        nextId,
      }}
    >
      {children}
    </ChatSessionsContext.Provider>
  );
}

export function useChatSessions(): ChatSessionsValue {
  const ctx = useContext(ChatSessionsContext);
  if (!ctx) throw new Error("useChatSessions must be used within ChatSessionsProvider");
  return ctx;
}
