from typing import Literal

from app.chatbot.state import AgentState
from app.chatbot.data_visual.prompt import (
    VALIDATE_SQL_RESPONSE_PROMPT,
    REWRITE_SQL_QUERY_PROMPT,
    GENERATE_SQL_QUERY_PROMPT,
    GENERATE_DATA_VISUALIZATION_PROMPT 
)
from app.chatbot.core.models import (
    answer_model, 
    analysis_model
)
from langchain_core.messages import (
    HumanMessage, 
    SystemMessage
)

from app.chatbot.data_visual.schemas import (
    GenerateResponse,
    ReWriteQuery,
    ValidationResponse,
    ChartSpec
)

from core.database import (
    get_connection
)


def list_sql_tables() -> str:
    conn = get_connection()
    try:
        cursor = conn.execute(
            """
            SELECT table_name FROM information_schema.tables
            WHERE table_schema='bronze'
            ORDER by table_name
            """)
        tables = [
            row["table_name"]
            for row in cursor.fetchall()
        ]
        return ", ".join(tables)
    finally:
        conn.close()

def sql_table_schema(table_names: str) -> str:

    conn = get_connection()
    try:
        cursor = conn.execute(
            """
            SELECT table_name FROM information_schema.tables
            WHERE table_schema='bronze'
            """
        )
        valid_tables = {row["table_name"] for row in cursor.fetchall()}

        results = []
        for table_name in table_names.split(","):
            table_name = table_name.strip()

            if table_name not in valid_tables:
                results.append(f"Error: table {table_name!r} not found in bronze schema")
                continue

            cursor = conn.execute("""
                SELECT column_name, data_type, is_nullable
                FROM information_schema.columns
                WHERE table_schema='bronze' AND table_name=%s
                ORDER BY ordinal_position
            """, (table_name,))

            columns = cursor.fetchall()
            if columns:
                col_names = [col["column_name"] for col in columns]
                col_types = [col["data_type"] for col in columns]
                schema_str = f"CREATE TABLE bronze.{table_name} (\n"
                schema_str += ",\n".join(
                    f"  {name} {dtype}"
                    for name, dtype in zip(col_names, col_types)
                )
                schema_str += "\n);"
                results.append(schema_str)

                cursor = conn.execute(f"SELECT * FROM bronze.{table_name} LIMIT 3")
                rows = cursor.fetchall()
                if rows:
                    results.append(f"/* 3 sample rows from {table_name}:\n")
                    results.append("\t".join(col_names))
                    results.append("\n".join(
                        "\t".join(str(row[col]) if row[col] is not None else "NULL" for col in col_names)
                        for row in rows
                    ))
                    results.append("*/")

        return "\n\n".join(results)
    finally:
        conn.close()

def sql_db_query(query: str) -> str:
    import json

    conn = get_connection()

    try:
        cursor = conn.execute(query)
        rows = cursor.fetchall()
        return json.dumps(rows, indent=2, default=str)
    except Exception as e:
        return f"Error: {e}"
    finally:
        conn.close()


def list_tables(state: AgentState) -> AgentState:
    return {"list_of_tables": list_sql_tables()}


def describe_schema(state: AgentState) -> AgentState:
    return {"table_schemas": sql_table_schema(state["list_of_tables"])}


def generate_response(state: AgentState) -> AgentState:

    structured_model = answer_model.with_structured_output(GenerateResponse)

    recent = state.get("messages", [])[-6:]

    transcript = "\n".join(
        f"{'User' if isinstance(m, HumanMessage) else 'Assistant'}: {m.content}"
        for m in recent
    )
    
    prev_sql = state.get("generated_sql_query")
    prev_chart = (state.get("chart_spec") or {}).get("title")

    prior = ""
    if transcript:
        prior += f"\n\nRecent conversation:\n{transcript}"
    if prev_chart:
        prior += f"\n\nChart currently displayed to the user: {prev_chart}"
    if prev_sql:
        prior += (
            "\n\nSQL behind that chart (if the new question refines it — adds/removes a "
            "metric, changes a filter on the same subject — start from this and modify it, "
            "preserving its existing filters unless the user changes them):\n"
            f"{prev_sql}"
        )

    agent_response = structured_model.invoke(
        [
            SystemMessage(
                content=GENERATE_SQL_QUERY_PROMPT
            ),
            HumanMessage(
                content=(
                    f"Context:\n{state['list_of_tables']}\n and {state['table_schemas']}"
                    f"{prior}\n\nQuestion:\n{state['user_query']}"
                )
            ),
        ]
    )
    return {
        "generated_sql_query": agent_response.answer,
        "generated_sql_confidence": agent_response.confidence,
        "graph_of_choice" : agent_response.graph_of_choice
    }

