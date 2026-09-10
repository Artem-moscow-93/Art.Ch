# Семейные финансы — пароль вместо Google OAuth

## 1. Создать Apps Script
Открой исходную Google-таблицу `Семейные расходы_доходы` → Расширения → Apps Script.

## 2. Вставить файлы
- содержимое `apps-script/Code.gs` вставить в `Code.gs`;
- создать HTML-файл с именем `Index` и вставить содержимое `apps-script/Index.html`.

## 3. Задать пароль
Apps Script → Project Settings → Script Properties → Add script property:
- Property: `DASHBOARD_PASSWORD`
- Value: придуманный пароль

Пароль не нужно добавлять в GitHub или HTML.

## 4. Deploy
Deploy → New deployment → Web app:
- Execute as: Me
- Who has access: Anyone

Нажать Deploy и скопировать URL вида `https://script.google.com/macros/s/.../exec`.

## 5. Проверка
Открыть URL. Должен появиться только экран ввода пароля. После успешного входа токен хранится в localStorage и действует 30 дней; Google OAuth больше не требуется.

## Безопасность
- Sheet остаётся приватным.
- Пароль хранится только в Script Properties на серверной стороне Apps Script.
- В браузере сохраняется подписанный сессионный токен, а не пароль.
- Токен автоматически истекает через 30 дней.
- Кнопка `Выйти` удаляет локальный токен.
