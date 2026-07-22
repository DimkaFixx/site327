# 327 Star Corp Portal

Портал батальона для Arma 3: вход по никнейму из публичной Google-таблицы, просмотр профилей, вкладки с Google Forms и скрытая админка по адресу `/#/ghost-admin`.

## Структура

- `backend/` - FastAPI API, кэш состава из Google Sheets, учётки в SQLite, хранение форм в JSON.
- `frontend/` - React + Vite SPA с hash-router.

В production Docker собирает frontend в статические файлы и отдаёт их через Nginx. В финальный frontend-образ не попадают исходники, ESLint, Vite-конфигурация и документация. Backend-образ содержит только `app/`, зависимости и скрипт запуска.

## Быстрый запуск

Docker:

```bash
cp backend/.env.example backend/.env
docker compose up --build
```

Открой `http://localhost:5173`. Backend также доступен на `http://localhost:8000`.

Админка: `http://localhost:5173/#/ghost-admin`.

Backend:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Открой `http://localhost:5173`.

## Настройка

В `backend/.env`:

- `GOOGLE_SHEET_ID` - ID таблицы.
- `GOOGLE_SHEET_GID` - gid листа.
- `GOOGLE_SHEET_CSV_URL` - необязательная прямая CSV-ссылка из “Опубликовать в интернете”.
- `ADMIN_NICKNAME` - ник админа по умолчанию.
- `ADMIN_PASSWORD` - пароль админа по умолчанию.
- `TOKEN_SECRET` - секрет подписи токенов.
- `TOKEN_TTL_SECONDS` - срок жизни токена входа в секундах.
- `REFRESH_TOKEN_TTL_SECONDS` - срок жизни refresh-токена в секундах.
- `FORMS_STORE_PATH` - путь к JSON-хранилищу вкладок/форм.
- `DATABASE_URL` - база данных. По умолчанию SQLite: `sqlite:///data/app.db`.
- `CORS_ORIGINS` - адреса frontend, которым разрешено обращаться к API.
- `COOKIE_SECURE` - `true` для HTTPS-прода, `false` только для локального HTTP.
- `COOKIE_SAMESITE` - обычно `lax`.
- `TRUSTED_PROXY_IPS` - IP reverse proxy, от которого backend принимает `X-Forwarded-For`; локально можно оставить пустым.

Таблица читается через Google Sheets API от service account и кэшируется локально. Service account должен быть добавлен в таблицу с правами `Viewer`.

Пример минимального `backend/.env`:

```env
GOOGLE_SHEET_ID=1bfBjMkB9p8Wpnfi4NGWG6suege0tbUkylUtt6qKRkRA
GOOGLE_SHEET_GID=1363288683
GOOGLE_SHEET_CSV_URL=
ADMIN_NICKNAME=Fixx
ADMIN_PASSWORD=change-this-password
TOKEN_SECRET=change-this-token-secret
TOKEN_TTL_SECONDS=43200
REFRESH_TOKEN_TTL_SECONDS=2592000
FORMS_STORE_PATH=data/forms.json
DATABASE_URL=sqlite:///data/app.db
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
COOKIE_SECURE=false
COOKIE_SAMESITE=lax
TRUSTED_PROXY_IPS=
```

## Запуск на Windows

Самый простой вариант - через Docker Desktop.

1. Установи:
   - Docker Desktop: https://www.docker.com/products/docker-desktop/
   - Git for Windows: https://git-scm.com/download/win

2. Открой PowerShell в папке проекта.

3. Создай env-файл:

```powershell
copy backend\.env.example backend\.env
notepad backend\.env
```

4. Заполни в `backend\.env`:
   - `ADMIN_NICKNAME`
   - `ADMIN_PASSWORD`
   - `TOKEN_SECRET`
   - `GOOGLE_SHEET_ID`
   - `GOOGLE_SHEET_GID`

5. Запусти:

```powershell
docker compose up -d --build
```

6. Открой:

```text
http://localhost:5173
```

Админка:

```text
http://localhost:5173/#/ghost-admin
```

Остановка:

```powershell
docker compose down
```

Просмотр логов:

```powershell
docker compose logs -f
```

## Production: Linux + HTTPS + PostgreSQL

Для production используй отдельный файл [docker-compose.prod.yml](docker-compose.prod.yml): он запускает frontend, backend и Caddy. Backend подключается к уже существующему PostgreSQL через `DATABASE_URL`; снаружи открыты только порты `80` и `443` Caddy.

