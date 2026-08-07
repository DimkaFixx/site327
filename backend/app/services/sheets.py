import asyncio
import re
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import HTTPException, status
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from sqlalchemy import delete, func, insert, select

from app.config import get_settings
from app.repositories.database import competencies_sheet_cache, db_session, medals_sheet_cache, online_sheet_cache, soldiers_cache
from app.schemas.models import CompetenciesResponse, CompetencyItem, MedalItem, OnlineDay, OnlineStats, Soldier


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

    # Only the explicit nickname/callsign column identifies a soldier.  Using
    # the first non-empty cell as a fallback turns values from newly added
    # columns (for example FALSE in «Наг») into fake soldier profiles.
    nickname = _pick(compact_row, "nickname")
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


def _find_marker_index(row: list[Any], *markers: str) -> int | None:
    """Find a section marker in the sheet's first row.

    The competencies sheet has changed column positions over time, so section
    boundaries must come from the marker names rather than hard-coded indexes.
    """
    wanted = {_clean_header(marker) for marker in markers}
    for index, value in enumerate(row):
        if _clean_header(_cell(row, index)) in wanted:
            return index
    return None


def _find_label_index(row: list[Any], label: str, start: int = 0) -> int | None:
    wanted = _clean_header(label)
    for index in range(start, len(row)):
        if _clean_header(_cell(row, index)) == wanted:
            return index
    return None


def fetch_cached_competencies_rows() -> list[list[Any]]:
    with db_session() as db:
        row = db.execute(select(competencies_sheet_cache.c.rows).where(competencies_sheet_cache.c.id == 1)).scalar_one_or_none()
    return row if isinstance(row, list) else []


def has_cached_competencies() -> bool:
    with db_session() as db:
        return db.execute(select(competencies_sheet_cache.c.id).where(competencies_sheet_cache.c.id == 1)).scalar_one_or_none() is not None


async def sync_competencies_from_sheet() -> int:
    rows = await asyncio.to_thread(_fetch_sheet_rows_for_gid, get_settings().google_competencies_sheet_gid)
    with db_session() as db:
        db.execute(delete(competencies_sheet_cache).where(competencies_sheet_cache.c.id == 1))
        db.execute(insert(competencies_sheet_cache).values(id=1, rows=rows, synced_at=datetime.utcnow()))
    return len(rows)


def fetch_cached_online_rows() -> list[list[Any]]:
    with db_session() as db:
        row = db.execute(select(online_sheet_cache.c.rows).where(online_sheet_cache.c.id == 1)).scalar_one_or_none()
    return row if isinstance(row, list) else []


def has_cached_online() -> bool:
    with db_session() as db:
        return db.execute(select(online_sheet_cache.c.id).where(online_sheet_cache.c.id == 1)).scalar_one_or_none() is not None


async def sync_online_from_sheet() -> int:
    gid = get_settings().google_online_sheet_gid.strip()
    if not gid:
        return 0
    rows = await asyncio.to_thread(_fetch_sheet_rows_for_gid, gid)
    with db_session() as db:
        db.execute(delete(online_sheet_cache).where(online_sheet_cache.c.id == 1))
        db.execute(insert(online_sheet_cache).values(id=1, rows=rows, synced_at=datetime.utcnow()))
    return len(rows)


def fetch_cached_medals_rows() -> list[list[Any]]:
    with db_session() as db:
        row = db.execute(select(medals_sheet_cache.c.rows).where(medals_sheet_cache.c.id == 1)).scalar_one_or_none()
    return row if isinstance(row, list) else []


def has_cached_medals() -> bool:
    with db_session() as db:
        return db.execute(select(medals_sheet_cache.c.id).where(medals_sheet_cache.c.id == 1)).scalar_one_or_none() is not None


async def sync_medals_from_sheet() -> int:
    gid = get_settings().google_medals_sheet_gid.strip()
    if not gid:
        return 0
    rows = await asyncio.to_thread(_fetch_sheet_rows_for_gid, gid)
    with db_session() as db:
        db.execute(delete(medals_sheet_cache).where(medals_sheet_cache.c.id == 1))
        db.execute(insert(medals_sheet_cache).values(id=1, rows=rows, synced_at=datetime.utcnow()))
    return len(rows)


def _find_medals_header(rows: list[list[Any]]) -> tuple[int, int] | None:
    for row_index, row in enumerate(rows[:8]):
        for column_index, value in enumerate(row):
            if _clean_header(_clean_value(value)) == "баллы":
                return row_index, column_index
    return None


def _medal_completed(value: str) -> bool:
    return _clean_value(value).casefold() in {"1", "true", "да", "yes", "✓"}


