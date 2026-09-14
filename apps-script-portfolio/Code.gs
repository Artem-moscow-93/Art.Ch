const PORTFOLIO_SHEET = 'Портфель';
const DASHBOARD_SHEET = 'Дашборд';
const SESSION_DAYS = 30;
const MARKET_CACHE_SECONDS = 900;
const MARKET_CACHE_KEY = 'market_data_v2';
const MARKET_LAST_GOOD_KEY = 'MARKET_LAST_GOOD_V2';

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

function getMarketData(token) {
  if (!verifyToken_(token)) throw new Error('Сессия истекла. Введите пароль снова.');

  const cache = CacheService.getScriptCache();
  const cached = cache.get(MARKET_CACHE_KEY);
  if (cached) {
    const data = JSON.parse(cached);
    data.cacheHit = true;
    return data;
  }

  try {
    const data = fetchMarketData_();
    const json = JSON.stringify(data);
    cache.put(MARKET_CACHE_KEY, json, MARKET_CACHE_SECONDS);
    PropertiesService.getScriptProperties().setProperty(MARKET_LAST_GOOD_KEY, json);
    return data;
  } catch (error) {
    const lastGood = PropertiesService.getScriptProperties().getProperty(MARKET_LAST_GOOD_KEY);
    if (lastGood) {
      const data = JSON.parse(lastGood);
      data.stale = true;
      data.error = String(error && error.message || error);
      return data;
    }
    throw new Error('Не удалось получить рыночные данные: ' + String(error && error.message || error));
  }
}

function fetchMarketData_() {
  const today = Utilities.formatDate(new Date(), 'Europe/Moscow', 'yyyy-MM-dd');
  const cbrDate = today.split('-').reverse().join('/');
  const requests = [
    {url: 'https://iss.moex.com/iss/engines/stock/markets/index/securities/IMOEX.json?iss.meta=off&iss.only=marketdata,securities', muteHttpExceptions: true},
    {url: 'https://iss.moex.com/iss/engines/stock/markets/index/securities/RGBI.json?iss.meta=off&iss.only=marketdata,securities', muteHttpExceptions: true},
    {url: 'https://www.cbr.ru/scripts/XML_daily.asp?date_req=' + cbrDate, muteHttpExceptions: true}
  ];
  const responses = UrlFetchApp.fetchAll(requests);
  return {
    imoex: parseMoexIndex_(responses[0], 'IMOEX'),
    rgbi: parseMoexIndex_(responses[1], 'RGBI'),
    usd: parseCbrUsd_(responses[2]),
    fetchedAt: new Date().toISOString(),
    cacheSeconds: MARKET_CACHE_SECONDS,
    cacheHit: false,
    stale: false
  };
}

function parseMoexIndex_(response, security) {
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) throw new Error(security + ': HTTP ' + status);
  const json = JSON.parse(response.getContentText());
  const market = tableObjects_(json.marketdata).filter(row => row.SECID === security);
  for (let i = 0; i < market.length; i++) {
    const row = market[i];
    if (positiveNumber_(row.CURRENTVALUE) && (row.TRADEDATE || row.SYSTIME)) {
      return {
        value: Number(row.CURRENTVALUE),
        date: String(row.TRADEDATE || row.SYSTIME).slice(0, 10),
        time: row.UPDATETIME || String(row.SYSTIME || '').slice(11, 19),
        source: 'Мосбиржа · возможна задержка'
      };
    }
  }
  const previous = tableObjects_(json.securities).find(row =>
    row.SECID === security && positiveNumber_(row.PREVPRICE) && row.PREVDATE
  );
  if (previous) {
    return {
      value: Number(previous.PREVPRICE),
      date: String(previous.PREVDATE).slice(0, 10),
      source: 'Мосбиржа · последнее закрытие'
    };
  }
  throw new Error(security + ': котировка отсутствует');
}

function parseCbrUsd_(response) {
  const status = response.getResponseCode();
  if (status < 200 || status >= 300) throw new Error('USD/RUB: HTTP ' + status);
  const xml = response.getBlob().getDataAsString('windows-1251');
  const root = XmlService.parse(xml).getRootElement();
  const usd = root.getChildren('Valute').find(node =>
    node.getChildText('CharCode') === 'USD'
  );
  if (!usd) throw new Error('USD/RUB: курс отсутствует');
  const nominal = Number(String(usd.getChildText('Nominal')).replace(',', '.'));
  const value = Number(String(usd.getChildText('Value')).replace(',', '.')) / nominal;
  if (!positiveNumber_(value)) throw new Error('USD/RUB: некорректный курс');
  const rawDate = root.getAttribute('Date').getValue();
  return {
    value: value,
    date: rawDate.split('.').reverse().join('-'),
    source: 'Официальный курс ЦБ РФ'
  };
}

function tableObjects_(table) {
  if (!table || !table.columns || !table.data) return [];
  return table.data.map(row => {
    const object = {};
    table.columns.forEach((key, index) => object[key] = row[index]);
    return object;
  });
}

function positiveNumber_(value) {
  return value !== null && value !== '' && isFinite(Number(value)) && Number(value) > 0;
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
