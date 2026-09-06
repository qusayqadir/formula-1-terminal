from pydantic import BaseModel
from typing import Literal

class GenerateResponse(BaseModel): 
    answer: str 
    confidence: float
    graph_of_choice: str 
    
class ValidationResponse(BaseModel):
    is_valid: bool
    confidence: float
    reason: str


class ReWriteQuery(BaseModel):
    new_query: str


class ChartSpec(BaseModel):
    chart_type: Literal["bar", "grouped_bar", "stacked_bar", "line", "area", "scatter", "pie"]
    title: str
    subtitle: str | None = None
    x_field: str
    y_fields: list[str]
    series_field: str | None = None
    x_label: str | None = None
    y_label: str | None = None
    color_by: Literal["team", "driver", "categorical", "sequential"] = "categorical"
    reasoning: str
    # Natural-language answer to the user's question, grounded in the actual
    # rows — this is what the chat shows as the assistant's reply above the chart.
    response: str
