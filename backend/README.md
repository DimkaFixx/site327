# Backend

FastAPI API для портала 327 Star Corp.

## Структура

- `app/main.py` - сборка приложения: CORS, static uploads, подключение роутеров, startup sync.
- `app/routers/` - HTTP endpoints по зонам: auth, soldiers, forms, docs, admin.
- `app/services/` - бизнес-логика и внешние интеграции, например Google Sheets sync и сборка auth response.
- `app/repositories/` - работа с хранилищами: SQLite, JSON форм, JSON документации, пользователи.
- `app/schemas/` - Pydantic-схемы запросов и ответов.
- `app/utils/` - технические helpers, сейчас токены и auth guards.
- `app/config.py` - настройки из env.
- `data/` - локальные runtime-данные при запуске без Docker.

## Google Sheets

Backend читает таблицу через Google Sheets API от имени service account.

- `.creditials.json` - JSON-ключ service account рядом с `.env`; файл секретный и игнорируется git.
- `GOOGLE_SERVICE_ACCOUNT_FILE=.creditials.json` - путь к ключу.
- `GOOGLE_SHEET_ID` - ID таблицы из URL.
- `GOOGLE_SHEET_GID` - gid листа; используется, если `GOOGLE_SHEET_RANGE` пустой.
- `GOOGLE_SHEET_RANGE` - необязательный явный диапазон, например `'Личный состав'!A:Z`; если пустой, читается весь лист по `GOOGLE_SHEET_GID`.

Service account должен быть добавлен в таблицу как `Viewer`. После этого таблицу можно закрыть от общего доступа.

## Discord proxy

Код подтверждения отправляется через Discord API proxy. В `backend/.env` должны быть заданы:

- `DISCORD_BOT_TOKEN` — токен Discord-бота;
- `DISCORD_BOT_PROXY_AUTH_TOKEN` — токен доступа к proxy.

Для обоих запросов при отправке личного сообщения backend передаёт proxy-токен в заголовке `X-Relay`.

## Безопасность и прод-настройки

- `COOKIE_SECURE=true` ставь на сервере с HTTPS. Для локального HTTP оставляй `false`, иначе браузер не сохранит auth-cookie.
- `COOKIE_SAMESITE=lax` подходит для обычного сценария, где frontend и API живут на одном сайте. Не ставь `none` без HTTPS.
- `CORS_ORIGINS` должен содержать только реальные адреса frontend, например `https://example.com`.
- `TRUSTED_PROXY_IPS` заполняй только IP reverse proxy, которому можно доверять `X-Forwarded-For`. Если пусто, backend использует прямой IP клиента.
- `TOKEN_SECRET` должен быть длинной случайной строкой и не должен попадать в git.
