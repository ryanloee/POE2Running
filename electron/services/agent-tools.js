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
    description: '搜索 POE2 游戏知识库(技能/词缀/装备基底数据,来自 Path of Building 2)。当需要查游戏数据、技能效果、词缀数值时使用。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词(中文),如"火抗词缀"、"闪电箭技能"、"胸甲基底"' },
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
    description: '搜索 POE2 国服市集在售装备。可按物品类型和词缀过滤。返回在售列表(名称/词缀/价格/卖家)。',
    parameters: {
      type: 'object',
      properties: {
        item_type: { type: 'string', description: '物品类型(国服中文名,如"胸甲"、"单手剑")' },
        stats: { type: 'array', items: { type: 'string' }, description: '需要的词缀(中文,如"火抗"、"最大生命")' },
        max_results: { type: 'integer', description: '返回的最大结果数,默认 10' },
      },
      required: ['item_type'],
    },
    async execute(args, ctx) {
      const skills = require('./skills');
      const trade = require('./trade');
      const need = { type: args.item_type, intents: args.stats || [], slot: '' };
      const query = skills.buildPreciseQuery(need);
      const results = await trade.search(ctx.electron, query, args.max_results || 10);
      return { items: results.slice(0, 8).map((it) => ({ name: it.name, price: it.price, mods: it.mods?.slice(0, 4) })) };
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
