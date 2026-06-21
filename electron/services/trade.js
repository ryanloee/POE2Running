// POE2 国服市集集成模块
// 核心机制:用 Electron 的持久化 session partition 存 QQ 登录态
// 用户在市集窗口登录一次后,POESESSID cookie 持久化,后续搜索自动带 cookie
//
// 国服市集 API(与国际服同构):
//   POST /api/trade2/search/poe2  { query:{...} } → { id, result:[hash...], total }
//   GET  /api/trade2/fetch/<hashes>?query=<id>     → { result:[{item, listing}] }

const BASE = 'https://poe.game.qq.com';
const LEAGUE = 'poe2';
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
  const cookies = await ses.cookies.get({ domain: 'poe.game.qq.com' });
  const poesessid = cookies.find((c) => c.name === 'POESESSID');
  if (!poesessid) {
    return { loggedIn: false, reason: '未登录(无 POESESSID,请点「打开市集登录」用 QQ 登录)' };
  }
  return { loggedIn: true };
}

/**
 * 在市集 session 里发请求(自动带 cookie)
 * 用 Electron session 的原生 fetch(比 net.request 更可靠地带 cookie)
 */
async function tradeFetch(electron, urlPath, method = 'GET', body = null) {
  const ses = getTradeSession(electron);
  const fullUrl = urlPath.startsWith('http') ? urlPath : `${BASE}${urlPath}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include', // 关键:带 cookie
    redirect: 'manual', // 不跟随重定向(未登录会302,我们靠状态码判断)
  };
  if (body) {
    opts.body = JSON.stringify(body);
  }
  const res = await ses.fetch(fullUrl, opts);
  const text = await res.text();
  if (res.status === 0 || res.status >= 400) {
    return { error: { code: res.status, message: `HTTP ${res.status}: ${text.slice(0, 200)}` } };
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    // 非 JSON(可能是重定向的登录页 HTML)
    return { error: { code: -1, message: '返回非 JSON(可能未登录或被重定向)' } };
  }
}

/**
 * 搜索市集装备
 * @param {object} electron
 * @param {object} query 国际服格式搜索条件
 * @param {number} limit 返回详情数量
 * @returns {Promise<{total, items}>}
 */
async function search(electron, query, limit = 20) {
  // 1. 发起搜索
  const searchRes = await tradeFetch(electron, `/api/trade2/search/${LEAGUE}`, 'POST', {
    query,
    sort: { price: 'asc' },
  });
  if (searchRes.error) {
    throw new Error(`搜索失败: ${JSON.stringify(searchRes.error)}`);
  }
  const hashes = searchRes.result || [];
  const total = searchRes.total || 0;
  if (!hashes.length) return { total: 0, items: [] };

  // 2. 分批 fetch 详情(每批最多 10 个)
  const want = hashes.slice(0, Math.min(limit, hashes.length));
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
    await new Promise((r) => setTimeout(r, 500)); // 礼貌延迟
  }
  return { total, items };
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
    seller: (listing.account && listing.account.lastCharacterName) || '-',
    note: item.note || '',
    id: item.id || '',
  };
}

/**
 * 根据装备需求构造搜索 query
 * @param {object} needs AI 分析出的装备需求 { type, statKeywords }
 */
function buildQuery(needs) {
  const q = { status: { option: 'online' } }; // 在线卖家
  if (needs.type) q.type = needs.type;
  // 词缀精确匹配需要词缀 ID,这里先用类型过滤(国服支持中文类型名)
  // 复杂词缀过滤留待后续(需要词缀ID表)
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