def get_medals_for_soldier(soldier: Soldier) -> tuple[list[MedalItem], list[MedalItem]]:
    rows = fetch_cached_medals_rows()
    marker = _find_medals_header(rows)
    if marker is None:
        return [], []
    header_row, points_column = marker
    header = rows[header_row]
    nickname_column = _find_label_index(header, "Позывной")
    if nickname_column is None:
        return [], []
    total_columns = [index for index in range(points_column + 1, len(header)) if _cell(header, index) == "Σ"]
    if not total_columns:
        return [], []
    general_end = total_columns[0]
    pilot_end = total_columns[1] if len(total_columns) > 1 else len(header)
    player_row = next((row for row in rows[header_row + 1:] if _cell(row, nickname_column).casefold() == _clean_value(soldier.nickname).casefold()), None)
    if player_row is None:
        return [], []

    def medals_in_range(start: int, end: int) -> list[MedalItem]:
        return [
            MedalItem(title=title, completed=_medal_completed(_cell(player_row, index)))
            for index in range(start, end)
            if (title := _cell(header, index)) and title != "Σ"
        ]

    # The blank separator after the first Σ is ignored automatically because
    # it has no title. All named columns up to the next Σ are pilot medals.
    return medals_in_range(points_column + 1, general_end), medals_in_range(general_end + 1, pilot_end)


def _find_online_date_marker(rows: list[list[Any]]) -> tuple[int, int] | None:
    for row_index, row in enumerate(rows[:5]):
        for column_index, value in enumerate(row):
            if _clean_header(_clean_value(value)) == "дата":
                return row_index, column_index
    return None


def _online_nickname_column(rows: list[list[Any]], header_end: int, date_column: int) -> int | None:
    aliases = set(HEADER_ALIASES["nickname"])
    for row in rows[:header_end]:
        for index in range(date_column):
            if _clean_header(_cell(row, index)) in aliases:
                return index
    return None


def _online_soldier_row(rows: list[list[Any]], nickname: str, data_start: int, date_column: int, nickname_column: int | None) -> list[Any] | None:
    wanted = _clean_value(nickname).casefold()
    for row in rows[data_start:]:
        if nickname_column is not None and _cell(row, nickname_column).casefold() == wanted:
            return row
        if nickname_column is None and any(_cell(row, index).casefold() == wanted for index in range(date_column)):
            return row
    return None


def _online_minutes(value: str) -> int:
    text = _clean_value(value).replace(" ", "")
    match = re.fullmatch(r"(\d+):(\d{1,2})", text)
    if match:
        return int(match.group(1)) * 60 + int(match.group(2))
    try:
        numeric = float(text.replace(",", "."))
    except ValueError:
        return 0
    # Google can return a duration as a fraction of a day when an unformatted
    # value is requested. Values above one are already hours.
    return round(numeric * 24 * 60) if 0 < numeric < 1 else round(numeric * 60)


def _online_date_sort_key(value: str, fallback: int) -> tuple[int, int, int, int]:
    match = re.search(r"(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?", value)
    if not match:
        return (0, 0, 0, fallback)
    day, month = int(match.group(1)), int(match.group(2))
    year_text = match.group(3)
    year = int(year_text) + (2000 if year_text and len(year_text) == 2 else 0) if year_text else date.today().year
    try:
        parsed = date(year, month, day)
        if not year_text and parsed > date.today() + timedelta(days=1):
            parsed = date(year - 1, month, day)
        return (parsed.year, parsed.month, parsed.day, fallback)
    except ValueError:
        return (0, 0, 0, fallback)


WEEKLY_METRICS = {
    "БВ за неделю": ("бвзанеделю", "бвза7д", "бвза7дней"),
    "Т за неделю": ("тзанеделю", "тза7д", "тза7дней"),
    "INS за неделю": ("insзанеделю", "insза7д", "insза7дней"),
    "ПТ за неделю": ("птзанеделю", "птза7д", "птза7дней"),
    "КМД П за неделю": ("кмдпзанеделю", "кмдпза7д", "кмдпза7дней"),
    "КМД ОП за неделю": ("кмдопзанеделю", "кмдопза7д", "кмдопза7дней"),
    "КМД О за неделю": ("кмдозанеделю", "кмдоза7д", "кмдоза7дней"),
}


def _weekly_metric_columns(rows: list[list[Any]], header_end: int, date_column: int) -> dict[str, int]:
    columns: dict[str, int] = {}
    for column in range(date_column):
        heading = "".join(_clean_header(_cell(row, column)).replace(" ", "") for row in rows[:header_end])
        for title, aliases in WEEKLY_METRICS.items():
            if title not in columns and any(alias in heading for alias in aliases):
                columns[title] = column
    return columns


