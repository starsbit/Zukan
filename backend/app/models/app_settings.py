from sqlalchemy import Enum, Integer
from sqlalchemy.orm import Mapped, mapped_column
from backend.app.database import Base
from backend.app.utils.tagging import TaggerBackendName


class AppSettings(Base):
    __tablename__ = "app_settings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    tagger_backend: Mapped[TaggerBackendName | None] = mapped_column(
        Enum(TaggerBackendName, name="tagger_backend_enum"), nullable=True
    )
