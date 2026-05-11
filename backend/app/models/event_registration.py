import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base


class EventRegistration(Base):
    __tablename__ = "event_registrations"

    id             = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id       = Column(Integer, ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    user_id        = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    registered_at  = Column(DateTime, default=datetime.utcnow, nullable=False)
    registered_by  = Column(String(10), nullable=False, default="SELF")   # SELF / ADMIN
    status         = Column(String(10), nullable=False, default="ACTIVE")  # ACTIVE / REMOVED
    removed_at     = Column(DateTime, nullable=True)
    removed_by     = Column(String(100), nullable=True)
    removal_reason = Column(String(500), nullable=True)

    user  = relationship("User",  foreign_keys=[user_id])
    event = relationship("Event", foreign_keys=[event_id])


class EventRemoval(Base):
    """Permanent audit trail — one row per removal, survives re-registration."""
    __tablename__ = "event_removals"

    id             = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id       = Column(Integer, ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    user_id        = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    callsign       = Column(String(100), nullable=False)
    removed_by     = Column(String(100), nullable=False)
    removal_reason = Column(String(500), nullable=False)
    bc_wiped       = Column(Integer, nullable=False, default=0)
    removed_at     = Column(DateTime, default=datetime.utcnow, nullable=False)