def get_online_for_soldier(soldier: Soldier, cached_rows: list[list[Any]] | None = None) -> OnlineStats:
    rows = cached_rows if cached_rows is not None else fetch_cached_online_rows()
    marker = _find_online_date_marker(rows)
    if marker is None:
        return OnlineStats()
    header_row, date_column = marker
    data_start = header_row + 2
    nickname_column = _online_nickname_column(rows, data_start, date_column)
    soldier_row = _online_soldier_row(rows, soldier.nickname, data_start, date_column, nickname_column)
    if soldier_row is None:
        return OnlineStats()

    columns = _weekly_metric_columns(rows, data_start, date_column)
    weekly = {title: _cell(soldier_row, columns[title]) if title in columns else "—" for title in WEEKLY_METRICS}
    days: list[OnlineDay] = []
    last_date = ""
    for offset in range(0, 60, 2):
        first_column = date_column + 1 + offset
        date_label = _cell(rows[header_row], first_column) or _cell(rows[header_row], first_column + 1) or last_date
        if not date_label:
            continue
        last_date = date_label
        server_1 = _online_minutes(_cell(soldier_row, first_column))
        server_2 = _online_minutes(_cell(soldier_row, first_column + 1))
        days.append(OnlineDay(
            date=date_label,
            server_1_hours=round(server_1 / 60, 2),
            server_2_hours=round(server_2 / 60, 2),
            total_hours=round((server_1 + server_2) / 60, 2),
        ))
    ordered_days = [item for _, item in sorted(enumerate(days), key=lambda pair: _online_date_sort_key(pair[1].date, pair[0]))]
    return OnlineStats(days=ordered_days[-30:], weekly=weekly)


def _competency_row(rows: list[list[Any]], nickname_column: int, nickname: str) -> list[Any] | None:
    normalized_nickname = _clean_value(nickname).casefold()
    return next((row for row in rows[3:] if _cell(row, nickname_column).casefold() == normalized_nickname), None)


async def get_competencies_for_soldier(soldier: Soldier) -> CompetenciesResponse:
    rows = fetch_cached_competencies_rows()
    if not rows:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Лист компетенций ещё не загружен")

    section_markers = rows[0] if rows else []
    headings = rows[1] if len(rows) > 1 else []
    labels = rows[2] if len(rows) > 2 else []

    competencies_start = _find_marker_index(section_markers, "Компетенции")
    tech_access_start = _find_marker_index(section_markers, "Доступ к технике")
    tech_sheet_start = _find_marker_index(section_markers, "Тех-лист расчета", "Тех-лист расчёта")
    if competencies_start is None:
        competencies_start = 0
    if tech_access_start is None:
        tech_access_start = len(labels)
    if tech_sheet_start is None:
        tech_sheet_start = len(labels)

    left_nickname = _find_label_index(headings, "Позывной", competencies_start)
    # In the current sheet the section marker and the right-hand «Позывной»
    # share the same column. Start from the marker itself so CD and УДТ-1 do
    # not get skipped together with that column.
    right_nickname = _find_label_index(headings, "Позывной", tech_access_start)
    attestation_row = _competency_row(rows, left_nickname or competencies_start, soldier.nickname)
    tech_row = _competency_row(rows, right_nickname or tech_access_start, soldier.nickname)

    attestations: list[CompetencyItem] = []
    if attestation_row:
        current_group = ""
        # First four columns in the competencies section are soldier metadata
        # (nickname, rank, assignment and specialization).
        # The marker column itself may contain a competency (currently УДТ-0),
        # so include it in this section. The actual equipment-access list is
        # the separate table to the right.
        for index in range(competencies_start + 4, tech_access_start + 1):
            current_group = _cell(headings, index) or current_group
            title = _cell(labels, index)
            if title:
                attestations.append(CompetencyItem(title=title, group=current_group, completed=_cell(attestation_row, index) == "1"))

    tech_access: list[CompetencyItem] = []
    if tech_row:
        current_group = ""
        # Locate the right-hand nickname column instead of assuming its offset.
        tech_items_start = (right_nickname + 3) if right_nickname is not None else tech_access_start + 5
        for index in range(tech_items_start, tech_sheet_start):
            current_group = _cell(headings, index) or current_group
            title = _cell(labels, index)
            if title:
                tech_access.append(CompetencyItem(title=title, group=current_group, completed=_cell(tech_row, index) == "1"))
    medals, pilot_medals = get_medals_for_soldier(soldier)
    return CompetenciesResponse(attestations=attestations, tech_access=tech_access, medals=medals, pilot_medals=pilot_medals)


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
        soldiers = [_soldier_from_cache(dict(row)) for row in rows]
    # Hide any invalid cache entries created by older imports immediately;
    # the next composition sync will remove them from the cache entirely.
    online_rows = fetch_cached_online_rows()
    return [
        soldier.model_copy(update={"online": get_online_for_soldier(soldier, online_rows)})
        for soldier in soldiers
        if _pick(soldier.raw, "nickname")
    ]


def find_soldier(nickname: str) -> Soldier | None:
    requested = _clean_value(nickname).casefold()
    with db_session() as db:
        row = (
            db.execute(select(soldiers_cache).where(soldiers_cache.c.normalized_nickname == requested))
            .mappings()
            .first()
        )
        if not row:
            return None
        soldier = _soldier_from_cache(dict(row))
        if not _pick(soldier.raw, "nickname"):
            return None
        return soldier.model_copy(update={"online": get_online_for_soldier(soldier)})


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
