from langchain_core.messages import HumanMessage, SystemMessage

from app.chatbot.core.models import general_model
from app.chatbot.formula_1_general.prompt import FORMULA_1_GENERAL_SYSTEM_PROMPT
from app.chatbot.state import AgentState


def generate_general_response(state: AgentState) -> AgentState:
    response = general_model.invoke(
        [
            SystemMessage(
                content=[
                    {
                        "type": "text",
                        "text": FORMULA_1_GENERAL_SYSTEM_PROMPT,
                        "cache_control": {"type": "ephemeral"},
                    }
                ]
            ),
            HumanMessage(content=state["user_query"]),
        ]
    )

    answer = response.content if isinstance(response.content, str) else str(response.content)

    return {
        "formula_1_general_response": answer,
        "final_answer": answer,
    }
