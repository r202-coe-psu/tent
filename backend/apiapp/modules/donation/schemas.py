from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

class DonorInfo(BaseModel):
    name: str
    phone: str

class DeclaredItem(BaseModel):
    item_name: str
    qty: float
    unit: str

class DonationPreDeclarationInput(BaseModel):
    shelter_code: str
    donor: DonorInfo
    items_declared: List[DeclaredItem]
    captchaToken: Optional[str] = None

class DonationResponse(BaseModel):
    success: bool
    trackingToken: str
    as_of: datetime

class PublicDonationDetail(BaseModel):
    status: str
    shelter_code: str
    items_declared: List[DeclaredItem]
    received_summary: Optional[str] = None
    created_at: str
    expires_at: str

class DonationDetailResponse(BaseModel):
    success: bool
    donation: PublicDonationDetail
