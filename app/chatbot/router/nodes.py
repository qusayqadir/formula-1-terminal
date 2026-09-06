from app.chatbot.router.prompts import ROUTER_SYSTEM_PROMPT
from langchain_core.messages import HumanMessage, SystemMessage

from app.chatbot.router.schemas import RouteDecision
from app.chatbot.core.models import analysis_model
from app.chatbot.state import AgentState

def classify_domain(state: AgentState) -> AgentState:

    structured_model = analysis_model.with_structured_output(RouteDecision)
    
    recent = state.get("messages", [])[-6:]  # ~last 3 turns
    transcript = "\n".join(
        f"{'User' if isinstance(m, HumanMessage) else 'Assistant'}: {m.content}"
        for m in recent
    )
    # Sticky: a chart stays visible in the thread once produced, so this reads
    # "a chart exists in this conversation", not "last turn was a chart".
    chart_on_screen = bool(state.get("chart_spec"))

    context = (
        (f"Conversation so far:\n{transcript}\n\n" if transcript else "")
        + ("A data chart is currently displayed to the user.\n\n" if chart_on_screen else "")
        + f"Latest user message:\n{state['user_query']}"
    )

    decision = structured_model.invoke(
        [
            SystemMessage(
                content=ROUTER_SYSTEM_PROMPT
            ),
            HumanMessage(
                content=context
            )
        ]
    )

    return {
        "route": decision.route,
        "route_confidence": decision.confidence,
        "route_reason": decision.route_reason
    }

def chosen_route(state: AgentState) -> str: 

    route = state.get("route")
    if not route:
        raise ValueError(
            "No route was set by classify_domain"
        )
    
    return route 