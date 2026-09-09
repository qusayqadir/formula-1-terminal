from typing import Literal
from app.chatbot.regulation.prompt import (
    REGULATION_SYSTEM_PROMPT,
    REGULATION_QUERY_ANAYLSIS_PROMPT,
    VALIDATE_RESPONSE_PROMPT,
    REWRITE_QUERY_PROMPT,
)
from langchain_core.messages import (
    SystemMessage,
    HumanMessage,
)
from app.chatbot.state import AgentState
from app.chatbot.core.models import (
    analysis_model, 
    answer_model, 
)

from app.chatbot.regulation.schemas import (
    RetrievedDocumentMetadata,
    RegulationAnswer,
    ValidationResponse,
    ReWriteQuery,
)
import voyageai

from core.database import (
    get_mongo_connection
)

import os
from dotenv import load_dotenv

load_dotenv()

#determine which season, and regulation type 

vo = voyageai.Client()
def analyze_query(state: AgentState) -> AgentState:

    structured_model = analysis_model.with_structured_output(RetrievedDocumentMetadata)

    docs=structured_model.invoke(
        [
            SystemMessage(
                content=REGULATION_QUERY_ANAYLSIS_PROMPT, 
            ),
            HumanMessage(
                content=state["user_query"]
            )
        ]
    )

    return {
        "doc_metadata": {
            "filename": docs.filename,
            "season" : docs.season, 
            "regulation_type": docs.regulation_type,
            "section_type": docs.section_type, 
            "section_number": docs.section_number 
        }
    }


def retrieve_docs(state: AgentState):

    result = vo.contextualized_embed(
        inputs=[[state["user_query"]]],
        model="voyage-context-3",
        input_type="query",
        output_dimension=1024,
    )
    query_vector = result.results[0].embeddings[0]

    mongodb_client = get_mongo_connection()
    db = mongodb_client[os.environ["MONGODB_DATABASE_NAME"]]
    collection = db["regulation_embeddings"]

    meta = state["doc_metadata"]

    # Only filter on fields the query analysis actually found.
    # Empty / "unknown" values are skipped so they don't match zero documents.
    metadata_filter = {}
    if meta.get("season") and meta["season"] not in ("unknown", "latest"):
        metadata_filter["metadata.season"] = meta["season"]
    if meta.get("filename"):
        metadata_filter["metadata.filename"] = meta["filename"]
    if meta.get("regulation_type"):
        metadata_filter["metadata.regulation_type"] = {"$in": meta["regulation_type"]}
    if meta.get("section_type"):
        metadata_filter["metadata.section_type"] = meta["section_type"]
    if meta.get("section_number"):
        metadata_filter["metadata.section_number"] = meta["section_number"]


    #semantic search, not keyword search
    cursor = collection.aggregate([
        {
            "$vectorSearch": {
                "index": "vector_index",
                "path": "voyage_embedding",
                "queryVector": query_vector,
                "numCandidates": 50,
                "limit": 50,
                "filter": metadata_filter,
            }
        },
        {
            "$project": {
                "_id": 1,
                "text": 1,
                "score": {"$meta": "vectorSearchScore"}
            }
        }
    ])

    docs = list(cursor)
    for d in docs:
        d["_id"] = str(d["_id"])

    #include keyword search for hybrid search
    return {
        "retrieved_docs": docs
    }

def rerank_docs(state: AgentState):

    docs = state["retrieved_docs"]

    if not docs:
        return {"reranked_docs": []}

    reranked = vo.rerank(
        query=state["user_query"],
        documents=[d["text"] for d in docs],
        model="rerank-2.5-lite",
        top_k=8,
    )

    return {
        "reranked_docs": [docs[r.index] for r in reranked.results]
    }

