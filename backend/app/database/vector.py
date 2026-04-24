from __future__ import annotations

from sqlalchemy.types import UserDefinedType


class VectorType(UserDefinedType):
    cache_ok = True

    def __init__(self, dimensions: int) -> None:
        self.dimensions = dimensions

    def get_col_spec(self, **_kw) -> str:
        return f"vector({self.dimensions})"

    def bind_processor(self, dialect):
        def process(value):
            if value is None:
                return None
            if dialect.name == "postgresql":
                return _vector_literal(value)
            return [float(item) for item in value]

        return process

    def result_processor(self, dialect, _coltype):
        def process(value):
            if value is None:
                return None
            if isinstance(value, list):
                return [float(item) for item in value]
            if dialect.name != "postgresql":
                return value

            raw = str(value).strip()
            if raw.startswith("[") and raw.endswith("]"):
                raw = raw[1:-1]
            if not raw:
                return []
            return [float(item.strip()) for item in raw.split(",") if item.strip()]

        return process


def _vector_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{float(value):.8f}" for value in values) + "]"
