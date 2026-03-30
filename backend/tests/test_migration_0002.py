from __future__ import annotations

import importlib


migration = importlib.import_module("backend.migrations.versions.0002_album_share_invites_and_notification_data")


class _Inspector:
    def __init__(
        self,
        *,
        tables: set[str] | None = None,
        columns: dict[str, list[str]] | None = None,
        indexes: dict[str, list[str]] | None = None,
    ) -> None:
        self.tables = tables or set()
        self.columns = columns or {}
        self.indexes = indexes or {}

    def has_table(self, table_name: str) -> bool:
        return table_name in self.tables

    def get_columns(self, table_name: str) -> list[dict[str, str]]:
        return [{"name": column_name} for column_name in self.columns.get(table_name, [])]

    def get_indexes(self, table_name: str) -> list[dict[str, str]]:
        return [{"name": index_name} for index_name in self.indexes.get(table_name, [])]


class _OpRecorder:
    def __init__(self) -> None:
        self.bind = object()
        self.calls: list[tuple[str, object]] = []

    def get_bind(self):
        return self.bind

    def add_column(self, table_name, column) -> None:
        self.calls.append(("add_column", table_name, column.name))

    def alter_column(self, table_name, column_name, **kwargs) -> None:
        self.calls.append(("alter_column", table_name, column_name, kwargs.get("type_")))

    def create_table(self, table_name, *columns, **_kwargs) -> None:
        self.calls.append(("create_table", table_name, [column.name for column in columns if hasattr(column, "name")]))

    def create_index(self, index_name, table_name, columns) -> None:
        self.calls.append(("create_index", index_name, table_name, tuple(columns)))


def test_upgrade_skips_objects_that_already_exist(monkeypatch):
    recorder = _OpRecorder()
    inspector = _Inspector(
        tables={"album_share_invites", "notifications"},
        columns={"notifications": ["id", "data"]},
        indexes={
            "album_share_invites": [
                "ix_album_share_invites_album_id",
                "ix_album_share_invites_user_id",
            ]
        },
    )
    enum_calls: list[str] = []

    monkeypatch.setattr(migration, "op", recorder)
    monkeypatch.setattr(migration.sa, "inspect", lambda bind: inspector)
    monkeypatch.setattr(migration.album_share_invite_status_enum, "create", lambda bind, checkfirst=True: enum_calls.append("status"))

    migration.upgrade()

    assert enum_calls == ["status"]
    assert len(recorder.calls) == 1
    assert recorder.calls[0][0:3] == ("alter_column", "alembic_version", "version_num")
    assert isinstance(recorder.calls[0][3], migration.sa.String)
    assert recorder.calls[0][3].length == 255


def test_upgrade_creates_missing_objects(monkeypatch):
    recorder = _OpRecorder()
    inspector = _Inspector(tables={"notifications"}, columns={"notifications": ["id"]})
    enum_calls: list[str] = []

    monkeypatch.setattr(migration, "op", recorder)
    monkeypatch.setattr(migration.sa, "inspect", lambda bind: inspector)
    monkeypatch.setattr(migration.album_share_invite_status_enum, "create", lambda bind, checkfirst=True: enum_calls.append("status"))

    migration.upgrade()

    assert enum_calls == ["status"]
    alter_calls = [call for call in recorder.calls if call[0] == "alter_column"]
    assert len(alter_calls) == 1
    assert alter_calls[0][1:3] == ("alembic_version", "version_num")
    assert isinstance(alter_calls[0][3], migration.sa.String)
    assert alter_calls[0][3].length == 255
    assert ("add_column", "notifications", "data") in recorder.calls
    assert ("create_index", "ix_album_share_invites_album_id", "album_share_invites", ("album_id",)) in recorder.calls
    assert ("create_index", "ix_album_share_invites_user_id", "album_share_invites", ("user_id",)) in recorder.calls
    create_table_calls = [call for call in recorder.calls if call[0] == "create_table"]
    assert len(create_table_calls) == 1
    assert create_table_calls[0][1] == "album_share_invites"