### 1. Подготовь сервер и DNS

Нужен Linux-сервер с публичным IPv4, домен и права root/sudo. Создай A-запись домена, например `portal.example.com`, на IP сервера. До запуска убедись, что порты `80/tcp` и `443/tcp` открыты в firewall/панели хостинга.

Установи Docker Engine и Docker Compose Plugin по [официальной инструкции Docker](https://docs.docker.com/engine/install/ubuntu/). Затем скопируй проект на сервер и перейди в его каталог:

```bash
git clone <repo-url> site327
cd site327
```

### 2. Создай production-настройки

```bash
cp deploy/.env.production.example deploy/.env.production
cp backend/.env.example backend/.env
nano deploy/.env.production
nano backend/.env
```

В `deploy/.env.production` укажи домен без `https://`:

```env
DOMAIN=portal.example.com
```

В `backend/.env` укажи строку подключения к уже существующему PostgreSQL и свой домен:

```env
DATABASE_URL=postgresql+psycopg://USER:PASSWORD@host.docker.internal:5432/DATABASE_NAME
CORS_ORIGINS=https://portal.example.com
COOKIE_SECURE=true
COOKIE_SAMESITE=lax
TRUSTED_PROXY_IPS=172.30.0.0/24
TOKEN_SECRET=long-random-secret
```

Если PostgreSQL работает на том же сервере, но не в Docker, используй `host.docker.internal` как в примере: production Compose уже связывает это имя с хост-сервером. Если база находится на другом сервере, используй её DNS-имя или IP и разреши подключение с IP приложения в настройках PostgreSQL/firewall.

Также заполни Google Sheets, администратора, Discord и остальные обязательные настройки из `.env.example`. Помести service account JSON в `backend/.creditials.json` — именно этот путь монтируется в production-контейнер.

> Пароль в `DATABASE_URL` должен быть URL-кодирован. Если в нём есть, например, `@`, `:`, `/` или `#`, замени их соответственно на `%40`, `%3A`, `%2F`, `%23`. Проще всего использовать пароль из букв, цифр, `-` и `_`.

### 3. Запусти

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f caddy backend
```

Caddy автоматически запрашивает и продлевает HTTPS-сертификат, когда DNS домена указывает на сервер, а порты 80 и 443 доступны извне. После успешного запуска открой `https://portal.example.com`. Automatic HTTPS Caddy требует доступного публичного домена и этих портов. [Документация Caddy](https://caddyserver.com/docs/quick-starts/https)

### 4. Обновление и резервные копии

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Резервная копия JSON-данных и загрузок backend:

```bash
docker run --rm -v site327_backend-data:/data -v "$PWD":/backup alpine tar czf /backup/site327-backend-data.tar.gz -C /data .
```

PostgreSQL резервируй и восстанавливай средствами уже существующего сервера БД, например через `pg_dump` и `psql`; перед восстановлением останови `backend` командой `docker compose -f docker-compose.prod.yml stop backend`.

Compose допускает отдельный production-файл с изменениями для production-среды; этот проект использует самостоятельный `docker-compose.prod.yml`, чтобы локальный запуск на SQLite не менялся. [Документация Docker Compose](https://docs.docker.com/compose/how-tos/production/)

## Старый пример: Linux без HTTPS

Ниже оставлен пример локального HTTP-запуска для Ubuntu/Debian. Для реального сервера используй раздел production выше.

1. Установи Docker:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo tee /etc/apt/keyrings/docker.asc >/dev/null
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

2. Скопируй проект на сервер, например:

```bash
git clone <repo-url> site327
cd site327
```

Если проект переносится архивом, просто распакуй его и перейди в папку проекта.

3. Создай env-файл:

```bash
cp backend/.env.example backend/.env
nano backend/.env
```

4. Для сервера поменяй `CORS_ORIGINS` на домен или IP, с которого будет открываться сайт:

```env
CORS_ORIGINS=http://your-server-ip:5173
```

Если будет домен и HTTPS:

```env
CORS_ORIGINS=https://example.com
```

5. Запусти:

```bash
docker compose up -d --build
```

6. Проверь:

```bash
docker compose ps
curl http://127.0.0.1:8000/api/health
```

Сайт будет доступен на:

```text
http://SERVER_IP:5173
```

## Порты

В `docker-compose.yml`:

- frontend открыт наружу: `5173:8080`
- backend доступен только локально на сервере: `127.0.0.1:8000:8000`

Это сделано специально: пользователи должны ходить через frontend/Nginx, а не напрямую в API.

## Зачем нужен `backend/docker-entrypoint.sh`

Скрипт выполняется непосредственно перед командой запуска FastAPI:

```sh
chown -R app:app /app/data
exec su app -s /bin/sh -c "$*"
```

Он решает две production-задачи:

1. `/app/data` — Docker volume с SQLite, JSON-файлами и загрузками. Docker может создать или подключить его владельцем `root`, поэтому приложение от непривилегированного пользователя не сможет записывать данные. `chown` исправляет владельца при каждом старте контейнера.
2. После этого `uvicorn` запускается от отдельного непривилегированного пользователя `app`, а не от `root`. Если в приложении или зависимости окажется уязвимость, у процесса внутри контейнера будут существенно меньшие права.

Удалять этот скрипт не нужно. Его можно упростить только при отказе от named volume или при отдельной настройке прав на volume — оба варианта ухудшат надёжность либо безопасность запуска.

## Обновление

Если код обновился:

```bash
git pull
docker compose up -d --build
```

Если менялся только `backend/.env`, обычно достаточно:

```bash
docker compose up -d --force-recreate backend
```

## Данные и бэкапы

Важные runtime-данные лежат в Docker volume `site327_backend-data`:

- SQLite база пользователей и кэша состава: `/app/data/app.db`
- JSON с вкладками и формами: `/app/data/forms.json`
- JSON с разделами и Markdown-документами: `/app/data/docs.json`
- JSON главной страницы: `/app/data/home-page.json`

Сделать бэкап:

```bash
docker run --rm -v site327_backend-data:/data -v "$PWD":/backup alpine tar czf /backup/site327-backup.tar.gz -C /data .
```

Восстановить бэкап:

```bash
docker compose down
docker run --rm -v site327_backend-data:/data -v "$PWD":/backup alpine sh -c "rm -rf /data/* && tar xzf /backup/site327-backup.tar.gz -C /data"
docker compose up -d
```

## Google Sheets

Backend читает лист таблицы через Google Sheets API от service account.

1. Создай service account в Google Cloud.
2. Скачай JSON-ключ и положи его как `backend/.creditials.json`.
3. Добавь email service account в доступы таблицы с ролью `Viewer`.
4. В `backend/.env` укажи `GOOGLE_SERVICE_ACCOUNT_FILE=.creditials.json`.

После этого таблицу можно закрыть от публичного доступа.

Состав кэшируется локально и обновляется каждый час в `:01` и `:06`.

Ручная синхронизация доступна в API только админу:

```text
POST /api/admin/soldiers-sync
```

## Права доступа

В админке `/#/ghost-admin` есть отдельные блоки “Доступы форм” и “Доступы документации”. В каждом блоке можно создавать свои группы доступа, например “Инструкторы” или “Офицерский состав”, и указывать списки званий и специализаций через поп-ап настройки.

Вкладки/формы и разделы/документы используют разные наборы доступов. При удалении группы связанные элементы переводятся в доступ “Для всех”.

## Документация

Раздел “Документация” работает отдельно от форм. Админ создаёт разделы документации, привязывает их к группам доступа документации и добавляет документы в формате Markdown. Каждый документ открывается отдельной страницей `/#/docs/{id}`. Поддерживаются заголовки, списки, таблицы, ссылки и картинки через обычный Markdown-синтаксис.

## Безопасность

- Не коммить `backend/.env`.
- Меняй `ADMIN_PASSWORD` и `TOKEN_SECRET` перед запуском на сервере.
- Смена `TOKEN_SECRET` принудительно инвалидирует все старые access и refresh токены.
- Для публичного сервера лучше поставить reverse proxy с HTTPS.
- Backend-порт `8000` в compose привязан к `127.0.0.1`, не открывай его наружу без необходимости.
- Пароли пользователей хранятся хешированными.
- Пароль админа по умолчанию хранится только в `.env`.

## Полезные команды

Логи всех сервисов:

```bash
docker compose logs -f
```

Логи backend:

```bash
docker compose logs -f backend
```

Перезапуск:

```bash
docker compose restart
```

Полная остановка:

```bash
docker compose down
```
