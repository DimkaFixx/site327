import re
import threading
from pathlib import Path

from app.config import get_settings
from app.schemas.models import EquipmentResponse, ManualRegulation, RegulationsStore, Soldier
from app.utils.file_store import read_text_locked, write_text_atomic


_store_lock = threading.RLock()


def _store_path() -> Path:
    return Path(get_settings().docs_store_path).with_name("regulations.json")


def _rule(identifier: str, title: str, **filters: list[str]) -> ManualRegulation:
    return ManualRegulation(id=identifier, title=title, items=[], **filters)


def _default_store() -> RegulationsStore:
    return RegulationsStore(
        equipment=[_rule("general-equipment", "Общий комплект")],
        medicine_base=_rule("medicine-base", "Медицина бойца"),
        medicine_rules=[
            _rule("medicine-medics", "Медицина медиков", specializations=["MI", "M", "HM", "MS", "SM", "MM", "DMM", "HSM", "HMS"]),
            _rule("medicine-arc-arf", "Медицина ARC/ARF", assignments=["ARC", "ARF"]),
        ],
    )


def load_regulations_store() -> RegulationsStore:
    path = _store_path()
    if not path.exists():
        return _default_store()
    store = RegulationsStore.model_validate_json(read_text_locked(path))
    for rule in store.equipment:
        if rule.id == "trooper" and not any((rule.assignments, rule.specializations, rule.ranks, rule.positions)):
            rule.title = "Общий комплект"
    for rule in [*store.equipment, store.medicine_base, *store.medicine_rules]:
        if all(not item.value and not item.amount for item in rule.items):
            rule.items = []
    return store


def save_regulations_store(store: RegulationsStore) -> RegulationsStore:
    with _store_lock:
        write_text_atomic(_store_path(), store.model_dump_json(indent=2))
    return store


def _normalise(value: str) -> str:
    return re.sub(r"\s+", "", value or "").upper().replace("С", "C")


def _values(value: str) -> set[str]:
    return {_normalise(item) for item in re.split(r"[,;/]", value or "") if item.strip()}


def _matches_value(values: set[str], expected: list[str], *, prefix: bool = False) -> bool:
    if not expected:
        return True
    expected_values = {_normalise(item) for item in expected if item.strip()}
    if prefix:
        return any(value == item or value.startswith(f"{item}-") for value in values for item in expected_values)
    return bool(values & expected_values)


def _rule_matches(rule: ManualRegulation, soldier: Soldier, *, medicine: bool = False) -> tuple[bool, int]:
    assignment = _values(str(soldier.raw.get("Приписка") or soldier.raw.get("БСО / Jedi") or soldier.raw.get("БСО/Jedi") or ""))
    specialization = _values(str(soldier.raw.get("Специализация") or soldier.raw.get("Спец-я") or ""))
    rank = _values(soldier.rank)
    position = _values(",".join(item for item in (soldier.position, str(soldier.raw.get("Должность", ""))) if item))
    ranks = [] if medicine else rule.ranks
    positions = [] if medicine else rule.positions
    checks = (
        _matches_value(assignment, rule.assignments, prefix=True),
        _matches_value(specialization, rule.specializations),
        _matches_value(rank, ranks),
        _matches_value(position, positions),
    )
    specificity = (
        (8 if rule.assignments else 0)
        + (4 if rule.specializations else 0)
        + (2 if ranks else 0)
        + (1 if positions else 0)
    )
    return all(checks), specificity


def _pick_rule(rules: list[ManualRegulation], soldier: Soldier, fallback: ManualRegulation, *, medicine: bool = False) -> ManualRegulation:
    best_rule = fallback
    best_score = -1
    for rule in rules:
        matches, score = _rule_matches(rule, soldier, medicine=medicine)
        if matches and score >= best_score:
            best_rule = rule
            best_score = score
    return best_rule


def _has_award_form(soldier: Soldier) -> bool:
    value = next((value for key, value in soldier.raw.items() if _normalise(str(key)) == "НАГ"), "")
    return str(value).strip().casefold() in {"true", "1", "да", "yes"}


def get_equipment_for_soldier(soldier: Soldier) -> EquipmentResponse:
    store = load_regulations_store()
    standard_rules = [rule for rule in store.equipment if not rule.is_award]
    fallback = standard_rules[0] if standard_rules else _rule("general-equipment", "Общий комплект")
    equipment_rule = _pick_rule(standard_rules, soldier, fallback)
    award_rule = None
    if _has_award_form(soldier):
        award_rules = [rule for rule in store.equipment if rule.is_award]
        best_award_score = -1
        for rule in award_rules:
            matches, score = _rule_matches(rule, soldier)
            if matches and score >= best_award_score:
                award_rule = rule
                best_award_score = score

    equipment = [item for item in equipment_rule.items if item.category and item.value]
    if award_rule:
        equipment.extend(
            item.model_copy(update={"is_award": True})
            for item in award_rule.items
            if item.category and item.value
        )
    medicine_rule = _pick_rule(store.medicine_rules, soldier, store.medicine_base, medicine=True)
    return EquipmentResponse(
        regulation=equipment_rule.title,
        rank_group="Индивидуальный регламент",
        image_url=equipment_rule.image_url,
        equipment=equipment,
        medicine_title=medicine_rule.title,
        medicine=[item for item in medicine_rule.items if item.category and (item.value or item.amount)],
    )
