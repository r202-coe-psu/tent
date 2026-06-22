from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

class DonorInfo(BaseModel):
    name: str
    phone: str
    line_id: Optional[str] = None
    email: Optional[str] = None

class DeclaredItem(BaseModel):
    item_name: str
    category: Optional[str] = None
    qty: float
    unit: str
    condition: Optional[str] = None
    note: Optional[str] = None

class LogisticsSlot(BaseModel):
    date: str
    from_: str = Field(alias="from")
    to: str

class LogisticsInfo(BaseModel):
    delivery_method: str
    vehicle: Optional[str] = None
    slot: Optional[LogisticsSlot] = None
    eta: Optional[datetime] = None
    courier_tracking_no: Optional[str] = None

class DonationPreDeclarationInput(BaseModel):
    shelter_code: str
    donor: DonorInfo
    items_declared: List[DeclaredItem]
    logistics: Optional[LogisticsInfo] = None
    captchaToken: Optional[str] = None

class DonationResponse(BaseModel):
    success: bool
    trackingToken: str
    booking_ref: Optional[str] = None
    as_of: datetime

class PublicDonationDetail(BaseModel):
    status: str
    shelter_code: str
    booking_ref: Optional[str] = None
    items_declared: List[DeclaredItem]
    logistics: Optional[LogisticsInfo] = None
    received_summary: Optional[str] = None
    created_at: str
    expires_at: str

class DonationDetailResponse(BaseModel):
    success: bool
    donation: PublicDonationDetail
