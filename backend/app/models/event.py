import enum
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base


class EventStatus(str, enum.Enum):
    UPCOMING = "UPCOMING"
    ACTIVE   = "ACTIVE"
    CLOSED   = "CLOSED"


class EventType(str, enum.Enum):
    LOCAL = "LOCAL"
    MAJOR = "MAJOR"


class ResetLevel(str, enum.Enum):
    SOFT   = "SOFT"
    MEDIUM = "MEDIUM"
    HARD   = "HARD"


class Event(Base):
    __tablename__ = "events"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    name             = Column(String(100), nullable=False)
    status           = Column(String(20), nullable=False, default=EventStatus.UPCOMING.value, server_default="UPCOMING")
    registration_open = Column(Boolean, nullable=False, default=False, server_default="false")
    start_time       = Column(DateTime, nullable=True)
    end_time         = Column(DateTime, nullable=True)
    created_by       = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at       = Column(DateTime, default=datetime.utcnow, nullable=False)
    closed_at        = Column(DateTime, nullable=True)
    archived_at      = Column(DateTime, nullable=True)
    reset_level      = Column(String(10), nullable=True)   # SOFT / MEDIUM / HARD
    export_generated           = Column(Boolean, nullable=False, default=False, server_default="false")
    participant_count          = Column(Integer, nullable=False, default=0, server_default="0")
    description                = Column(String(300), nullable=True)
    registration_key           = Column(String(20), nullable=True, unique=True)
    key_regenerated_at         = Column(DateTime, nullable=True)
    email_domain_restriction   = Column(String(200), nullable=True)
    org_id = Column(Integer, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True)

    # Session 18 — Major Event fields
    event_type                 = Column(String(10), nullable=False, default="LOCAL", server_default="LOCAL")
    is_host                    = Column(Boolean, nullable=False, default=False, server_default="false")
    host_org_id                = Column(Integer, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True)
    major_event_invite_code    = Column(String(20), nullable=True, unique=True)
    invite_code_regenerated_at = Column(DateTime, nullable=True)

    # Allowed contract categories (NULL = all categories allowed)
    allowed_categories = Column(JSONB, nullable=True)

    # Pass 2 — per-event decay overrides (NULL = use platform default)
    decay_mode_override            = Column(String(20),      nullable=True)
    decay_tier_1_hours_override    = Column(Numeric(5, 2),   nullable=True)
    decay_tier_1_percent_override  = Column(Integer,         nullable=True)
    decay_tier_2_hours_override    = Column(Numeric(5, 2),   nullable=True)
    decay_tier_2_percent_override  = Column(Integer,         nullable=True)
    decay_tier_3_hours_override    = Column(Numeric(5, 2),   nullable=True)
    decay_tier_3_percent_override  = Column(Integer,         nullable=True)
    decay_floor_percent_override   = Column(Integer,         nullable=True)

    creator = relationship("User", foreign_keys=[created_by])
