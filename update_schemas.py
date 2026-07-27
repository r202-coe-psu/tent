from pydantic import BaseModel, Field
from datetime import datetime
from tent_model.public_shelter import GeoPoint

class ShelterListCapacityDetail(BaseModel):
    total: int
    available: int

class ShelterItem(BaseModel):
    code: str = Field(description="Shelter code, e.g. SH001")
    name: str
    status: str
    capacity: int = 0
    geo: GeoPoint | None = None
    province: str | None = None
    district: str | None = None
    subdistrict: str | None = None
    pet_policy: str | None = None
    admin_type: str | None = None
    updated_at: datetime
