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
    line_oa_url: str | None = None
    facebook_url: str | None = None
    phone_number: str | None = None
