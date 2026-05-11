import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class CCStatus(str, enum.Enum):
    DRAFT   = "DRAFT"
    ACTIVE  = "ACTIVE"
    EXPIRED = "EXPIRED"
    CLOSED  = "CLOSED"


class CorruptedContract(Base):
    __tablename__ = "corrupted_contracts"

    id               = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title            = Column(String(200), nullable=False)
    description      = Column(Text, nullable=True, default="")
    flag             = Column(String(500), nullable=False)
    category         = Column(String(50), nullable=False)
    duration_minutes = Column(Integer, nullable=False)
    activated_at     = Column(DateTime, nullable=True)
    expires_at       = Column(DateTime, nullable=True)
    status           = Column(Enum(CCStatus), default=CCStatus.DRAFT, nullable=False)
    created_by       = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    event_id         = Column(Integer, ForeignKey("events.id", ondelete="SET NULL"), nullable=True)
    created_at       = Column(DateTime, default=datetime.utcnow, nullable=False)
    bc_reward             = Column(Integer, nullable=False, default=100)
    max_attempts          = Column(Integer, default=5, nullable=False)
    has_attachment        = Column(Boolean, default=False, nullable=False)
    attachment_filename   = Column(String(255), nullable=True)   # original name shown to users
    attachment_path       = Column(String(500), nullable=True)   # server-side only, never exposed
    attachment_size       = Column(Integer, nullable=True)       # bytes
    org_id         = Column(Integer, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True)


class CorruptedClaim(Base):
    __tablename__ = "corrupted_claims"

    id            = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contract_id   = Column(UUID(as_uuid=True), ForeignKey("corrupted_contracts.id", ondelete="CASCADE"), nullable=False, index=True)
    operative_id  = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    event_id      = Column(Integer, ForeignKey("events.id", ondelete="SET NULL"), nullable=True)
    claimed_at    = Column(DateTime, default=datetime.utcnow, nullable=False)
    bc_awarded    = Column(Integer, nullable=False)


class CorruptedAttempt(Base):
    __tablename__ = "corrupted_attempts"
    __table_args__ = (UniqueConstraint("contract_id", "operative_id", name="uq_cc_attempt"),)

    id           = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contract_id  = Column(UUID(as_uuid=True), ForeignKey("corrupted_contracts.id", ondelete="CASCADE"), nullable=False, index=True)
    operative_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    attempts     = Column(Integer, default=0, nullable=False)
