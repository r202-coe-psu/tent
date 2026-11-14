"""Request/response schemas for `/v1/integrations/m6/*` (draft CR — central warehouse M6 §6).

M6 quantities may arrive as `20` or `20.0` (guide v2.1), so every quantity that comes from
M6 goes through `Qty`, which coerces to a whole number.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any

from pydantic import BaseModel, BeforeValidator, Field


def _to_int(value: Any) -> Any:
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, float | str):
        try:
            return int(float(value))
        except ValueError:
            return value
    return value


def _none_to_empty(value: Any) -> Any:
    return "" if value is None else value


def _to_cursor(value: Any) -> Any:
    return None if value in (None, "") else str(value)


Qty = Annotated[int, BeforeValidator(_to_int)]
OptQty = Annotated[int | None, BeforeValidator(_to_int)]
# M6 sometimes sends null for text columns; our contract says string.
Text = Annotated[str, BeforeValidator(_none_to_empty)]
Cursor = Annotated[str | None, BeforeValidator(_to_cursor)]


class M6Status(BaseModel):
    configured: bool
    token_ok: bool
    reachable: bool
    resource_types: list[str] = Field(default_factory=list)
    scopes: list[str] = Field(default_factory=list)
    checked_at: datetime | None = None
    # `not_configured` | `credential_invalid` | `unavailable` | None
    error: str | None = None


# --- RES-001 / 002 / 003 ----------------------------------------------------------------


class M6Warehouse(BaseModel):
    warehouse_code: str
    name: Text
    district: str | None = None
    lat: float | None = None
    lng: float | None = None


class M6WarehousesResponse(BaseModel):
    data: list[M6Warehouse]
    total: Qty


class M6StockItem(BaseModel):
    item_code: str
    reference_id: int | str | None = None
    name: Text
    type_code: Text
    unit: Text
    on_hand: Qty
    available: Qty


class M6StockResponse(BaseModel):
    warehouse_code: str
    data: list[M6StockItem]
    total: Qty


class M6CatalogItem(BaseModel):
    reference_id: int | str
    name_th: Text
    name_en: str | None = None
    type_code: Text
    base_unit: str | None = None
    warehouses_count: Qty = 0
    item_code: str | None = None
    in_warehouse: bool | None = None


class M6CatalogResponse(BaseModel):
    data: list[M6CatalogItem]
    cursor: Cursor = None
    total: Qty = 0


# --- RES-005 request --------------------------------------------------------------------


class M6RequesterIn(BaseModel):
    location_code: str = Field(min_length=1, max_length=64)
    location_type: str = Field(min_length=1, max_length=32)
    location_name: str = Field(min_length=1, max_length=255)
    contact_name: str = Field(min_length=1, max_length=128)
    contact_role: str = Field(min_length=1, max_length=128)
    contact_phone: str = Field(min_length=1, max_length=32)
    external_ref: str = Field(min_length=1, max_length=64)


class M6DestinationIn(BaseModel):
    location_code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)
    type: str = Field(min_length=1, max_length=32)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    address: str = Field(min_length=1)


class M6LineIn(BaseModel):
    item_code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)
    unit: str = Field(min_length=1, max_length=32)
    type_code: str | None = None
    qty: int = Field(ge=1)


class M6ActorIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    username: str | None = None


class M6WithdrawalCreateRequest(BaseModel):
    shelter_code: str = Field(min_length=1)
    external_ref: str = Field(min_length=1, max_length=64)
    source_warehouse_code: str = Field(min_length=1, max_length=64)
    source_warehouse_name: str | None = None
    requester: M6RequesterIn
    destination: M6DestinationIn
    reason: str = Field(min_length=1)
    lines: list[M6LineIn] = Field(min_length=1)
    actor: M6ActorIn


class M6CancelRequest(BaseModel):
    shelter_code: str = Field(min_length=1)
    reason: str = Field(min_length=1)
    actor: M6ActorIn


# --- views ------------------------------------------------------------------------------


class M6LineView(BaseModel):
    item_code: str
    name: str
    unit: str
    type_code: str | None = None
    qty: int
    qty_fulfilled: int | None = None


class M6PersonView(BaseModel):
    name: str
    username: str | None = None


class M6WithdrawalView(BaseModel):
    external_ref: str
    request_code: str
    shelter_code: str
    status: str
    source_warehouse_code: str
    source_warehouse_name: str | None = None
    lines: list[M6LineView]
    reason: str
    requested_by: M6PersonView
    contact_role: str | None = None
    contact_phone: str | None = None
    submitted_at: datetime | None = None
    approved_at: datetime | None = None
    completed_at: datetime | None = None
    cancelled_at: datetime | None = None
    cancel_reason: str | None = None
    donation_id: str | None = None
    confirmed_at: datetime | None = None
    confirm_error: str | None = None
    fetched_at: datetime
    created_at: datetime
    # True when this response was refreshed from RES-006 just now.
    live: bool = False


class M6WithdrawalListResponse(BaseModel):
    data: list[M6WithdrawalView]
    total: int


class M6SyncResponse(BaseModel):
    polled: int = 0
    changed: int = 0
    confirmed: int = 0
    confirm_failed: int = 0
