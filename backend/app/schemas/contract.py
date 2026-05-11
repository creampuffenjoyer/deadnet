from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

from app.models.contract import BcEventType, ContractCategory, ContractRarity


class IntelDropCreate(BaseModel):
    content: str
    cost_bc: int = 30


class ContractCreateRequest(BaseModel):
    title: str
    description: str
    category: ContractCategory
    rarity: ContractRarity
    base_bc_value: int
    flag: str = Field(..., min_length=1, max_length=500)
    is_published: bool = False
    intel_drops: List[IntelDropCreate] = []


class ClaimRequest(BaseModel):
    flag: str


class ClaimResponse(BaseModel):
    bc_earned: int
    is_first_blood: bool
    bc_total: int
    message: str


class IntelDropOut(BaseModel):
    id: str
    cost_bc: int
    order_index: int
    is_purchased: bool
    content: Optional[str] = None  # only present when purchased or privileged role

    @field_validator("id", mode="before")
    @classmethod
    def coerce_uuid(cls, v):
        return str(v)


class ContractOut(BaseModel):
    id: str
    title: str
    category: ContractCategory
    rarity: ContractRarity
    base_bc_value: int
    current_bc_value: int
    is_published: bool
    claim_count: int
    is_first_blood_taken: bool
    is_claimed_by_me: bool
    attachments: list
    created_at: datetime

    @field_validator("id", mode="before")
    @classmethod
    def coerce_uuid(cls, v):
        return str(v)


class ContractDetailOut(ContractOut):
    description: str
