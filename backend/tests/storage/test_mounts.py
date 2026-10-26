from pathlib import Path

from backend.app.storage.mounts import linux_mount_at


def test_linux_mount_namespace_recognizes_bind_mount_and_escaped_paths():
    mounts = r"""20 1 0:2 / / rw - overlay overlay rw
30 20 0:2 /media /library rw shared:12 - nfs4 nas:/media rw
31 20 0:3 / /mnt/My\040NAS rw - cifs //nas/media rw"""
    assert linux_mount_at(Path("/library"), mounts).filesystem_type == "nfs4"
    assert linux_mount_at(Path("/library"), mounts).mount_id == 30
    assert linux_mount_at(Path("/mnt/My NAS"), mounts).filesystem_type == "cifs"
    assert linux_mount_at(Path("/mnt/missing"), mounts) is None


def test_overmounted_entry_uses_visible_mount():
    mounts = """30 20 0:2 / /library rw - nfs4 nas:/media rw
31 30 0:3 / /library rw - tmpfs tmpfs rw"""
    assert linux_mount_at(Path("/library"), mounts).filesystem_type == "tmpfs"


def test_root_mount_can_reference_itself_as_parent():
    assert (
        linux_mount_at(Path("/"), "20 20 0:2 / / rw - nfs4 nas:/root rw").mount_id == 20
    )
