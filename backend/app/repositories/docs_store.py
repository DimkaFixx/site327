import threading
import uuid
from pathlib import Path

from app.config import get_settings
from app.repositories.forms_store import can_view_audience, create_access_group_in_rules, delete_access_group_from_rules, resolve_access_groups, update_access_group_in_rules
from app.schemas.models import AccessGroup, AccessGroupPayload, AccessRules, DocItem, DocPayload, DocsSection, DocsSectionPayload, DocsStore, Soldier
from app.utils.file_store import read_text_locked, write_text_atomic


_store_lock = threading.RLock()


def _store_path() -> Path:
    return Path(get_settings().docs_store_path)


def _default_store() -> DocsStore:
    return DocsStore(
        access_rules=AccessRules(
            groups=[
                AccessGroup(id="instructor", title="Инструкторы", ranks=[], specializations=[]),
                AccessGroup(id="officer", title="Офицерский состав", ranks=[], specializations=[]),
            ]
        ),
        sections=[
            DocsSection(id="training", title="Обучение", audience="public", docs=[]),
            DocsSection(id="instructors", title="Инструкторская документация", audience="instructor", docs=[]),
            DocsSection(id="officers", title="Офицерская документация", audience="officer", docs=[]),
        ]
    )


def load_docs_store() -> DocsStore:
    path = _store_path()
    if not path.exists():
        return _default_store()
    store = DocsStore.model_validate_json(read_text_locked(path))
    return _migrate_doc_access_groups(store)


def save_docs_store(store: DocsStore) -> DocsStore:
    path = _store_path()
    write_text_atomic(path, store.model_dump_json(indent=2))
    return store


def _migrate_doc_access_groups(store: DocsStore) -> DocsStore:
    groups = list(store.access_rules.groups)
    existing = {group.id for group in groups}
    if "instructor" not in existing:
        groups.append(
            AccessGroup(
                id="instructor",
                title="Инструкторы",
                ranks=store.access_rules.instructors.ranks,
                specializations=store.access_rules.instructors.specializations,
            )
        )
    if "officer" not in existing:
        groups.append(
            AccessGroup(
                id="officer",
                title="Офицерский состав",
                ranks=store.access_rules.officers.ranks,
                specializations=store.access_rules.officers.specializations,
            )
        )
    store.access_rules.groups = groups
    return store


def get_doc_access_rules() -> AccessRules:
    return load_docs_store().access_rules


def create_doc_access_group(payload: AccessGroupPayload) -> AccessGroup:
    with _store_lock:
        store = load_docs_store()
        group = create_access_group_in_rules(store.access_rules, payload)
        save_docs_store(store)
        return group


def update_doc_access_group(group_id: str, payload: AccessGroupPayload) -> AccessGroup | None:
    with _store_lock:
        store = load_docs_store()
        updated = update_access_group_in_rules(store.access_rules, group_id, payload)
        if updated is not None:
            save_docs_store(store)
        return updated


def delete_doc_access_group(group_id: str) -> bool:
    with _store_lock:
        store = load_docs_store()
        deleted = delete_access_group_from_rules(store.access_rules, group_id)
        if not deleted:
            return False
        for section in store.sections:
            if section.audience == group_id:
                section.audience = "public"
            for doc in section.docs:
                if doc.audience == group_id:
                    doc.audience = "public"
        save_docs_store(store)
        return True


def resolve_doc_access(soldier: Soldier, is_admin: bool) -> dict[str, bool | list[str]]:
    groups = resolve_access_groups(load_docs_store().access_rules, soldier, is_admin)
    return {
        "is_instructor": is_admin or "instructor" in groups,
        "is_officer": is_admin or "officer" in groups,
        "groups": groups,
    }


def list_docs_sections(
    is_admin: bool,
    access_groups: list[str] | None = None,
    is_officer: bool = False,
    is_instructor: bool = False,
) -> list[DocsSection]:
    store = load_docs_store()
    access_groups = access_groups or []
    sections: list[DocsSection] = []
    for section in store.sections:
        if not can_view_audience(section.audience, is_admin, access_groups, is_officer, is_instructor):
            continue
        docs = [
            doc
            for doc in section.docs
            if doc.active and can_view_audience(doc.audience, is_admin, access_groups, is_officer, is_instructor)
        ]
        sections.append(section.model_copy(update={"docs": docs}))
    return sections


def get_doc_for_view(
    doc_id: str,
    is_admin: bool,
    access_groups: list[str] | None = None,
    is_officer: bool = False,
    is_instructor: bool = False,
) -> DocItem | None:
    access_groups = access_groups or []
    for section in load_docs_store().sections:
        if not can_view_audience(section.audience, is_admin, access_groups, is_officer, is_instructor):
            continue
        for doc in section.docs:
            if doc.id == doc_id and doc.active and can_view_audience(doc.audience, is_admin, access_groups, is_officer, is_instructor):
                return doc
    return None


def create_docs_section(payload: DocsSectionPayload) -> DocsSection:
    with _store_lock:
        store = load_docs_store()
        section = DocsSection(id=uuid.uuid4().hex[:10], title=payload.title, audience=payload.audience, docs=[])
        store.sections.append(section)
        save_docs_store(store)
        return section


def delete_docs_section(section_id: str) -> bool:
    with _store_lock:
        store = load_docs_store()
        next_sections = [section for section in store.sections if section.id != section_id]
        if len(next_sections) == len(store.sections):
            return False
        store.sections = next_sections
        save_docs_store(store)
        return True


def create_doc(payload: DocPayload) -> DocItem:
    with _store_lock:
        store = load_docs_store()
        section = next((item for item in store.sections if item.id == payload.section_id), None)
        if section is None:
            section = DocsSection(id=payload.section_id, title=payload.section_id, audience=payload.audience, docs=[])
            store.sections.append(section)

        doc = DocItem(id=uuid.uuid4().hex[:10], **payload.model_dump())
        section.docs.append(doc)
        save_docs_store(store)
        return doc


def update_doc(doc_id: str, payload: DocPayload) -> DocItem | None:
    with _store_lock:
        store = load_docs_store()
        found_doc: DocItem | None = None
        for section in store.sections:
            next_docs: list[DocItem] = []
            for doc in section.docs:
                if doc.id == doc_id:
                    found_doc = DocItem(id=doc_id, **payload.model_dump())
                    continue
                next_docs.append(doc)
            section.docs = next_docs

        target_section = next((item for item in store.sections if item.id == payload.section_id), None)
        if target_section is None:
            target_section = DocsSection(id=payload.section_id, title=payload.section_id, audience=payload.audience, docs=[])
            store.sections.append(target_section)

        if found_doc is None:
            return None
        target_section.docs.append(found_doc)
        save_docs_store(store)
        return found_doc


def delete_doc(doc_id: str) -> bool:
    with _store_lock:
        store = load_docs_store()
        deleted = False
        for section in store.sections:
            next_docs = [doc for doc in section.docs if doc.id != doc_id]
            if len(next_docs) != len(section.docs):
                deleted = True
                section.docs = next_docs
        if deleted:
            save_docs_store(store)
        return deleted
