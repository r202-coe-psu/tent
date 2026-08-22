from datetime import datetime
from typing import Literal

from beanie import Document
from pydantic import ConfigDict, Field


class PublicAnnouncement(Document):
    """
    Public snapshot of a system announcement, stored in MongoDB `public_announcements`.
    Sourced from `announcement` docs in CouchDB `registry`.
    """

    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(alias="_id", description="The CouchDB announcement document ID")
    title: str
    description: str
    title_en: str | None = None
    description_en: str | None = None
    severity: Literal["info", "warning", "emergency"]
    is_active: bool
    updated_at: datetime

    class Settings:
        name = "public_announcements"
