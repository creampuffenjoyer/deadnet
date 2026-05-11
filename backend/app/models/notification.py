import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class Notification(Base):
    __tablename__ = "notifications"

    id             = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id        = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    message        = Column(String(500), nullable=False)
    from_callsign  = Column(String(50), nullable=True)
    kind           = Column(String(20), nullable=True)   # None=system, 'TX'=transmission
    read           = Column(Boolean, default=False, server_default="false", nullable=False)
    created_at     = Column(DateTime, default=datetime.utcnow, nullable=False)
