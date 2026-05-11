import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSON, UUID

from app.database import Base


class ArchitectLog(Base):
    """Audit trail for all Architect mutations. Never shown to Admin."""

    __tablename__ = "architect_log"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    action = Column(String(200), nullable=False)
    target = Column(String(500), nullable=True)
    extra = Column(JSON, nullable=True)
    org_id = Column(Integer, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)
