from langgraph.graph import (
    START,
    END,
    StateGraph,
)

from app.chatbot.state import AgentState
from app.chatbot.formula_1_general.nodes import generate_general_response


def build_formula_1_general_graph():

    builder = StateGraph(AgentState)

    builder.add_node(
        "generate_general_response",
        generate_general_response,
    )

    builder.add_edge(
        START,
        "generate_general_response",
    )

    builder.add_edge(
        "generate_general_response",
        END,
    )

    return builder.compile()


formula_1_general_graph = build_formula_1_general_graph()
