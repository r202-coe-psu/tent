import math

from fastapi import APIRouter, Query
from pydantic import BaseModel
from tent_model.public_announcement import PublicAnnouncement

router = APIRouter(prefix="/public/v1/announcements", tags=["Announcements"])


class PaginatedAnnouncements(BaseModel):
    items: list[PublicAnnouncement]
    total: int
    page: int
    size: int
    total_pages: int


@router.get("", response_model=PaginatedAnnouncements)
async def get_active_announcements(
    page: int = Query(1, ge=1, description="Page number"),
    size: int = Query(20, ge=1, le=100, description="Items per page"),
) -> PaginatedAnnouncements:
    """Retrieve active announcements sorted by newest first, paginated."""
    query = PublicAnnouncement.find(PublicAnnouncement.is_active == True)  # noqa: E712
    total = await query.count()
    total_pages = math.ceil(total / size) if total > 0 else 0

    announcements = await query.sort("-updated_at").skip((page - 1) * size).limit(size).to_list()

    return PaginatedAnnouncements(
        items=announcements, total=total, page=page, size=size, total_pages=total_pages
    )
