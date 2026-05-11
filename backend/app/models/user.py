import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    CONTRACTOR = "CONTRACTOR"
    HANDLER = "HANDLER"
    OPERATIVE = "OPERATIVE"


class AccountStatus(str, enum.Enum):
    PENDING_VERIFICATION  = "PENDING_VERIFICATION"
    PENDING_APPROVAL      = "PENDING_APPROVAL"
    PENDING_PASSWORD_SET  = "PENDING_PASSWORD_SET"   # Architect-invited admins awaiting activation
    ACTIVE                = "ACTIVE"
    DENIED                = "DENIED"


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    username = Column(String(50), unique=True, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    role = Column(Enum(UserRole), nullable=False, default=UserRole.OPERATIVE)
    is_banned = Column(Boolean, default=False, nullable=False)
    # Running BC total — updated atomically alongside bc_events
    bc_total = Column(Integer, default=0, server_default="0", nullable=False)
    # Profile fields
    school  = Column(String(100), nullable=True)
    section = Column(String(100), nullable=True)
    full_name = Column(String(100), nullable=True)
    student_id = Column(String(50), nullable=True)
    year_level = Column(String(20), nullable=True)
    onboarding_complete = Column(Boolean, default=False, server_default="false", nullable=False)
    # VO1D secret layer
    void_bc = Column(Integer, default=0, server_default="0", nullable=False)
    void_access = Column(Boolean, default=False, server_default="false", nullable=False)
    # Account status (registration approval flow)
    account_status      = Column(String(30), nullable=False, default=AccountStatus.ACTIVE.value, server_default="ACTIVE")
    registration_reason = Column(String(500), nullable=True)   # CONTRACTOR/HANDLER only
    denied_reason       = Column(String(500), nullable=True)   # populated by admin on denial
    # Email verification
    is_verified = Column(Boolean, default=False, server_default="false", nullable=False)
    verification_token         = Column(String(64),  nullable=True)   # SHA-256 hex of raw token
    verification_token_expires = Column(DateTime,    nullable=True)
    # Password reset
    password_reset_token        = Column(String(64),  nullable=True)  # SHA-256 hex of raw token
    password_reset_expires      = Column(DateTime,    nullable=True)
    password_reset_requested_at = Column(DateTime,    nullable=True)
    # Audit fields tracked at login
    last_login = Column(DateTime, nullable=True)
    last_ip    = Column(String(50), nullable=True)
    # Organization affiliation — NULL only for Architect (no DB row for Architect)
    org_id = Column(Integer, ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )
