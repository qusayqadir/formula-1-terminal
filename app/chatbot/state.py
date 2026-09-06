from typing import Annotated, Literal, TypedDict

from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages


RouteName = Literal[
    "REGULATION",
    "VISUALIZATION",
    "OUT_OF_SCOPE",
]

ReglationTypes = Literal[
    "TECHNICAL",
    "FINANCIAL_TEAM",
    "FINANCIAL_PU_MANUFACTURERS",
    "OPERATIONAL",
    "SPORTING"
]
#total is false, when route begins you may only have {query: "(user quert)} the route later adds route, confidence, reason, and the final branch 
# adds response 
class RouterState(TypedDict, total=False):
    """
    Shared state passed between every node in the graph.

    total=False means fields may be added gradually as the graph runs.
    """

    route: RouteName
    confidence: float
    reason: str
    response: str

class RetrievedDocument(TypedDict):

    filename: str | None
    season: str | None
    regulation_type: list[str]
    section_type: str | None
    section_number: str | None


# state is internal workflow memory 
class AgentState(TypedDict, total=False):

    user_query: str

    # Multi-turn history, persisted per thread_id by the checkpointer.
    messages: Annotated[list[AnyMessage], add_messages]

    # Router Output
    route: RouteName
    route_confidence: float
    route_reason: str

    # Regulation Output
    doc_metadata: RetrievedDocument
    retrieved_docs: list[dict]
    reranked_docs: list[dict]
    regulation_response: str
    regulation_response_confidence: float

    # Validation / rewrite loop
    validate_response_is_valid: bool
    validate_response_confidence: float
    validate_response_reason: str
    rewritten_query: str
    validation_count: int

    #DataVis Output
    list_of_tables: str 
    table_schemas: str 
    generated_sql_query: str 
    generated_sql_confidence: float 

    validate_query_is_valid: bool 
    validate_sql_response_confidence: float
    validate_sql_response_reason: str 
    validation_sql_count: int 
    data_visual_response: str      # raw SQL rows (JSON string)
    graph_of_choice: str
    chart_spec: dict
    data_visual_answer: str        # agent's natural-language summary of the rows


    #Output
    final_answer: str


     
