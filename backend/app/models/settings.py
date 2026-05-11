from sqlalchemy import Column, String

from app.database import Base


class PlatformSettings(Base):
    """Key-value store for platform configuration."""

    __tablename__ = "platform_settings"

    key = Column(String(100), primary_key=True)
    value = Column(String(1000), nullable=False, default="")
