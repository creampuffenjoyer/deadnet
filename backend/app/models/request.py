import enum
import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, Enum, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class RequestType(str, enum.Enum):
    ROLE_CHANGE    = "ROLE_CHANGE"
    ACCOUNT_ISSUE  = "ACCOUNT_ISSUE"
    OTHER          = "OTHER"


class RequestStatus(str, enum.Enum):
    PENDING    = "PENDING"
    APPROVED   = "APPROVED"
    DENIED     = "DENIED"
    CANCELLED  = "CANCELLED"


class OperatorRequest(Base):
    __tablename__ = "operator_requests"

    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sender_id       = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    sender_callsign = Column(String(50),  nullable=False)
    sender_role     = Column(String(20),  nullable=False)
    request_type    = Column(Enum(RequestType),   nullable=False)
    requested_role  = Column(String(20),  nullable=True)   # ROLE_CHANGE only
    reason          = Column(String(300), nullable=False)
    status          = Column(Enum(RequestStatus), nullable=False, default=RequestStatus.PENDING, server_default="PENDING")
    admin_response  = Column(String(300), nullable=True)
    resolved_by     = Column(String(50),  nullable=True)
    resolved_at     = Column(DateTime,    nullable=True)
    created_at      = Column(DateTime,    default=datetime.utcnow, nullable=False, index=True)
    event_id        = Column(Integer, ForeignKey("events.id", ondelete="SET NULL"), nullable=True)
    org_id   = Column(Integer, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True)
