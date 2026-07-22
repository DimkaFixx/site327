import threading
from pathlib import Path

from app.config import get_settings
from app.schemas.models import HomePage
from app.utils.file_store import read_text_locked, write_text_atomic


_store_lock = threading.RLock()


def _store_path() -> Path:
    docs_path = Path(get_settings().docs_store_path)
    return docs_path.with_name("home-page.json")


def _default_home_page() -> HomePage:
    return HomePage(
        title="327 Star Corp",
        content=(
            "# 327 Star Corp\n\n"
            "Добро пожаловать в батальонный архив.\n\n"
            "Здесь можно хранить вводную информацию, новости, правила доступа и ссылки для личного состава."
        ),
    )


def load_home_page() -> HomePage:
    path = _store_path()
    if not path.exists():
        return _default_home_page()
    return HomePage.model_validate_json(read_text_locked(path))


def save_home_page(page: HomePage) -> HomePage:
    with _store_lock:
        write_text_atomic(_store_path(), page.model_dump_json(indent=2))
        return page


def home_page_references_upload(filename: str) -> bool:
    page = load_home_page()
    return f"/api/uploads/{filename}" in page.content
