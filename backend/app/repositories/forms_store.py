import re
import threading
import uuid
from pathlib import Path

from app.config import get_settings
from app.schemas.models import AccessGroup, AccessGroupPayload, AccessRules, FormItem, FormsStore, FormTab, Soldier
from app.utils.file_store import read_text_locked, write_text_atomic


_store_lock = threading.RLock()


def _store_path() -> Path:
    return Path(get_settings().forms_store_path)


def _default_store() -> FormsStore:
    return FormsStore(
        access_rules=AccessRules(
            groups=[
                AccessGroup(id="instructor", title="Инструкторы", ranks=[], specializations=[]),
                AccessGroup(id="officer", title="Офицерский состав", ranks=[], specializations=[]),
            ]
        ),
        tabs=[
            FormTab(id="reports", title="Рапорты", audience="public", forms=[]),
            FormTab(id="instructors", title="Инструкторские формы", audience="instructor", forms=[]),
            FormTab(id="officers", title="Офицерские формы", audience="officer", forms=[]),
            FormTab(id="admin", title="Админские формы", audience="admin", forms=[]),
            FormTab(id="archive", title="Архив", audience="admin", forms=[]),
        ]
    )


def load_store() -> FormsStore:
    path = _store_path()
    if not path.exists():
        return _default_store()
    store = FormsStore.model_validate_json(read_text_locked(path))
    return _migrate_store(store)


def save_store(store: FormsStore) -> FormsStore:
    path = _store_path()
    write_text_atomic(path, store.model_dump_json(indent=2))
    return store


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9а-яА-Я_-]+", "-", value.strip().casefold()).strip("-")
    return slug or uuid.uuid4().hex[:10]


def _unique_group_id(base: str, groups: list[AccessGroup]) -> str:
    existing = {group.id for group in groups}
    if base not in existing:
        return base
    index = 2
    while f"{base}-{index}" in existing:
        index += 1
    return f"{base}-{index}"


def _migrate_store(store: FormsStore) -> FormsStore:
    groups = list(store.access_rules.groups)
    existing = {group.id for group in groups}
    if "instructor" not in existing:
        groups.append(
            AccessGroup(
                id="instructor",
                title="Инструкторы",
                ranks=store.access_rules.instructors.ranks,
                specializations=store.access_rules.instructors.specializations,
                positions=store.access_rules.instructors.positions,
            )
        )
    if "officer" not in existing:
        groups.append(
            AccessGroup(
                id="officer",
                title="Офицерский состав",
                ranks=store.access_rules.officers.ranks,
                specializations=store.access_rules.officers.specializations,
                positions=store.access_rules.officers.positions,
            )
        )
    store.access_rules.groups = groups
    if not any(tab.id == "archive" for tab in store.tabs):
        store.tabs.append(FormTab(id="archive", title="Архив", audience="admin", forms=[]))
    return store


def _clean_rule_item(value: str) -> str:
    return value.strip().casefold()


def _split_specializations(value: str) -> set[str]:
    return {
        item.strip().casefold()
        for item in value.replace("/", ",").replace(";", ",").split(",")
        if item.strip()
    }


def _position_text(soldier: Soldier) -> str:
    return " ".join(
        item.strip()
        for item in (soldier.position, str(soldier.raw.get("Должность", "")))
        if item and item.strip()
    ).casefold()


def _matches_rule(soldier: Soldier, ranks: list[str], specializations: list[str], positions: list[str]) -> bool:
    rank = soldier.rank.strip().casefold()
    soldier_specializations = _split_specializations(str(soldier.raw.get("Специализация", "")))
    position = _position_text(soldier)
    allowed_ranks = {_clean_rule_item(item) for item in ranks if item.strip()}
    allowed_specializations = {_clean_rule_item(item) for item in specializations if item.strip()}
    allowed_positions = [_clean_rule_item(item) for item in positions if item.strip()]
    return bool(
        (rank and rank in allowed_ranks)
        or (soldier_specializations & allowed_specializations)
        or (position and any(fragment in position for fragment in allowed_positions))
    )


def resolve_access_groups(access_rules: AccessRules, soldier: Soldier, is_admin: bool) -> list[str]:
    return [
        group.id
        for group in access_rules.groups
        if is_admin or _matches_rule(soldier, group.ranks, group.specializations, group.positions)
    ]


def create_access_group_in_rules(access_rules: AccessRules, payload: AccessGroupPayload) -> AccessGroup:
    requested_id = payload.id.strip() if payload.id else _slugify(payload.title)
    group = AccessGroup(
        id=_unique_group_id(_slugify(requested_id), access_rules.groups),
        title=payload.title.strip(),
        ranks=payload.ranks,
        specializations=payload.specializations,
        positions=payload.positions,
    )
    access_rules.groups.append(group)
    return group


def update_access_group_in_rules(access_rules: AccessRules, group_id: str, payload: AccessGroupPayload) -> AccessGroup | None:
    for index, group in enumerate(access_rules.groups):
        if group.id == group_id:
            updated = group.model_copy(
                update={
                    "title": payload.title.strip(),
                    "ranks": payload.ranks,
                    "specializations": payload.specializations,
                    "positions": payload.positions,
                }
            )
            access_rules.groups[index] = updated
            return updated
    return None


