/** Shared chat data types, used by the live Chat page, the archived-chats
 *  page, the MessageThread renderer, and the in-memory sessions provider. */
import type { ChatChartSpec, ChatChartRow } from "@/features/chat/ChatChart";

export interface ThinkingEvent {
  kind: "tool_call" | "reason";
  node?: string;
  tool?: string;
  field?: string;
  content?: string;
}

export interface ChartPayload {
  spec: ChatChartSpec;
  data: ChatChartRow[];
}

export interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
  thinking?: ThinkingEvent[];
  chart?: ChartPayload;
}

/** One chat session (a tab under /chat). Every session is fully followable —
 *  switching to an older one lets you keep asking. Held in React state (never
 *  persisted) so a browser refresh clears every session. The display title is
 *  derived from the first user message, so it isn't stored here. */
export interface ChatSession {
  id: string;
  messages: Message[];
  threadId: string | null;
}
