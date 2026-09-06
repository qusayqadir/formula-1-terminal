import json
import re
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, Request
# from slowapi import Limiter, _rate_limit_exceeded_handler
# from slowapi.util import get_remote_address
# from slowapi.errors import RateLimitExceeded
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.chatbot.graph import terminal_chat

router = APIRouter(prefix="/chatbot", tags=["chatbot"])
# limiter = Limiter(key_func=get_remote_address)
# router.state.limiter = limiter
# router.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Only these nodes actually set final_answer for this turn. Other nodes (e.g.
# the router subgraph) share the full AgentState schema, so a stale
# final_answer left over from a prior turn in the checkpoint can otherwise
# reappear in their reported update too.
FINAL_ANSWER_NODES = {"respond", "out_of_scope"}

# The only structured-output string fields we treat as "thinking" text worth
# streaming to the frontend, character-by-character, as the model writes them.
REASON_FIELD_NAMES = {"route_reason", "reason"}
_REASON_FIELD_START = re.compile(r'"(route_reason|reason)"\s*:\s*"')


class _ReasonFieldStreamer:
    """Incrementally extracts a growing JSON string value out of the raw
    tool-call `input_json_delta` fragments Anthropic streams for structured
    output, without ever surfacing the surrounding JSON (keys, other fields,
    braces) to the client — only the plain text a target field is being
    written with, as it's written.
    """

    def __init__(self) -> None:
        self._buffer = ""
        self._search_from = 0
        self._field_name: str | None = None
        self._field_start = 0
        self._emitted = 0

    def feed(self, delta: str) -> list[tuple[str, str, bool]]:
        """Returns (field_name, text_chunk, is_done) tuples for this delta."""
        self._buffer += delta
        out: list[tuple[str, str, bool]] = []

        while True:
            if self._field_name is None:
                match = _REASON_FIELD_START.search(self._buffer, self._search_from)
                if match is None:
                    # Keep a small lookback so a key split across two deltas
                    # (e.g. `"reas` + `on": "`) is still found next feed().
                    self._search_from = max(0, len(self._buffer) - 24)
                    return out
                self._field_name = match.group(1)
                self._field_start = match.end()
                self._emitted = 0

            content = self._buffer[self._field_start :]
            end = self._find_unescaped_quote(content)
            if end is None:
                # Hold back a trailing lone backslash so we never split an
                # escape sequence (e.g. \n) across two emitted chunks.
                safe_len = len(content) - 1 if content.endswith("\\") else len(content)
                if safe_len > self._emitted:
                    chunk = self._unescape(content[self._emitted : safe_len])
                    if chunk:
                        out.append((self._field_name, chunk, False))
                    self._emitted = safe_len
                return out

            chunk = self._unescape(content[self._emitted : end])
            out.append((self._field_name, chunk, True))
            self._search_from = self._field_start + end + 1
            self._field_name = None
            self._field_start = 0
            self._emitted = 0

    @staticmethod
    def _find_unescaped_quote(s: str) -> int | None:
        i = 0
        while i < len(s):
            if s[i] == '"':
                backslashes = 0
                j = i - 1
                while j >= 0 and s[j] == "\\":
                    backslashes += 1
                    j -= 1
                if backslashes % 2 == 0:
                    return i
            i += 1
        return None

    @staticmethod
    def _unescape(s: str) -> str:
        return (
            s.replace('\\"', '"')
            .replace("\\n", "\n")
            .replace("\\t", "\t")
            .replace("\\\\", "\\")
        )


class ChatRequest(BaseModel):
    user_query: str
    thread_id: str | None = None


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


def _parse_rows(raw: object) -> list:
    """The data-viz subgraph stores query rows as a JSON string (sql_db_query
    -> json.dumps). Parse it back to a list for the chart event; anything
    unparseable becomes [] so the chart renders empty instead of breaking the
    stream."""
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            return []
        return parsed if isinstance(parsed, list) else []
    return []


async def stream_chat(user_query: str, thread_id: str) -> AsyncIterator[str]:
    config = {"configurable": {"thread_id": thread_id}}
    field_streamers: dict[tuple, _ReasonFieldStreamer] = {}

    # The data-viz subgraph sets chart_spec (generate_data_visual) and the raw
    # rows (execute_query) in node updates that arrive BEFORE the terminal
    # `respond` node. Hold the latest of each so we can emit one structured
    # chart event next to the final text answer.
    pending_chart_spec: dict | None = None
    pending_rows: object = None

    yield _sse({"type": "thread", "thread_id": thread_id})

    async for namespace, mode, chunk in terminal_chat.astream(
        {"user_query": user_query},
        config=config,
        stream_mode=["messages", "updates"],
        subgraphs=True,
    ):
        if mode == "messages":
            message_chunk, metadata = chunk
            node_name = metadata.get("langgraph_node")

            if node_name == "record_turn":
                continue

            content = message_chunk.content
            if not isinstance(content, list):
                continue

            key = (namespace, node_name)
            for block in content:
                if not isinstance(block, dict):
                    continue
                block_type = block.get("type")

                if block_type == "tool_use":
                    field_streamers[key] = _ReasonFieldStreamer()
                    yield _sse(
                        {
                            "type": "thinking",
                            "kind": "tool_call",
                            "node": node_name,
                            "subgraph": namespace[0] if namespace else None,
                            "tool": block.get("name"),
                        }
                    )
                elif block_type == "input_json_delta":
                    streamer = field_streamers.get(key)
                    partial = block.get("partial_json")
                    if streamer is None or not partial:
                        continue
                    for field_name, text, done in streamer.feed(partial):
                        if not text and not done:
                            continue
                        yield _sse(
                            {
                                "type": "thinking",
                                "kind": "reason_delta",
                                "node": node_name,
                                "subgraph": namespace[0] if namespace else None,
                                "field": field_name,
                                "content": text,
                                "done": done,
                            }
                        )
        elif mode == "updates":
            for node_name, node_output in chunk.items():
                if not node_output:
                    continue

                if "chart_spec" in node_output:
                    pending_chart_spec = node_output["chart_spec"]
                if "data_visual_response" in node_output:
                    pending_rows = node_output["data_visual_response"]

                if node_name in FINAL_ANSWER_NODES and "final_answer" in node_output:
                    if pending_chart_spec:
                        yield _sse(
                            {
                                "type": "chart",
                                "spec": pending_chart_spec,
                                "data": _parse_rows(pending_rows),
                            }
                        )
                    yield _sse(
                        {"type": "final", "content": node_output["final_answer"]}
                    )

    yield "data: [DONE]\n\n"


@router.post("/chat")
async def chat(request: Request, body: ChatRequest) -> StreamingResponse:
    """Stream a user question through the terminal chat graph as SSE."""
    thread_id = body.thread_id or str(uuid.uuid4())
    return StreamingResponse(
        stream_chat(body.user_query, thread_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
