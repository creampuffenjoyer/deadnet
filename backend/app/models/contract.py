import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import relationship

from app.database import Base


class ContractRarity(str, enum.Enum):
    COMMON = "COMMON"
    RARE = "RARE"
    CLASSIFIED = "CLASSIFIED"


class ContractCategory(str, enum.Enum):
    WEB = "Web"
    CRYPTOGRAPHY = "Cryptography"
    FORENSICS = "Forensics"
    PWN = "Pwn"
    MISC = "Misc"
    OSINT = "OSINT"
    REVERSE_ENGINEERING = "Reverse Engineering"
    SQL_INJECTION = "SQL Injection"
    STEGANOGRAPHY = "Steganography"
    NETWORK = "Network"
    MOBILE = "Mobile"
    CLOUD = "Cloud"
    BLOCKCHAIN = "Blockchain"
    HARDWARE = "Hardware"
    BINARY_EXPLOITATION = "Binary Exploitation"
    SOCIAL_ENGINEERING = "Social Engineering"


class BcEventType(str, enum.Enum):
    CONTRACT_CLAIMED = "CONTRACT_CLAIMED"
    INTEL_PURCHASED = "INTEL_PURCHASED"


class Contract(Base):
    __tablename__ = "contracts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id = Column(Integer, ForeignKey("events.id", ondelete="SET NULL"), nullable=True)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=False, default="")
    category = Column(Enum(ContractCategory), nullable=False)
    rarity = Column(Enum(ContractRarity), nullable=False)
    base_bc_value = Column(Integer, nullable=False)
    flag = Column(String(500), nullable=False)
    is_published = Column(Boolean, default=False, nullable=False)
    is_void = Column(Boolean, default=False, server_default="false", nullable=False)
    max_attempts = Column(Integer, default=0, server_default="0", nullable=False)
    attachments = Column(JSON, default=list, nullable=False)
    tags = Column(JSON, default=list, nullable=True)
    # Set when the first Operative claims this contract (drives decay + first blood)
    first_claimed_at          = Column(DateTime, nullable=True)
    first_blood_operative_id  = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    org_id = Column(Integer, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    # Session 18 — Major Event fields
    contributing_org_id    = Column(Integer, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True)
    is_blocked_for_own_org = Column(Boolean, nullable=False, default=False, server_default="false")
    # Contract archive system
    is_archived        = Column(Boolean, default=False, nullable=False, server_default="false")
    archived_at        = Column(DateTime, nullable=True)
    source_contract_id = Column(UUID(as_uuid=True), ForeignKey("contracts.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    intel_drops = relationship(
        "IntelDrop",
        back_populates="contract",
        order_by="IntelDrop.order_index",
        cascade="all, delete-orphan",
    )
    claims = relationship("Claim", back_populates="contract", cascade="all, delete-orphan")


class IntelDrop(Base):
    __tablename__ = "intel_drops"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contract_id = Column(
        UUID(as_uuid=True),
        ForeignKey("contracts.id", ondelete="CASCADE"),
        nullable=False,
    )
    cost_bc = Column(Integer, nullable=False, default=30)
    content = Column(Text, nullable=False)
    order_index = Column(Integer, nullable=False, default=0)

    contract = relationship("Contract", back_populates="intel_drops")
    purchases = relationship(
        "IntelPurchase", back_populates="intel_drop", cascade="all, delete-orphan"
    )


class Claim(Base):
    __tablename__ = "claims"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id = Column(Integer, ForeignKey("events.id", ondelete="SET NULL"), nullable=True)
    contract_id = Column(
        UUID(as_uuid=True),
        ForeignKey("contracts.id", ondelete="CASCADE"),
        nullable=False,
    )
    operative_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    # team_id FK added in Session 3 when Team model exists
    team_id = Column(UUID(as_uuid=True), nullable=True)
    bc_earned = Column(Integer, nullable=False)
    is_first_blood = Column(Boolean, default=False, nullable=False)
    claimed_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    contract = relationship("Contract", back_populates="claims")
    operative = relationship("User", foreign_keys=[operative_id])


class IntelPurchase(Base):
    __tablename__ = "intel_purchases"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id = Column(Integer, ForeignKey("events.id", ondelete="SET NULL"), nullable=True)
    intel_drop_id = Column(
        UUID(as_uuid=True),
        ForeignKey("intel_drops.id", ondelete="CASCADE"),
        nullable=False,
    )
    operative_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    bc_spent = Column(Integer, nullable=False)
    purchased_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    intel_drop = relationship("IntelDrop", back_populates="purchases")
    operative = relationship("User", foreign_keys=[operative_id])


class BcEvent(Base):
    """Audit trail + data source for the BC-over-time graph on the Bounty Board."""

    __tablename__ = "bc_events"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id = Column(Integer, ForeignKey("events.id", ondelete="SET NULL"), nullable=True)
    operative_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    # team_id FK added in Session 3
    team_id = Column(UUID(as_uuid=True), nullable=True)
    event_type = Column(Enum(BcEventType), nullable=False)
    bc_delta = Column(Integer, nullable=False)       # positive = earned, negative = spent
    bc_total_after = Column(Integer, nullable=False)  # running total after this event
    contract_id = Column(
        UUID(as_uuid=True),
        ForeignKey("contracts.id", ondelete="SET NULL"),
        nullable=True,
    )
    org_id = Column(Integer, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)

    operative = relationship("User", foreign_keys=[operative_id])


class VoidClaim(Base):
    """Tracks VO1D contract claims — separate from main claims, no BC events written."""

    __tablename__ = "void_claims"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contract_id = Column(
        UUID(as_uuid=True),
        ForeignKey("contracts.id", ondelete="CASCADE"),
        nullable=False,
    )
    operative_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    team_id = Column(UUID(as_uuid=True), nullable=True)
    claimed_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    contract = relationship("Contract", foreign_keys=[contract_id])
    operative = relationship("User", foreign_keys=[operative_id])

    __table_args__ = (
        UniqueConstraint("contract_id", "operative_id", name="uq_void_claim"),
    )


class VoidAttempt(Base):
    """Tracks wrong flag submission attempts per (operative, void_contract). Hard cap: 5."""

    __tablename__ = "void_attempts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    contract_id = Column(
        UUID(as_uuid=True),
        ForeignKey("contracts.id", ondelete="CASCADE"),
        nullable=False,
    )
    operative_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    attempts = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("contract_id", "operative_id", name="uq_void_attempt"),
    )


class ContractAttempt(Base):
    """Tracks wrong flag submissions per (operative, contract) — persists for the whole competition."""

    __tablename__ = "contract_attempts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    operative_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    contract_id = Column(
        UUID(as_uuid=True),
        ForeignKey("contracts.id", ondelete="CASCADE"),
        nullable=False,
    )
    attempt_count = Column(Integer, nullable=False, default=0)
    last_attempt_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (UniqueConstraint("operative_id", "contract_id", name="uq_attempt_operative_contract"),)
