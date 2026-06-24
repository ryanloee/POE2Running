// POE2 国服市集集成模块
// 核心机制:用 Electron 的持久化 session partition 存 QQ 登录态
// 用户在市集窗口登录一次后,POESESSID cookie 持久化,后续搜索自动带 cookie
//
// 国服市集 API(与国际服同构):
//   POST /api/trade2/search/poe2  { query:{...} } → { id, result:[hash...], total }
//   GET  /api/trade2/fetch/<hashes>?query=<id>     → { result:[{item, listing}] }

const BASE = 'https://poe.game.qq.com';
// 国服赛季名(动态获取,默认当前赛季)
let LEAGUE = '奥杜尔秘符';
const TRADE_PARTITION = 'persist:poe2-trade'; // 持久化会话分区(cookie 存这里)

/**
 * 获取市集用的 session(Electron 持久化分区)
 * @param {import('electron')} electron
 */
function getTradeSession(electron) {
  return electron.session.fromPartition(TRADE_PARTITION);
}

/**
 * 检查市集登录态
 * 有 POESESSID cookie 即视为已登录(有效性在实际搜索时验证)
 */
async function checkLogin(electron) {
  const ses = getTradeSession(electron);
  // 不限制 domain,获取所有 cookie 来查找 POESESSID
  const allCookies = await ses.cookies.get({});
  const poesessid = allCookies.find((c) => c.name === 'POESESSID');
  // 诊断日志
  const poeCookies = allCookies.filter((c) => c.domain.includes('poe') || c.name === 'POESESSID');
  console.log('[trade:checkLogin] 所有cookie数:', allCookies.length, 'poe相关:', poeCookies.map(c => c.name + '@' + c.domain).join(', '));
  if (!poesessid) {
    return { loggedIn: false, reason: '未登录(无 POESESSID,请点「打开市集登录」用 QQ 登录)' };
  }
  console.log('[trade:checkLogin] 找到POESESSID, domain:', poesessid.domain);
  return { loggedIn: true };
}

/**
 * 在市集 session 里发请求(自动带 cookie)
 * 429 限流时自动等待重试
 */
async function tradeFetch(electron, urlPath, method = 'GET', body = null) {
  const ses = getTradeSession(electron);
  const fullUrl = urlPath.startsWith('http') ? urlPath : `${BASE}${urlPath}`;

  // 最多重试3次(应对429限流)
  for (let attempt = 0; attempt < 3; attempt++) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      redirect: 'manual',
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await ses.fetch(fullUrl, opts);
    const text = await res.text();

    // 429 限流:等待后重试
    if (res.status === 429) {
      const wait = 2000 * (attempt + 1); // 2s, 4s, 6s
      console.log(`[trade] HTTP 429 限流,${wait}ms 后重试(${attempt + 1}/3)`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }

    console.log('[trade] HTTP', res.status, fullUrl.slice(0, 80), 'body_len:', text.length);
    if (res.status === 0 || res.status >= 400) {
      console.error('[trade] 错误响应:', text.slice(0, 300));
      return { error: { code: res.status, message: `HTTP ${res.status}: ${text.slice(0, 200)}` } };
    }
    try {
      return JSON.parse(text);
    } catch (e) {
      return { error: { code: -1, message: '返回非 JSON(可能未登录或被重定向)' } };
    }
  }
  // 3次都429
  return { error: { code: 429, message: '市集限流,请稍后再试(请求太频繁)' } };
}

/**
 * 获取当前赛季名(缓存)
 */
let leagueCached = null;
async function getCurrentLeague(electron) {
  if (leagueCached) return leagueCached;
  try {
    const res = await tradeFetch(electron, '/api/trade2/data/leagues', 'GET');
    if (res.result && res.result.length) {
      // 取第一个非永久、非专家的赛季
      const league = res.result.find((l) => l.id !== '永久' && !l.id.includes('专家'));
      leagueCached = league ? league.id : res.result[0].id;
      console.log('[trade] 当前赛季:', leagueCached);
      return leagueCached;
    }
  } catch (e) { console.error('[trade] 获取赛季失败:', e.message); }
  return LEAGUE; // fallback
}

/**
 * 搜索市集装备
 * @param {object} electron
 * @param {object} query 国服格式搜索条件
 * @param {number} limit 返回详情数量
 * @param {object} opts { minIlvl?: 等级下限,用于结果筛选 }
 * @returns {Promise<{total, items}>}
 */
