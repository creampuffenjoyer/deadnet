import enum
import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, Enum, Integer, String, ForeignKey
from sqlalchemy.dialects.postgresql import JSON, UUID
from sqlalchemy.orm import relationship

from app.database import Base


class SeasonStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    ACTIVE = "ACTIVE"
    ARCHIVED = "ARCHIVED"


class Season(Base):
    __tablename__ = "seasons"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    status = Column(Enum(SeasonStatus), nullable=False, default=SeasonStatus.ACTIVE)
    reset_level_used = Column(Integer, nullable=True)  # 1, 2, or 3 — set when archived
    settings_snapshot = Column(JSON, nullable=True)    # snapshot of platform_settings at archive time
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    started_at = Column(DateTime, nullable=True)
    ended_at = Column(DateTime, nullable=True)
    created_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    creator = relationship("User", foreign_keys=[created_by])
