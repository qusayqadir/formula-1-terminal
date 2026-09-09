from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import (
    START,
    END,
    StateGraph
)

from app.chatbot.state import AgentState
from app.chatbot.router.graph import router_graph
from app.chatbot.data_visual.graph import data_visual_graph
from app.chatbot.regulation.graph import regulation_graph
from app.chatbot.formula_1_general.graph import formula_1_general_graph

def out_of_scope_response(state: AgentState) -> AgentState:
    return {
        "final_answer": "I can help with Formula 1 regulations or data analysis questions. Please ask about F1 regulations (technical, financial, operational, or sporting) or questions that can be answered with historical F1 data."
    }

def record_turn(state: AgentState) -> AgentState:
    """Appends this turn to the thread's message history (persisted via the checkpointer)."""
    return {
        "messages": [
            HumanMessage(content=state["user_query"]),
            AIMessage(content=state["final_answer"]),
        ]
    }

def build_terminal_chat():

    builder = StateGraph(AgentState)

    builder.add_node(
        "router",
        router_graph,
    )

    builder.add_node(
        "regulation_subgraph",
        regulation_graph,
    )
    builder.add_node(
        "data_visual_subgraph",
        data_visual_graph
    )
    builder.add_node(
        "formula_1_general_subgraph",
        formula_1_general_graph
    )
    builder.add_node(
        "out_of_scope",
        out_of_scope_response
    )
    builder.add_node(
        "record_turn",
        record_turn
    )

    builder.add_edge(
        START,
        "router"
    )

    builder.add_conditional_edges(
        "router",
        lambda state: state.get("route", "OUT_OF_SCOPE"),
        {
            "REGULATION": "regulation_subgraph",
            "VISUALIZATION": "data_visual_subgraph",
            "FORMULA_1_GENERAL": "formula_1_general_subgraph",
            "OUT_OF_SCOPE": "out_of_scope"
        }
    )

    builder.add_edge("regulation_subgraph", "record_turn")
    builder.add_edge("data_visual_subgraph", "record_turn")
    builder.add_edge("formula_1_general_subgraph", "record_turn")
    builder.add_edge("out_of_scope", "record_turn")
    builder.add_edge("record_turn", END)

    return builder.compile(checkpointer=InMemorySaver())


terminal_chat = build_terminal_chat()
# terminal_chat.get_graph(xray=True).draw_mermaid_png()
