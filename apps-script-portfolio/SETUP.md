# Публикация портфельного дашборда через Apps Script

1. Откройте таблицу «Инвестиционный_портфель» → Расширения → Apps Script. Так проект будет безопасно привязан к таблице без публикации её ID.
2. Вставьте содержимое Code.gs в одноимённый файл.
3. Создайте HTML-файл с именем Index и вставьте содержимое Index.html.
4. Project Settings → Script Properties → Add script property:
   - Property: DASHBOARD_PASSWORD
   - Value: укажите пароль в настройках проекта (не сохраняйте его в GitHub)
5. Deploy → New deployment → Web app:
   - Execute as: Me
   - Who has access: Anyone
6. Откройте выданный URL и проверьте пароль.
7. Передайте URL в этот чат — GitHub Pages /portfolio/ будет переключён на Apps Script.

Данные читаются из листа «Портфель» при загрузке страницы. Сессия сохраняется до закрытия вкладки и действует максимум 30 дней.
