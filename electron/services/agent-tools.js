// Agent 工具注册表:统一定义所有 agent 可调用的工具
// 每个工具: { name, description, parameters, execute(args, ctx) }
// ctx = { settings, electron, tradeSession }

const poe2 = require('./poe2');
const exportMod = require('./export');

// ============ 工具定义 ============

const tools = [
  {
    name: 'fetch_build',
    description: '根据分享码获取 POE2 玩家的完整 BD 数据(角色/面板/装备/技能/评分)。当用户提供分享码或链接时使用。',
    parameters: {
      type: 'object',
      properties: {
        shareCode: { type: 'string', description: '玩家分享码或完整链接' },
      },
      required: ['shareCode'],
    },
    async execute(args) {
      const code = extractShareCode(args.shareCode);
      if (!code) return { error: '无效的分享码' };
      const bd = await poe2.fetchAll(code);
      // 返回精简文本(避免 token 过多)
      return { buildText: exportMod.bdToText(bd), raw: bd };
    },
  },
  {
    name: 'search_knowledge',
    description: '【分析必用】查 POE2 游戏知识库(技能/词缀/装备基底数据)。分析 BD 属性时先查这个获取准确数值,不要编造!',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词。用英文效果最好,如"fire resistance"、"life"、"chest base"、"armour evasion"。也支持中文如"火抗词缀"。' },
        topK: { type: 'integer', description: '返回条数,默认 5' },
      },
      required: ['query'],
    },
    async execute(args, ctx) {
      const retriever = require('./knowledge/retriever');
      const indexer = require('./knowledge/indexer');
      if (!indexer.isIndexed()) return { error: '知识库未构建,请先在设置中构建知识库' };
      const results = await retriever.retrieve(ctx.settings, args.query, args.topK || 5);
      if (!results.length) return { results: [], note: '未找到相关知识' };
      return { results: results.map((r) => ({ title: r.title, content: r.content.slice(0, 500), score: r.score })) };
    },
  },
  {
    name: 'compare_builds',
    description: '对比两个 POE2 BD,输出逐项差异表格。用户给出两个分享码时使用。',
    parameters: {
      type: 'object',
      properties: {
        codeA: { type: 'string', description: 'BD A 的分享码或链接' },
        codeB: { type: 'string', description: 'BD B 的分享码或链接' },
      },
      required: ['codeA', 'codeB'],
    },
    async execute(args) {
      const a = extractShareCode(args.codeA);
      const b = extractShareCode(args.codeB);
      if (!a || !b) return { error: '需要两个有效的分享码' };
      const [bdA, bdB] = await Promise.all([poe2.fetchAll(a), poe2.fetchAll(b)]);
      return { buildTextA: exportMod.bdToText(bdA), buildTextB: exportMod.bdToText(bdB) };
    },
  },
  {
    name: 'analyze_gaps',
    description: '分析 BD 的属性短板(抗性未满/生命不足等),给出具体差值。用于诊断角色问题。',
    parameters: {
      type: 'object',
      properties: {
        shareCode: { type: 'string', description: '玩家分享码或链接' },
      },
      required: ['shareCode'],
    },
    async execute(args) {
      const code = extractShareCode(args.shareCode);
      if (!code) return { error: '无效的分享码' };
      const bd = await poe2.fetchAll(code);
      const panel = bd.panel || {};
      const gaps = [];
      const check = (name, val, target) => {
        const n = parseFloat(val);
        if (!isNaN(n) && n < target) gaps.push({ stat: name, current: n, target, deficit: target - n });
      };
      check('火抗', panel.fire_resistance, 75);
      check('冰抗', panel.cold_resistance, 75);
      check('雷抗', panel.lightning_resistance, 75);
      check('混沌抗', panel.chaos_resistance, 75);
      check('生命', panel.life, 2000);
      check('护甲', panel.armour, 5000);
      check('闪避', panel.evasion_rating, 5000);
      return {
        role: `${bd.role?.name} (${bd.role?.class_name} Lv${bd.role?.level})`,
        gaps,
        buildText: exportMod.bdToText(bd),
      };
    },
  },
  {
    name: 'search_market',
    description: '搜索 POE2 国服市集在售装备。只按类型搜(条件极少),返回多个候选结果(含价格/等级/全部词缀)供用户选择。',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: '国服真实基底名。胸甲:蜥鳞外套/蛇鳞外套/皮革背心;戒指:翡翠戒指/蓝玉戒指/紫晶戒指/红玉戒指;项链:日曜项链/赤红项链;腰带:万用腰带/生皮腰带;头盔:海螺头盔;手套:精纺护腕;鞋子:牢靠绑腿;武器:飞翼长矛/分叉长矛。不确定时先调 list_market_slots 查看!' },
        level: { type: 'integer', description: '角色等级(可选),用于过滤物品等级' },
        max_results: { type: 'integer', description: '返回条数,默认 15(建议多返回,让用户选)' },
      },
      required: ['type'],
    },
    async execute(args, ctx) {
      console.log('[search_market] type:', args.type, 'level:', args.level);
      if (!ctx.electron) return { error: '市集未登录,无法搜索。请先在设置中登录国服市集(QQ账号)。' };
      const skills = require('./skills');
      const trade = require('./trade');

      const queryObj = skills.buildPreciseQuery({ type: args.type });
      const opts = {};
      if (args.level && args.level > 0) opts.minIlvl = Math.max(1, args.level - 10);

      const max = args.max_results || 15;
      console.log('[search_market] query:', JSON.stringify(queryObj), 'opts:', JSON.stringify(opts));
      const results = await trade.search(ctx.electron, queryObj, max, opts);

      // 生成购买链接:国服市集搜索结果页,用户点击即可查看/购买
      const league = trade.LEAGUE;
      const searchUrl = `https://poe.game.qq.com/trade2/search/${league}`;

      // 返回完整信息:名称/价格/等级/全部词缀/购买链接,让用户自己选
      return {
        searchType: args.type,
        total: results.total,
        returned: results.items.length,
        searchUrl, // 搜索结果页链接(用户可去这里直接看全部结果)
        items: (results.items || []).map((it) => ({
          name: it.name || it.typeLine,
          price: it.price,
          ilvl: it.ilvl,
          rarity: it.rarity,
          mods: it.explicitMods || [],
          seller: it.seller,
          // 单件物品购买链接(在搜索结果页定位)
          buyUrl: `https://poe.game.qq.com/trade2/search/${league}/${results.searchId}`,
        })),
      };
    },
  },
  {
    name: 'list_market_slots',
    description: '列出所有可搜索的装备部位和对应的国服真实基底名称。不确定物品叫什么时先调这个。',
    parameters: { type: 'object', properties: {} },
    async execute() {
      const skills = require('./skills');
      return {
        slots: skills.listSlotTypes(),
        note: '搜索时 type 必须用上面的真实基底名。只按类型+等级+一口价搜,条件尽量少。',
      };
    },
  },
  {
    name: 'search_market_filter',
    description: '按词缀+数值精确搜索市集。当需要特定数值(如火抗≥30、生命≥60)时用这个。先用 search_market 宽泛搜,如果结果太多再用这个精确过滤。',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: '国服真实基底名,如"翡翠戒指"、"蜥鳞外套"。必填。' },
        filters: {
          type: 'array',
          description: '词缀过滤条件,每个含 name 和可选 min。如 [{"name":"火抗","min":30},{"name":"生命","min":60}]',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '词缀中文名: 火抗/冰抗/雷抗/混沌抗/生命/魔力/力量/敏捷/智慧/护甲/闪避/能量护盾/格挡/攻击速度/暴击/移动速度' },
              min: { type: 'number', description: '最小值(可选),如火抗最小30' },
            },
          },
        },
        level: { type: 'integer', description: '角色等级(可选)' },
        max_results: { type: 'integer', description: '返回条数,默认 15' },
      },
      required: ['type'],
    },
    async execute(args, ctx) {
      if (!ctx.electron) return { error: '市集未登录,无法搜索。请先在设置中登录国服市集(QQ账号)。' };
      const skills = require('./skills');
      const trade = require('./trade');

      // 构造带 stats 数值过滤的 query
      const query = {
        filters: { trade_filters: { sale_type: { option: 'any' } } },
        type: args.type,
      };

      // 把中文词缀名转成 stat ID + 数值
      if (args.filters && args.filters.length) {
        const statFilters = [];
        for (const f of args.filters) {
          const id = skills.INTENT_MAP[f.name] || skills.STAT_MAP[f.name];
          if (id) {
            const filter = { id, disabled: false };
            if (f.min !== undefined) filter.value = { min: f.min };
            statFilters.push(filter);
          }
        }
        if (statFilters.length) {
          query.stats = [{ type: 'and', filters: statFilters }];
        }
	      }

      const opts = {};
      if (args.level && args.level > 0) opts.minIlvl = Math.max(1, args.level - 10);
      console.log('[search_market_filter] query:', JSON.stringify(query));
      const results = await trade.search(ctx.electron, query, args.max_results || 15, opts);
      const league = trade.LEAGUE;
      return {
        searchType: args.type,
        filters: args.filters || [],
        total: results.total,
        searchUrl: `https://poe.game.qq.com/trade2/search/${league}`,
        items: (results.items || []).map((it) => ({
          name: it.name || it.typeLine,
          price: it.price,
          ilvl: it.ilvl,
          mods: it.explicitMods || [],
          buyUrl: `https://poe.game.qq.com/trade2/search/${league}/${results.searchId}`,
        })),
      };
    },
  },
];

// ============ 辅助函数 ============

function extractShareCode(input) {
  if (!input) return '';
  let s = input.trim();
  const m = s.match(/#\/share\/([A-Za-z0-9_\-]+)/);
  if (m) return m[1];
  s = s.replace(/\s+/g, '');
  return s;
}

// ============ 导出 ============

/**
 * 获取 OpenAI tools 格式的工具定义列表
 */
function getToolDefinitions() {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/**
 * 执行工具调用
 * @param {string} name 工具名
 * @param {object} args 工具参数
 * @param {object} ctx 运行时上下文 { settings, electron, tradeSession }
 * @returns {Promise<object>}
 */
async function executeTool(name, args, ctx) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { error: `未知工具: ${name}` };
  try {
    return await tool.execute(args, ctx);
  } catch (e) {
    return { error: `工具 ${name} 执行失败: ${e.message}` };
  }
}

module.exports = { getToolDefinitions, executeTool, tools };
