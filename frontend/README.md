# Frontend

React + Vite интерфейс портала 327 Star Corp.

## Структура

- `src/main.tsx` - вход React-приложения.
- `src/pages/` - страницы и крупные экраны приложения.
- `src/api/` - клиент backend API и работа с сессией.
- `src/types/` - TypeScript-типы данных API.
- `src/styles/` - глобальные стили.
- `src/components/` - место для переиспользуемых UI-компонентов.
- `src/layouts/` - место для layout-обёрток.
- `src/hooks/` - место для React hooks.
- `src/utils/` - общие frontend helpers.

Сейчас основная UI-логика ещё в `src/pages/App.tsx`; её можно дальше дробить по страницам без изменения API.
