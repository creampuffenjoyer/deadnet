import enum
import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class RegRequestStatus(str, enum.Enum):
    PENDING  = "PENDING"
    APPROVED = "APPROVED"
    DENIED   = "DENIED"


class RegistrationRequest(Base):
    """Permanent audit trail for CONTRACTOR/HANDLER registration requests.
    Survives account deletion — no FK to users table."""
    __tablename__ = "registration_requests"

    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    callsign        = Column(String(50),  nullable=False, index=True)
    email           = Column(String(255), nullable=False)
    role_requested  = Column(String(20),  nullable=False)     # "CONTRACTOR" or "HANDLER"
    reason          = Column(String(500), nullable=False)
    status          = Column(String(20),  nullable=False, default=RegRequestStatus.PENDING.value, server_default="PENDING")
    admin_callsign  = Column(String(50),  nullable=True)      # who resolved it
    admin_reason    = Column(String(300), nullable=True)      # admin's response message
    requested_at    = Column(DateTime,    default=datetime.utcnow, nullable=False)
    resolved_at     = Column(DateTime,    nullable=True)
    org_id   = Column(Integer, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True)
