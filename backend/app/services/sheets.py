import asyncio
import re
from datetime import datetime, timedelta
from typing import Any

from fastapi import HTTPException, status
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from sqlalchemy import delete, func, insert, select

from app.config import get_settings
from app.repositories.database import db_session, equipment_sheet_cache, soldiers_cache
from app.schemas.models import EquipmentItem, EquipmentResponse, Soldier


HEADER_ALIASES = {
    "nickname": ("ник", "никнейм", "nickname", "name", "позывной"),
    "rank": ("звание", "rank"),
    "number": ("номер", "жетон", "id", "number", "борт"),
    "combat_deployments": ("бв", "боевые выходы", "боевых выходов", "deployments", "участие в бв"),
    "service_time": ("выслуга", "срок службы", "service", "time"),
    "unit": ("отряд", "подразделение", "unit", "squad"),
    "position": ("должность", "роль", "position", "role"),
    "status": ("статус", "status"),
}

RAW_FIELD_LABELS = {
    "БСО / Jedi": "Приписка",
    "Спец-я": "Специализация",
    "Реки": "Рекомендации",
    "ЧасП": "Часовой пояс",
    "Последнее повыш.": "Последнее повышение",
    "Последнее повыш": "Последнее повышение",
    "Атт-н на": "Аттестован на",
    "В": "Выслуга",
    "Б": "Участие в БВ",
    "КБ": "Командование батальоном",
    "КО": "Командование отрядом",
    "Т": "Тренировок",
    "ПТ": "Проведение тренировок",
    "ПР": "Последний рапорт (дней назад)",
    "С1": "Последний онлайн на сервере 1",
    "С2": "Последний онлайн на сервере 2",
    "БС": "Баллы",
}

IGNORED_RAW_HEADERS = {"сводка информации", "сводка информации:"}
SHEETS_SCOPES = ("https://www.googleapis.com/auth/spreadsheets.readonly",)


def _clean_header(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().casefold())


def _clean_value(value: Any) -> str:
    text = str(value or "").strip()
    return text.strip("`").strip()


def _display_header(value: str) -> str:
    header = str(value or "").strip()
    return RAW_FIELD_LABELS.get(header, header)


def _pick(row: dict[str, Any], field: str) -> str:
    aliases = HEADER_ALIASES[field]
    normalized = {_clean_header(key): value for key, value in row.items()}
    for key, value in normalized.items():
        if key in aliases:
            return _clean_value(value)
    for key, value in normalized.items():
        if any(alias in key for alias in aliases):
            return _clean_value(value)
    return ""


def _fallback_nickname(row: dict[str, Any]) -> str:
    for value in row.values():
        text = _clean_value(value)
        if text:
            return text
    return ""


def _find_header_index(rows: list[list[str]]) -> int:
    nickname_aliases = HEADER_ALIASES["nickname"]
    for index, row in enumerate(rows):
        normalized = {_clean_header(cell) for cell in row}
        if any(alias in normalized for alias in nickname_aliases):
            return index
    return 0


def _rows_to_dicts(rows: list[list[Any]]) -> list[dict[str, Any]]:
    if not rows:
        return []
    header_index = _find_header_index([[str(cell) for cell in row] for row in rows])
    headers = [str(cell) for cell in rows[header_index]]
    result: list[dict[str, Any]] = []
    for row in rows[header_index + 1 :]:
        values = list(row) + [""] * max(0, len(headers) - len(row))
        result.append(dict(zip(headers, values, strict=False)))
    return result


def _quote_sheet_title(title: str) -> str:
    return "'" + title.replace("'", "''") + "'"


