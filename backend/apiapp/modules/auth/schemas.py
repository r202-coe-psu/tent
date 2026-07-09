from pydantic import BaseModel


class Message(BaseModel):
    detail: str


class VerifyResponse(BaseModel):
    status: str = "ok"
