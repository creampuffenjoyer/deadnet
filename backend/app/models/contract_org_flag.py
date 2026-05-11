import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class ContractOrgFlag(Base):
    """Stores per-org dynamic flag variants for Major Event contracts."""
    __tablename__ = "contract_org_flags"
    __table_args__ = (
        UniqueConstraint("contract_id", "org_id", name="uq_contract_org_flag"),
    )

    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contract_id = Column(UUID(as_uuid=True), ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False)
    org_id      = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    flag_hash   = Column(String(500), nullable=False)   # bcrypt hash of the org-specific flag
    created_at  = Column(DateTime, nullable=False, default=datetime.utcnow)