def _resolve_sheet_range(service: Any, sheet_gid: str | None = None) -> str:
    settings = get_settings()
    if settings.google_sheet_range.strip():
        return settings.google_sheet_range.strip()

    metadata = service.spreadsheets().get(spreadsheetId=settings.google_sheet_id, fields="sheets(properties(sheetId,title))").execute()
    target_gid = str(sheet_gid or settings.google_sheet_gid)
    sheets = metadata.get("sheets", [])
    for sheet in sheets:
        properties = sheet.get("properties", {})
        if str(properties.get("sheetId")) == target_gid:
            return _quote_sheet_title(str(properties["title"]))
    if sheets:
        title = str(sheets[0]["properties"]["title"])
        return _quote_sheet_title(title)
    raise HTTPException(status.HTTP_502_BAD_GATEWAY, "В Google-таблице не найдены листы для чтения")


def _row_to_soldier(index: int, row: dict[str, Any]) -> Soldier | None:
    compact_row = {}
    for key, value in row.items():
        if not key:
            continue
        original_key = str(key).strip()
        if _clean_header(original_key) in IGNORED_RAW_HEADERS:
            continue
        compact_row[_display_header(original_key)] = _clean_value(value)

    nickname = _pick(compact_row, "nickname") or _fallback_nickname(compact_row)
    if not nickname:
        return None

    return Soldier(
        id=str(index),
        nickname=nickname,
        rank=_pick(compact_row, "rank"),
        number=_pick(compact_row, "number"),
        combat_deployments=_pick(compact_row, "combat_deployments"),
        service_time=_pick(compact_row, "service_time"),
        unit="",
        position=_pick(compact_row, "position"),
        status=_pick(compact_row, "status"),
        raw=compact_row,
    )


def _fetch_sheet_rows_for_gid(sheet_gid: str, value_render_option: str | None = None) -> list[list[Any]]:
    settings = get_settings()
    credentials_path = settings.google_credentials_path
    if not credentials_path.exists():
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            f"Файл Google service account не найден: {credentials_path}",
        )

    try:
        credentials = Credentials.from_service_account_file(credentials_path, scopes=SHEETS_SCOPES)
        service = build("sheets", "v4", credentials=credentials, cache_discovery=False)
        sheet_range = _resolve_sheet_range(service, sheet_gid)
        request = service.spreadsheets().values().get(
            spreadsheetId=settings.google_sheet_id,
            range=sheet_range,
            **({"valueRenderOption": value_render_option} if value_render_option else {}),
        )
        result = request.execute()
    except (OSError, ValueError, HttpError) as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Не удалось прочитать Google-таблицу через service account. Проверь ключ, доступ к таблице и GOOGLE_SHEET_RANGE.",
        ) from exc
    return result.get("values", [])


def _fetch_sheet_rows() -> list[list[Any]]:
    return _fetch_sheet_rows_for_gid(get_settings().google_sheet_gid)


async def fetch_soldiers_from_sheet() -> list[Soldier]:
    rows = await asyncio.to_thread(_fetch_sheet_rows)
    soldiers: list[Soldier] = []

    for index, row in enumerate(_rows_to_dicts(rows), start=1):
        soldier = _row_to_soldier(index, row)
        if soldier:
            soldiers.append(soldier)

    return soldiers


def _cell(row: list[Any], index: int) -> str:
    return _clean_value(row[index]) if index < len(row) else ""


def _normalise_rule_key(value: str) -> str:
    return re.sub(r"\s+", "", value).upper().replace("С", "C")


def _rank_column(rank: str) -> tuple[int, str]:
    normalized = _normalise_rule_key(rank)
    if normalized in {"SPS", "SSG", "SGT"}:
        return 7, "SGT → SPS"
    if normalized in {"LT", "SLT", "SPL", "CPT", "MAJ", "COL", "GEN"}:
        return 10, "LT+"
    return 4, "CR → CPL"


def _rule_matches(value: str, candidates: set[str]) -> bool:
    parts = {_normalise_rule_key(part) for part in value.split(",") if part.strip()}
    return bool(parts & candidates)