def delete_access_group_from_rules(access_rules: AccessRules, group_id: str) -> bool:
    next_groups = [group for group in access_rules.groups if group.id != group_id]
    if len(next_groups) == len(access_rules.groups):
        return False
    access_rules.groups = next_groups
    return True


def get_access_rules() -> AccessRules:
    return load_store().access_rules


def create_access_group(payload: AccessGroupPayload) -> AccessGroup:
    with _store_lock:
        store = load_store()
        group = create_access_group_in_rules(store.access_rules, payload)
        save_store(store)
        return group


def update_access_group(group_id: str, payload: AccessGroupPayload) -> AccessGroup | None:
    with _store_lock:
        store = load_store()
        updated = update_access_group_in_rules(store.access_rules, group_id, payload)
        if updated is not None:
            save_store(store)
        return updated


def delete_access_group(group_id: str) -> bool:
    with _store_lock:
        store = load_store()
        if not delete_access_group_from_rules(store.access_rules, group_id):
            return False
        for tab in store.tabs:
            if tab.audience == group_id:
                tab.audience = "public"
            for form in tab.forms:
                if form.audience == group_id:
                    form.audience = "public"
        save_store(store)
        return True


def resolve_access(soldier: Soldier, is_admin: bool) -> dict[str, bool]:
    rules = get_access_rules()
    matched_groups = resolve_access_groups(rules, soldier, is_admin)
    is_instructor = is_admin or "instructor" in matched_groups
    is_officer = is_admin or "officer" in matched_groups
    return {"is_instructor": is_instructor, "is_officer": is_officer, "groups": matched_groups}


def can_view_audience(audience: str, is_admin: bool, access_groups: list[str], is_officer: bool, is_instructor: bool) -> bool:
    if audience == "admin":
        return is_admin
    if audience == "officer":
        return is_admin or is_officer or "officer" in access_groups
    if audience == "instructor":
        return is_admin or is_instructor or "instructor" in access_groups
    if audience == "public":
        return True
    return is_admin or audience in access_groups


def list_tabs(is_admin: bool, access_groups: list[str] | None = None, is_officer: bool = False, is_instructor: bool = False) -> list[FormTab]:
    store = load_store()
    access_groups = access_groups or []
    tabs: list[FormTab] = []
    for tab in store.tabs:
        if not can_view_audience(tab.audience, is_admin, access_groups, is_officer, is_instructor):
            continue
        forms = [
            form
            for form in tab.forms
            if form.active and can_view_audience(form.audience, is_admin, access_groups, is_officer, is_instructor)
        ]
        tabs.append(tab.model_copy(update={"forms": forms}))
    return tabs


def create_tab(title: str, audience: str) -> FormTab:
    with _store_lock:
        store = load_store()
        tab = FormTab(id=uuid.uuid4().hex[:10], title=title, audience=audience, forms=[])
        store.tabs.append(tab)
        save_store(store)
        return tab


def delete_tab(tab_id: str) -> bool:
    with _store_lock:
        store = load_store()
        next_tabs = [tab for tab in store.tabs if tab.id != tab_id]
        if len(next_tabs) == len(store.tabs):
            return False
        store.tabs = next_tabs
        save_store(store)
        return True


def _move(items: list, item_id: str, direction: str) -> bool:
    index = next((index for index, item in enumerate(items) if item.id == item_id), -1)
    target = index - 1 if direction == "up" else index + 1
    if index < 0 or target < 0 or target >= len(items):
        return False
    items[index], items[target] = items[target], items[index]
    return True


def move_tab(tab_id: str, direction: str) -> bool:
    with _store_lock:
        store = load_store()
        if not _move(store.tabs, tab_id, direction):
            return False
        save_store(store)
        return True


def create_form(payload: dict) -> FormItem:
    with _store_lock:
        store = load_store()
        tab = next((item for item in store.tabs if item.id == payload["tab_id"]), None)
        if tab is None:
            tab = FormTab(id=payload["tab_id"], title=payload["tab_id"], audience=payload["audience"])
            store.tabs.append(tab)

        form = FormItem(id=uuid.uuid4().hex[:10], **payload)
        tab.forms.append(form)
        save_store(store)
        return form


def update_form(form_id: str, payload: dict) -> FormItem | None:
    with _store_lock:
        store = load_store()
        target_tab = next((tab for tab in store.tabs if tab.id == payload["tab_id"]), None)
        if target_tab is None:
            return None
        if not any(form.id == form_id for tab in store.tabs for form in tab.forms):
            return None
        for tab in store.tabs:
            tab.forms = [form for form in tab.forms if form.id != form_id]
        updated = FormItem(id=form_id, **payload)
        target_tab.forms.append(updated)
        save_store(store)
        return updated


def move_form(form_id: str, direction: str) -> bool:
    with _store_lock:
        store = load_store()
        for tab in store.tabs:
            if _move(tab.forms, form_id, direction):
                save_store(store)
                return True
    return False


def delete_form(form_id: str) -> bool:
    with _store_lock:
        store = load_store()
        deleted = False
        for tab in store.tabs:
            next_forms = [form for form in tab.forms if form.id != form_id]
            if len(next_forms) != len(tab.forms):
                deleted = True
                tab.forms = next_forms
        if deleted:
            save_store(store)
        return deleted
