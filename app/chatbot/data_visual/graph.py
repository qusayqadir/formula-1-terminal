from app.chatbot.state import AgentState
from langgraph.graph import (
    START,
    END, 
    StateGraph
)

from app.chatbot.data_visual.nodes import (
    list_tables,
    describe_schema,
    generate_response,
    execute_query,
    validate_response,
    rewrite_query,
    chosen_route,
    generate_data_visual, 
    respond
)

def build_data_visual_graph():

    builder = StateGraph(AgentState)

    # Deterministic tool nodes (list tables -> read schema -> run query) run in a
    # fixed order rather than being selected by the LLM. chosen_route is only used
    # as the conditional-edge function, so it is NOT added as a node.
    builder.add_node("list_tables", list_tables)
    builder.add_node("describe_schema", describe_schema)
    builder.add_node("generate_response", generate_response)
    builder.add_node("execute_query", execute_query)
    builder.add_node("validate_response", validate_response)
    builder.add_node("rewrite_query", rewrite_query)
    builder.add_node("generate_data_visual", generate_data_visual)
    builder.add_node("respond", respond)

    builder.add_edge(
        START, 
        "list_tables"
    )
    builder.add_edge(
        "list_tables",
         "describe_schema"
         )
    builder.add_edge(
        "describe_schema", 
        "generate_response"
        )
    builder.add_edge(
        "generate_response", 
        "execute_query"
        )
    builder.add_edge(
        "execute_query", 
        "validate_response")
        

    builder.add_conditional_edges(
        "validate_response",
        chosen_route,
        {
            "rewrite_query" : "rewrite_query",
            "generate_data_visual" : "generate_data_visual",
        }
    ) 

    builder.add_edge("rewrite_query", "generate_response")
    builder.add_edge("generate_data_visual", "respond")
    builder.add_edge("respond", END)

    return builder.compile()


data_visual_graph = build_data_visual_graph() 
# data_visual_graph.get_graph().draw_mermaid_png()

# # data_visual_graph → langgraph-images/data_visual_graph.png
# PYTHONPATH=. .venv/bin/python -c "from app.chatbot.data_visual.graph import data_visual_graph; open('langgraph-images/data_visual_graph.png','wb').write(data_visual_graph.get_graph().draw_mermaid_png())"

# # terminal_chat → langgraph-images/final-chat-graph.png
# PYTHONPATH=. .venv/bin/python -c "from app.chatbot.graph import terminal_chat; open('langgraph-images/final-chat-graph.png','wb').write(terminal_chat.get_graph(xray=True).draw_mermaid_png())"