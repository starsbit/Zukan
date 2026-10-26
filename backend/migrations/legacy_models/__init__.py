"""Frozen schema used only by historical migrations."""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