async function search(electron, query, limit = 20, opts = {}) {
  // 确保赛季名正确
  const league = await getCurrentLeague(electron);
  // 1. 发起搜索
  const searchBody = { query, sort: { price: 'asc' } };
  console.log('[trade] === 搜索开始 ===');
  console.log('[trade] 赛季:', league);
  console.log('[trade] 搜索请求:', JSON.stringify(searchBody));
  const searchRes = await tradeFetch(electron, `/api/trade2/search/${league}`, 'POST', searchBody);
  if (searchRes.error) {
    console.error('[trade] 搜索失败:', JSON.stringify(searchRes.error));
    throw new Error(`搜索失败: ${JSON.stringify(searchRes.error)}`);
  }
  const hashes = searchRes.result || [];
  const total = searchRes.total || 0;
  console.log('[trade] 搜索结果数:', total, 'hashes:', hashes.length);
  if (!hashes.length) return { total: 0, items: [] };

  // 2. 分批 fetch 详情(每批最多 10 个)
  // 取更多 hash 来筛选(因为有等级过滤,要拿多一些)
  const want = hashes.slice(0, Math.min(limit * 2, hashes.length));
  const items = [];
  for (let i = 0; i < want.length; i += 10) {
    const batch = want.slice(i, i + 10);
    const detail = await tradeFetch(
      electron,
      `/api/trade2/fetch/${batch.join(',')}?query=${searchRes.id || ''}`,
      'GET'
    );
    if (detail.result && Array.isArray(detail.result)) {
      items.push(...detail.result.map(normalizeItem));
    }
    await new Promise((r) => setTimeout(r, 300)); // 礼貌延迟
  }

  // 等级筛选(在结果中过滤,不在 query 里加,避免搜不到)
  let filtered = items;
  if (opts.minIlvl && opts.minIlvl > 0) {
    filtered = items.filter((it) => (it.ilvl || 0) >= opts.minIlvl);
    console.log('[trade] 等级筛选 ≥', opts.minIlvl, ':', items.length, '→', filtered.length);
  }

  return { total, items: filtered.slice(0, limit), searchId: searchRes.id || '' };
}

/**
 * 标准化物品信息(UI 展示用)
 */
function normalizeItem(entry) {
  const item = entry.item || {};
  const listing = entry.listing || {};
  const price = listing.price;
  return {
    name: item.name || '',
    typeLine: item.typeLine || '',
    rarity: item.frameType, // 0普通1魔法2稀有3传奇
    ilvl: item.ilvl,
    explicitMods: item.explicitMods || [],
    implicitMods: item.implicitMods || [],
    price: price ? `${price.amount} ${price.currency}` : '议价',
    priceAmount: price?.amount || null,
    priceCurrency: price?.currency || '',
    seller: (listing.account && listing.account.lastCharacterName) || '-',
    note: item.note || '',
    id: item.id || '',
  };
}

/**
 * 根据装备需求构造搜索 query
 * 实测验证:用 sale_type=any + 类型,条件尽量少
 * @param {object} needs { type, statIds? }
 */
function buildQuery(needs) {
  const q = {
    filters: {
      trade_filters: { sale_type: { option: 'any' } },
    },
  };
  if (needs.type) q.type = needs.type;
  return q;
}

/**
 * 从 AI 分析结果提取装备搜索需求
 * AI 回复通常是 Markdown,里面会提到装备名/类型
 */
function extractNeedsFromAI(aiResult) {
  const needs = [];
  if (!aiResult) return needs;
  // 简单提取:找 AI 提到的装备类型关键词
  const typeKeywords = [
    '翡翠戒指', '蓝玉戒指', '紫晶戒指', '红宝石戒指',
    '飞翼长矛', '分叉长矛', '战矛',
    '海螺头盔', '蜥鳞外套', '精纺护腕', '牢靠绑腿',
    '万用腰带', '日曜项链', '嵌板轻盾',
  ];
  for (const kw of typeKeywords) {
    if (aiResult.includes(kw)) {
      needs.push({ type: kw, reason: `AI 推荐: ${kw}` });
    }
  }
  return needs;
}

module.exports = {
  BASE,
  LEAGUE,
  TRADE_PARTITION,
  checkLogin,
  search,
  buildQuery,
  normalizeItem,
  extractNeedsFromAI,
};
