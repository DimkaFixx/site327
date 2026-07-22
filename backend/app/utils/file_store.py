import os
import threading
from pathlib import Path


_locks_guard = threading.Lock()
_locks: dict[str, threading.Lock] = {}


def _path_lock(path: Path) -> threading.Lock:
    key = str(path.resolve())
    with _locks_guard:
        if key not in _locks:
            _locks[key] = threading.Lock()
        return _locks[key]


def read_text_locked(path: Path) -> str:
    with _path_lock(path):
        return path.read_text(encoding="utf-8")


def write_text_atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(f".{path.name}.tmp")
    with _path_lock(path):
        tmp_path.write_text(content, encoding="utf-8")
        os.replace(tmp_path, path)
