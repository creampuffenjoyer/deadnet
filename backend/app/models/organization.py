from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Integer, String

from app.database import Base


class Organization(Base):
    __tablename__ = "organizations"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    name        = Column(String(200), nullable=False, unique=True)
    org_code  = Column(String(200), nullable=True)
    description = Column(String(500), nullable=True)
    is_active   = Column(Boolean, default=True, server_default="true", nullable=False)
    logo_url    = Column(String(500), nullable=True)
    created_by  = Column(String(100), nullable=False)   # Architect callsign — no FK
    created_at  = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at  = Column(DateTime, nullable=True)
