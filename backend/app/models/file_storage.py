from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, LargeBinary, String

from app.database import Base


class FileStorage(Base):
    __tablename__ = "file_storage"

    filename = Column(String(255), primary_key=True)
    content = Column(LargeBinary, nullable=False)
    original_name = Column(String(255))
    content_type = Column(String(100))
    file_size = Column(Integer, nullable=False)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