def _find_equipment_group(rows: list[list[Any]], soldier: Soldier) -> tuple[str, list[list[Any]]]:
    medicine_start = next((index for index, row in enumerate(rows) if "МЕДИЦИНА РЕГ." in _cell(row, 2).upper()), len(rows))
    blocks: list[tuple[str, str, list[list[Any]]]] = []
    current_title = ""
    current_key = ""
    current_rows: list[list[Any]] = []

    for row in rows[2:medicine_start]:
        title = _cell(row, 0)
        key = _cell(row, 1)
        if title:
            if current_rows:
                blocks.append((current_title, current_key, current_rows))
            current_title = title
            current_key = key or title
            current_rows = [row]
        elif current_rows and any(_cell(row, index) for index in range(3, 12)):
            current_rows.append(row)
    if current_rows:
        blocks.append((current_title, current_key, current_rows))

    assignment = _normalise_rule_key(str(soldier.raw.get("Приписка", "")))
    specializations = {_normalise_rule_key(item) for item in re.split(r"[,;/]", str(soldier.raw.get("Специализация", ""))) if item.strip()}
    for title, key, block_rows in blocks:
        if assignment and assignment in {_normalise_rule_key(key), _normalise_rule_key(title)}:
            return title, block_rows
    for title, key, block_rows in blocks:
        if _rule_matches(key, specializations):
            return title, block_rows
    fallback = next((block for block in blocks if _normalise_rule_key(block[0]) == "TROOPER"), None)
    return (fallback[0], fallback[2]) if fallback else ("Общий регламент", [])


def _image_url(row: list[Any]) -> str:
    for value in row:
        match = re.search(r"https?://[^\s\"']+", str(value))
        if match:
            return match.group(0)
    return ""


def _medicine_for_soldier(rows: list[list[Any]], soldier: Soldier) -> tuple[str, list[EquipmentItem]]:
    start = next((index for index, row in enumerate(rows) if "МЕДИЦИНА РЕГ." in _cell(row, 2).upper()), -1)
    if start < 0:
        return "Медицина", []
    assignment = _normalise_rule_key(str(soldier.raw.get("Приписка", "")))
    specializations = {
        _normalise_rule_key(item)
        for item in re.split(r"[,;/]", str(soldier.raw.get("Специализация", "")))
        if item.strip()
    }
    if assignment.startswith("ARC") or assignment.startswith("ARF"):
        offset, title = 18, "Медицина ARC/ARF"
    elif "MI" in specializations:
        offset, title = 6, "Базовая медицина полевого медика-интерна"
    elif specializations & {"MS", "SM", "MM", "DMM", "HSM", "HMS"}:
        offset, title = 14, "Базовая медицина медика-специалиста и выше"
    elif specializations & {"M", "HM"}:
        offset, title = 10, "Базовая медицина полевого медика"
    else:
        offset, title = 2, "Медицина бойца"

    result: list[EquipmentItem] = []
    for row in rows[start + 2 :]:
        name = _cell(row, offset)
        amount = _cell(row, offset + 1)
        note = _cell(row, offset + 2)
        if not name:
            continue
        value = " · ".join(item for item in (amount, note) if item)
        result.append(EquipmentItem(category=name, value=value or "Согласно регламенту"))
    return title, result


async def get_equipment_for_soldier(soldier: Soldier) -> EquipmentResponse:
    rows = fetch_cached_equipment_rows()
    if not rows:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Регламент снаряжения ещё не загружен")
    title, group_rows = _find_equipment_group(rows, soldier)
    value_column, rank_group = _rank_column(soldier.rank)
    image_url = next((url for row in group_rows if (url := _image_url(row))), "")
    equipment: list[EquipmentItem] = []
    for row in group_rows:
        category = _cell(row, value_column - 1)
        value = _cell(row, value_column)
        if not value:
            for fallback in (4, 7, 10):
                category = category or _cell(row, fallback - 1)
                value = _cell(row, fallback)
                if value:
                    break
        if category and value:
            equipment.append(EquipmentItem(category=category, value=value))
    medicine_title, medicine = _medicine_for_soldier(rows, soldier)
    return EquipmentResponse(regulation=title, rank_group=rank_group, image_url=image_url, equipment=equipment, medicine_title=medicine_title, medicine=medicine)