# Hard ceiling on the retrieved-context we feed the LLMs. FIA regulation chunks
# are very large (~50K chars / ~13K tokens each), so an unbounded join of the
# reranked set can blow past the model context window — the Haiku validator
# (200K tokens) overflowed at 258K on a 20-chunk join. ~160K chars ≈ ~40K
# tokens leaves ample room for the prompt, question, candidate answer, and
# output on both Sonnet (generation) and Haiku (validation).
MAX_CONTEXT_CHARS = 160_000


def _build_context(reranked_docs: list[dict]) -> str:
    """Join reranked chunks (already ordered most-relevant-first) up to a fixed
    character budget, truncating the chunk that crosses the budget rather than
    dropping it, so the highest-ranked context always makes it in."""
    parts: list[str] = []
    budget = MAX_CONTEXT_CHARS
    for doc in reranked_docs:
        if budget <= 0:
            break
        text = doc.get("text", "")
        if len(text) > budget:
            text = text[:budget]
        parts.append(text)
        budget -= len(text)
    return "\n\n---\n\n".join(parts)

def generate_response(state: AgentState) -> AgentState:

    context = _build_context(state["reranked_docs"])

    structured_model = answer_model.with_structured_output(RegulationAnswer)

    agent_response = structured_model.invoke(
        [
            SystemMessage(
                content=REGULATION_SYSTEM_PROMPT
            ),
            HumanMessage(
                content=f"Context:\n{context}\n\nQuestion:\n{state['user_query']}"
                ),
        ]
    )
    return {
        "regulation_response": agent_response.answer,
        "regulation_response_confidence": agent_response.confidence,
    }

def validate_response(state: AgentState) -> AgentState:

    validator = analysis_model.with_structured_output(ValidationResponse)

    context = _build_context(state["reranked_docs"])

    validation_response = validator.invoke(
        [
            SystemMessage(
                content=VALIDATE_RESPONSE_PROMPT
            ),
            HumanMessage(
                content=(
                    f"Question:\n{state['user_query']}\n\n"
                    f"Retrieved context:\n{context}\n\n"
                    f"Candidate answer:\n{state['regulation_response']}"
                )
            ),
        ]
    )

    return {
        "validate_response_is_valid": validation_response.is_valid,
        "validate_response_confidence": validation_response.confidence,
        "validate_response_reason": validation_response.reason,
    }


def rewrite_query(state: AgentState) -> AgentState: 

    rewriter = answer_model.with_structured_output(ReWriteQuery)

    rewritten_query = rewriter.invoke(
        [
            SystemMessage(
                content=REWRITE_QUERY_PROMPT
            ),
            HumanMessage(
                content=(
                    f"User query: {state['user_query']}\n"
                    f"Reason previous attempt was insufficient: {state['validate_response_reason']}"
                )
            ),
        ]
    )

    return {
        "user_query": rewritten_query.new_query,
        "validation_count": state.get("validation_count", 0) + 1,
    }

MAX_VALIDATION_ATTEMPTS = 2

def chosen_route(state: AgentState) -> Literal["respond", "rewrite_query"]:

    is_valid = state.get("validate_response_is_valid", False)
    confidence = state.get("validate_response_confidence") or 0.0

    if is_valid and confidence >= 0.7:
        return "respond"


    if state.get("validation_count", 0) >= MAX_VALIDATION_ATTEMPTS:
        return "respond"

    return "rewrite_query" 



LOW_CONFIDENCE_PREFIX = (
    "I couldn't find a fully confident answer to your question in the FIA "
    "regulation documents, but here is the closest relevant information I found:\n\n"
)

def respond(state: AgentState) -> AgentState:

    is_valid = state.get("validate_response_is_valid", False)
    confidence = state.get("validate_response_confidence") or 0.0
    ran_out_of_attempts = state.get("validation_count", 0) >= MAX_VALIDATION_ATTEMPTS

    answer = state["regulation_response"]
    if ran_out_of_attempts and not (is_valid and confidence >= 0.7):
        answer = LOW_CONFIDENCE_PREFIX + answer

    return {
        "final_answer": answer
    }