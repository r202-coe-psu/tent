from pydantic import BaseModel
from typing import Any

class FaqItem(BaseModel):
    id: str | None = None
    question: str
    answer: str
    is_published: bool = True
    order: int = 0

class ConfigResponse(BaseModel):
    faqs: list[FaqItem] = []