def fetch_cached_equipment_rows() -> list[list[Any]]:
    with db_session() as db:
        row = db.execute(select(equipment_sheet_cache.c.rows).where(equipment_sheet_cache.c.id == 1)).scalar_one_or_none()
    return row if isinstance(row, list) else []


def has_cached_equipment() -> bool:
    with db_session() as db:
        return db.execute(select(equipment_sheet_cache.c.id).where(equipment_sheet_cache.c.id == 1)).scalar_one_or_none() is not None


async def sync_equipment_from_sheet() -> int:
    rows = await asyncio.to_thread(_fetch_sheet_rows_for_gid, get_settings().google_equipment_sheet_gid, "FORMULA")
    with db_session() as db:
        db.execute(delete(equipment_sheet_cache).where(equipment_sheet_cache.c.id == 1))
        db.execute(insert(equipment_sheet_cache).values(id=1, rows=rows, synced_at=datetime.utcnow()))
    return len(rows)


def _soldier_from_cache(row: dict[str, Any]) -> Soldier:
    return Soldier(
        id=row["sheet_row_id"],
        nickname=row["nickname"],
        rank=row["rank"],
        number=row["number"],
        combat_deployments=row["combat_deployments"],
        service_time=row["service_time"],
        unit=row["unit"],
        position=row["position"],
        status=row["status"],
        raw=row["raw"],
    )


def fetch_soldiers() -> list[Soldier]:
    with db_session() as db:
        rows = db.execute(select(soldiers_cache).order_by(soldiers_cache.c.id)).mappings().all()
        return [_soldier_from_cache(dict(row)) for row in rows]


def find_soldier(nickname: str) -> Soldier | None:
    requested = _clean_value(nickname).casefold()
    with db_session() as db:
        row = (
            db.execute(select(soldiers_cache).where(soldiers_cache.c.normalized_nickname == requested))
            .mappings()
            .first()
        )
        return _soldier_from_cache(dict(row)) if row else None


def has_cached_soldiers() -> bool:
    with db_session() as db:
        return bool(db.execute(select(func.count()).select_from(soldiers_cache)).scalar_one())


async def sync_soldiers_from_sheet() -> int:
    soldiers = await fetch_soldiers_from_sheet()
    unique_soldiers: list[Soldier] = []
    seen: set[str] = set()
    for soldier in soldiers:
        normalized = soldier.nickname.casefold()
        if normalized in seen:
            continue
        seen.add(normalized)
        unique_soldiers.append(soldier)

    synced_at = datetime.utcnow()
    with db_session() as db:
        db.execute(delete(soldiers_cache))
        if unique_soldiers:
            db.execute(
                insert(soldiers_cache),
                [
                    {
                        "sheet_row_id": soldier.id,
                        "nickname": soldier.nickname,
                        "normalized_nickname": soldier.nickname.casefold(),
                        "rank": soldier.rank,
                        "number": soldier.number,
                        "combat_deployments": soldier.combat_deployments,
                        "service_time": soldier.service_time,
                        "unit": soldier.unit,
                        "position": soldier.position,
                        "status": soldier.status,
                        "raw": soldier.raw,
                        "synced_at": synced_at,
                    }
                    for soldier in unique_soldiers
                ],
            )
    return len(unique_soldiers)


def seconds_until_next_sync(now: datetime | None = None) -> float:
    current = now or datetime.now()
    candidates: list[datetime] = []
    for hour_offset in range(2):
        base = current.replace(second=0, microsecond=0) + timedelta(hours=hour_offset)
        for minute in (1, 6):
            candidate = base.replace(minute=minute)
            if candidate > current:
                candidates.append(candidate)
    return (min(candidates) - current).total_seconds()
    return None
