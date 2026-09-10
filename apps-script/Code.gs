const SPREADSHEET_ID = '1XnqDNVnb7S9GiqzW8WZ1DgoC0vGbmO3XED5QLTgOiIc';
const SHEET_NAME = 'API_дашборд';
const SESSION_DAYS = 30;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Семейные финансы')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function login(password) {
  const props = PropertiesService.getScriptProperties();
  const expected = props.getProperty('DASHBOARD_PASSWORD');
  if (!expected) throw new Error('Пароль ещё не настроен в Script Properties');
  if (String(password || '') !== expected) {
    Utilities.sleep(700);
    throw new Error('Неверный пароль');
  }

  const token = issueToken_();
  return { token, rows: readDashboard_() };
}

function getData(token) {
  if (!verifyToken_(token)) throw new Error('Сессия истекла. Введите пароль снова.');
  return { rows: readDashboard_() };
}

function issueToken_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('SESSION_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('SESSION_SECRET', secret);
  }
  const payload = JSON.stringify({ exp: Date.now() + SESSION_DAYS * 86400000 });
  const payload64 = Utilities.base64EncodeWebSafe(payload).replace(/=+$/,'');
  const sig = Utilities.computeHmacSha256Signature(payload64, secret);
  const sig64 = Utilities.base64EncodeWebSafe(sig).replace(/=+$/,'');
  return payload64 + '.' + sig64;
}

function verifyToken_(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 2) return false;
    const secret = PropertiesService.getScriptProperties().getProperty('SESSION_SECRET');
    if (!secret) return false;
    const expected = Utilities.base64EncodeWebSafe(
      Utilities.computeHmacSha256Signature(parts[0], secret)
    ).replace(/=+$/,'');
    if (!constantTimeEqual_(parts[1], expected)) return false;
    const json = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
    const payload = JSON.parse(json);
    return Number(payload.exp) > Date.now();
  } catch (e) {
    return false;
  }
}

function constantTimeEqual_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readDashboard_() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Не найден лист ' + SHEET_NAME);
  const values = sheet.getDataRange().getValues();
  const tz = SpreadsheetApp.openById(SPREADSHEET_ID).getSpreadsheetTimeZone();
  return values.map(row => row.map(v => {
    if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    return v;
  }));
}
