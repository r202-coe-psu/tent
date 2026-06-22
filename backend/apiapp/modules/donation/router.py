from fastapi import APIRouter, Depends, status
from .schemas import DonationPreDeclarationInput, DonationResponse, DonationDetailResponse
from .use_case import DonationUseCase, get_donation_use_case

router = APIRouter(prefix="/v1/donations", tags=["Donation"])

@router.post("", response_model=DonationResponse, status_code=status.HTTP_201_CREATED)
async def create_donation(
    payload: DonationPreDeclarationInput,
    use_case: DonationUseCase = Depends(get_donation_use_case)
):
    return await use_case.create_donation(payload)

@router.get("/{tracking_token}", response_model=DonationDetailResponse)
async def get_donation(
    tracking_token: str,
    use_case: DonationUseCase = Depends(get_donation_use_case)
):
    return await use_case.get_donation_by_token(tracking_token)
