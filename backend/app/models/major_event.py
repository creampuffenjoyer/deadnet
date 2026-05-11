import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class MajorEventPartner(Base):
    """Tracks partner organizations participating in a Major Event."""
    __tablename__ = "major_event_partners"
    __table_args__ = (
        UniqueConstraint("event_id", "org_id", name="uq_major_partner_event_org"),
    )

    id        = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id  = Column(Integer, ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    org_id    = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    joined_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    joined_by = Column(String(100), nullable=True)   # callsign of joining Admin
    status    = Column(String(20), nullable=False, default="ACTIVE", server_default="ACTIVE")
    # status: ACTIVE | WITHDRAWN

    # Per-partner registration key for Operative self-enrollment
    registration_key = Column(String(20), nullable=True)

    # PARTNER = selected at event creation (can lend contractors)
    # PARTICIPANT = joined via invite code (read-only access)
    role = Column(String(20), nullable=False, default="PARTNER", server_default="PARTNER")


class MajorEventContractor(Base):
    """Tracks borrowed Contractors per Major Event."""
    __tablename__ = "major_event_contractors"
    __table_args__ = (
        UniqueConstraint("event_id", "contractor_id", name="uq_major_contractor_event_user"),
    )

    id            = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id      = Column(Integer, ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    contractor_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    org_id        = Column(Integer, ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    added_at      = Column(DateTime, nullable=False, default=datetime.utcnow)
    added_by      = Column(String(100), nullable=True)   # callsign of Admin who added
    status        = Column(String(20), nullable=False, default="ACTIVE", server_default="ACTIVE")
    # status: ACTIVE | REMOVED
