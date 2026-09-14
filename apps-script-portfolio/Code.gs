const PORTFOLIO_SHEET = 'Портфель';
const DASHBOARD_SHEET = 'Дашборд';
const SESSION_DAYS = 30;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Инвестиционный портфель')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function login(password) {
  const expected = PropertiesService.getScriptProperties().getProperty('DASHBOARD_PASSWORD');
  if (!expected) throw new Error('Сначала задайте DASHBOARD_PASSWORD в Script Properties');
  if (String(password || '') !== expected) {
    Utilities.sleep(800);
    throw new Error('Неверный пароль');
  }
  return { token: issueToken_(), data: buildDashboardData_() };
}

function getData(token) {
  if (!verifyToken_(token)) throw new Error('Сессия истекла. Введите пароль снова.');
  return { token: token, data: buildDashboardData_() };
}

function buildDashboardData_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(PORTFOLIO_SHEET);
  if (!sheet) throw new Error('Не найден лист «' + PORTFOLIO_SHEET + '»');

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) throw new Error('Лист «Портфель» пуст');
  const headers = values.shift().map(String);
  const col = {};
  headers.forEach((name, index) => col[name] = index);
  const required = ['asset_id','Тикер','Название','Тип актива','Ликвидность','Владелец','Счет','Остаток, шт','Remaining cost basis RUB','Текущая цена RUB','Market value RUB','Cash income RUB','Total P&L RUB','Total return'];
  required.forEach(name => {
    if (col[name] === undefined) throw new Error('В листе «Портфель» нет столбца «' + name + '»');
  });

  const n = value => Number(value) || 0;
  const positions = values
    .filter(row => n(row[col['Остаток, шт']]) > 0 && n(row[col['Market value RUB']]) > 0)
    .map(row => {
      const pnl = n(row[col['Total P&L RUB']]);
      const ret = n(row[col['Total return']]);
      const assetTypeRaw = String(row[col['Тип актива']] || '');
      const assetType = assetTypeRaw === 'Фонд' ? 'Фонды' : assetTypeRaw === 'Облигация' ? 'Облигации' : 'Акции';
      return {
        assetId: String(row[col.asset_id] || ''),
        ticker: String(row[col['Тикер']] || ''),
        name: String(row[col['Название']] || ''),
        assetType: assetType,
        owner: String(row[col['Владелец']] || ''),
        account: String(row[col['Счет']] || ''),
        qty: n(row[col['Остаток, шт']]),
        price: n(row[col['Текущая цена RUB']]),
        value: n(row[col['Market value RUB']]),
        pnl: pnl,
        ret: ret,
        income: n(row[col['Cash income RUB']]),
        returnBasis: ret ? pnl / ret : n(row[col['Remaining cost basis RUB']]),
        liquidity: String(row[col['Ликвидность']] || '')
      };
    });

  const accountOrder = [
    ['Артем','ИИС','Артем · ИИС'],
    ['Артем','Брок. счет','Артем · брокерский'],
    ['Тамара','ИИС','Тамара · ИИС'],
    ['Тамара','Брок. счет','Тамара · брокерский']
  ];
  const accounts = accountOrder.map(([owner, account, label]) => {
    const rows = positions.filter(x => x.owner === owner && x.account === account);
    const nav = sum_(rows, 'value');
    const pnl = sum_(rows, 'pnl');
    const basis = sum_(rows, 'returnBasis');
    const result = { label, owner, account, nav, pnl, ret: basis ? pnl / basis : 0, positions: rows.length };
    if (owner === 'Артем' && account === 'Брок. счет') {
      const frozen = rows.filter(x => x.liquidity === 'Frozen');
      result.frozenNav = sum_(frozen, 'value');
      result.frozenPnl = sum_(frozen, 'pnl');
    }
    return result;
  });

  const typeTotals = {};
  positions.forEach(x => typeTotals[x.assetType] = (typeTotals[x.assetType] || 0) + x.value);
  const totalNav = sum_(positions, 'value');
  const totalPnl = sum_(positions, 'pnl');
  const totalBasis = sum_(positions, 'returnBasis');

  let asOf = new Date();
  const dashboard = ss.getSheetByName(DASHBOARD_SHEET);
  if (dashboard) {
    const candidate = dashboard.getRange('B3').getValue();
    if (candidate instanceof Date && !isNaN(candidate)) asOf = candidate;
  }

  return {
    asOf: Utilities.formatDate(asOf, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd'),
    totalNav: totalNav,
    totalPnl: totalPnl,
    totalReturn: totalBasis ? totalPnl / totalBasis : 0,
    accounts: accounts,
    typeTotals: typeTotals,
    positions: positions
  };
}

function sum_(rows, field) {
  return rows.reduce((total, row) => total + (Number(row[field]) || 0), 0);
}

function issueToken_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('SESSION_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('SESSION_SECRET', secret);
  }
  const payload = JSON.stringify({ exp: Date.now() + SESSION_DAYS * 86400000 });
  const body = Utilities.base64EncodeWebSafe(payload).replace(/=+$/, '');
  const signature = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(body, secret)
  ).replace(/=+$/, '');
  return body + '.' + signature;
}

function verifyToken_(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 2) return false;
    const secret = PropertiesService.getScriptProperties().getProperty('SESSION_SECRET');
    if (!secret) return false;
    const expected = Utilities.base64EncodeWebSafe(
      Utilities.computeHmacSha256Signature(parts[0], secret)
    ).replace(/=+$/, '');
    if (!constantTimeEqual_(parts[1], expected)) return false;
    const json = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
    return Number(JSON.parse(json).exp) > Date.now();
  } catch (error) {
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