def validate_response(state: AgentState) -> AgentState:

    sql = analysis_model.with_structured_output(ValidationResponse)

    sql_response = sql.invoke(
        [
            SystemMessage(
                content=VALIDATE_SQL_RESPONSE_PROMPT
            ),
            HumanMessage(
                content=(
                    f"Question:\n{state['user_query']}\n\n"
                    f"Table schemas:\n{state['table_schemas']}\n\n"
                    f"Generated SQL:\n{state['generated_sql_query']}\n\n"
                    f"Query result:\n{state['data_visual_response']}"
                )
            ),
        ]
    )

    return {
        "validate_query_is_valid": sql_response.is_valid,
        "validate_sql_response_confidence": sql_response.confidence,
        "validate_sql_response_reason": sql_response.reason,
    }

MAX_VALIDATION_ATTEMPTS = 2 

def chosen_route(state: AgentState) -> Literal["generate_data_visual", "rewrite_query", "respond"]:

    is_valid = state.get("validate_query_is_valid", False)
    confidence = state.get("validate_sql_response_confidence") or 0.0

    if is_valid and confidence >= 0.7:
        return "generate_data_visual"


    if state.get("validation_count", 0) >= MAX_VALIDATION_ATTEMPTS:
        return "respond"

    return "rewrite_query" 


def rewrite_query(state: AgentState) -> AgentState: 

    rewriter = answer_model.with_structured_output(ReWriteQuery)

    rewritten_query = rewriter.invoke(
        [
            SystemMessage(
                content=REWRITE_SQL_QUERY_PROMPT
            ),
            HumanMessage(
                content=(
                    f"User query: {state['user_query']}\n"
                    f"Previous SQL attempt: {state['generated_sql_query']}\n"
                    f"Query execution result/error: {state['data_visual_response']}\n"
                    f"Reason previous attempt was insufficient: {state['validate_sql_response_reason']}\n"
                    f"Table schemas:\n{state['table_schemas']}"
                )
            ),
        ]
    )

    return {
        "user_query": rewritten_query.new_query,
        "validation_count": state.get("validation_count", 0) + 1,
    }

# TALK ABOUT TRADEOFFS BETWEEN THIS AGENT RUNNING THE SQL? 
# DO I NEED THIS AGENT TO EXECUTE QUERY? 

def execute_query(state: AgentState) -> AgentState: 

    results = sql_db_query(state["generated_sql_query"])

    return {
        "data_visual_response" : results
    }

def generate_data_visual(state: AgentState) -> AgentState:
    data_agent = answer_model.with_structured_output(ChartSpec)

    spec = data_agent.invoke([
        SystemMessage(content=GENERATE_DATA_VISUALIZATION_PROMPT),
        HumanMessage(content=(
            f"User question:\n{state['user_query']}\n\n"
            f"Rows (JSON):\n{state['data_visual_response']}\n\n"
            f"Suggested chart type: {state.get('graph_of_choice')}"
        )),
    ])

    spec_dict = spec.model_dump()

    # chart_spec keeps the full structured output (incl. response); data_visual_answer
    # surfaces just the natural-language answer for `respond`/final_answer.
    return {
        "chart_spec": spec_dict,
        "data_visual_answer": spec_dict.get("response", ""),
    }

def respond(state: AgentState) -> AgentState:

    data = state.get("data_visual_response", "")

    if isinstance(data, str) and data.startswith("Error:"):
        return {
            "final_answer": (
                "I wasn't able to build a working query for that question after a few attempts. "
                "Could you rephrase it or narrow it down (e.g. specific season, driver, or table)?"
            )
        }


    answer = state.get("data_visual_answer") or ""
    if not answer.strip():
        spec = state.get("chart_spec") or {}
        answer = spec.get("title") or "Here's a chart for your question."

    return {"final_answer": answer}