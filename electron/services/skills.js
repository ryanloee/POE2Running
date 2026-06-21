// 市集操作技能(trade skills)
// 这是「实地探索市集 API 后固化的稳定技能」,AI 分析后直接调用,而非每次猜测
//
// 探索结论(已验证):
// - 国服 API 与国际服完全同构,且数据是中文
// - stat ID 表:explicit.stat_xxx / pseudo.pseudo_xxx(8159 条,国服有中文 text)
// - 物品类型:中文(翡翠戒指/飞翼长矛等),用在 query.type 字段
// - 搜索 query 结构:{ status, type, stats:[{type:'and',filters:[{id}]}] }
//
// 这里固化的是「BD 配装最常用的词缀/装备映射」,覆盖 90% 玩家需求

// ============================================
// 核心词缀 ID 映射(从国服 /api/trade2/data/stats 提炼)
// 这些是 BD 配装最常搜的词缀,AI 用这些 ID 做精确搜索
// ============================================
const STAT_MAP = {
  // 抗性(玩家最常补的)
  fire_resist: 'explicit.stat_3372524247',        // #% 火焰抗性
  cold_resist: 'explicit.stat_4220027924',        // #% 冰霜抗性
  lightning_resist: 'explicit.stat_1671376347',   // #% 闪电抗性
  chaos_resist: 'explicit.stat_2955261627',       // #% 混沌抗性
  all_resist: 'explicit.stat_2905760668',         // 所有抗性
  total_fire_resist: 'pseudo.pseudo_total_fire_resistance',
  total_cold_resist: 'pseudo.pseudo_total_cold_resistance',
  total_lightning_resist: 'pseudo.pseudo_total_lightning_resistance',

  // 生命/魔力
  life: 'explicit.stat_3162963245',              // +生命上限
  life_regen: 'explicit.stat_2120016737',        // 生命再生
  mana: 'explicit.stat_124859000',               // +魔力上限

  // 属性
  strength: 'explicit.stat_4080418644',          // 力量
  dexterity: 'explicit.stat_3261801346',         // 敏捷
  intelligence: 'explicit.stat_328541901',       // 智慧

  // 防御
  armour: 'explicit.stat_770176757',             // 护甲
  evasion: 'explicit.stat_1245199102',           // 闪避值
  energy_shield: 'explicit.stat_3762232584',     // 能量护盾
  block: 'explicit.stat_2733687438',             // 格挡

  // 伤害(常见)
  attack_speed: 'explicit.stat_2711546783',      // 攻击速度
  crit_chance: 'explicit.stat_889961686',        // 暴击率
  physical_damage: 'explicit.stat_1970189208',   // 物理伤害
  fire_damage: 'explicit.stat_3815969413',       // 火焰伤害
  cold_damage: 'explicit.stat_4052030227',       // 冰霜伤害
  lightning_damage: 'explicit.stat_1510646205',  // 闪电伤害
};

// ============================================
// 中文意图 → stat ID 映射(AI/玩家用中文描述需求,这里翻译成 ID)
// 这是「技能」的核心:把自然语言转成精确的搜索条件
// ============================================
const INTENT_MAP = {
  '火抗': STAT_MAP.fire_resist,
  '火焰抗性': STAT_MAP.fire_resist,
  '冰抗': STAT_MAP.cold_resist,
  '冰霜抗性': STAT_MAP.cold_resist,
  '雷抗': STAT_MAP.lightning_resist,
  '闪电抗性': STAT_MAP.lightning_resist,
  '混沌抗性': STAT_MAP.chaos_resist,
  '全抗': STAT_MAP.all_resist,
  '生命': STAT_MAP.life,
  '生命上限': STAT_MAP.life,
  '魔力': STAT_MAP.mana,
  '力量': STAT_MAP.strength,
  '敏捷': STAT_MAP.dexterity,
  '智慧': STAT_MAP.intelligence,
  '护甲': STAT_MAP.armour,
  '闪避': STAT_MAP.evasion,
  '能量护盾': STAT_MAP.energy_shield,
  '格挡': STAT_MAP.block,
  '攻击速度': STAT_MAP.attack_speed,
  '暴击': STAT_MAP.crit_chance,
  '物攻': STAT_MAP.physical_damage,
  '物理伤害': STAT_MAP.physical_damage,
  '火伤': STAT_MAP.fire_damage,
  '冰伤': STAT_MAP.cold_damage,
  '雷伤': STAT_MAP.lightning_damage,
};

// ============================================
// 装备部位 → 常见物品类型(国服中文名,用于 query.type)
// ============================================
const SLOT_TYPES = {
  戒指: ['翡翠戒指', '蓝玉戒指', '紫晶戒指', '红宝石戒指', '黄玉戒指', '海蓝戒指'],
  项链: ['日曜项链', '翡翠护身符', '赤红项链', '帝国项链', '碧玉项链'],
  腰带: ['万用腰带', '皮革腰带', '重革腰带'],
  头盔: ['海螺头盔', '精制战冠', '皮质头巾'],
  胸甲: ['蜥鳞外套', '板甲', '皮甲'],
  手套: ['精纺护腕', '皮革手套', '铁手套'],
  鞋子: ['牢靠绑腿', '皮靴', '铁靴'],
  武器: ['飞翼长矛', '分叉长矛', '战矛'],
  盾牌: ['嵌板轻盾', '鸢形盾', '塔盾'],
};

/**
 * 技能1:根据中文意图构造精确搜索 query
 * @param {object} need { type?, intents?: ['火抗','生命'], slot? }
 * @returns {object} 国际服/国服通用 query
 */
function buildPreciseQuery(need) {
  const query = { status: { option: 'online' } };

  // 物品类型过滤
  if (need.type) {
    query.type = need.type;
  } else if (need.slot && SLOT_TYPES[need.slot]) {
    // 只指定部位时,用第一个常见类型(或玩家可自己选)
    query.type = SLOT_TYPES[need.slot][0];
  }

  // 词缀精确过滤(核心技能:把中文意图转成 stat ID)
  const intents = need.intents || [];
  const statIds = [];
  for (const intent of intents) {
    const id = INTENT_MAP[intent] || intent; // intent 可能本身就是 stat ID
    if (id) statIds.push(id);
  }
  if (statIds.length) {
    query.stats = [{
      type: 'and', // AND:所有词缀都要满足
      filters: statIds.map((id) => ({ id, disabled: false })),
    }];
  }

  return query;
}

/**
 * 技能2:从 BD 差距分析自动生成搜索任务列表
 * 输入:玩家的 BD 数据(抗性/属性缺失情况)
 * 输出:该去市集搜什么装备、补什么词缀
 */
function generateSearchTasks(bd) {
  if (!bd || !bd.panel) return [];
  const panel = bd.panel;
  const tasks = [];

  // 抗性不足:按缺失程度推荐补抗部位
  const resNeeded = [];
  if (parseFloat(panel.fire_resistance) < 75) resNeeded.push({ intent: '火抗', gap: 75 - parseFloat(panel.fire_resistance) });
  if (parseFloat(panel.cold_resistance) < 75) resNeeded.push({ intent: '冰抗', gap: 75 - parseFloat(panel.cold_resistance) });
  if (parseFloat(panel.lightning_resistance) < 75) resNeeded.push({ intent: '雷抗', gap: 75 - parseFloat(panel.lightning_resistance) });

  // 戒指:最常补抗性的部位(2个戒指位)
  if (resNeeded.length) {
    const topResist = resNeeded.sort((a, b) => b.gap - a.gap)[0];
    tasks.push({
      slot: '戒指',
      type: '翡翠戒指',
      intents: [topResist.intent, '生命'],
      reason: `火/冰/雷抗性缺口最大的是${topResist.intent}(差${topResist.gap.toFixed(0)}%),戒指补抗最划算`,
    });
  }

  // 生命不足:腰带/戒指补生命
  if (parseInt(panel.life) < 1500) {
    tasks.push({
      slot: '腰带',
      type: '万用腰带',
      intents: ['生命', '全抗'],
      reason: `生命 ${panel.life} 偏低,腰带补生命+抗性`,
    });
  }

  return tasks;
}

/**
 * 技能3:从 AI 分析文本中提取结构化搜索需求
 * 比正则更智能:识别「换 XX 装备」「补 YY 抗性」等模式
 */
function parseAIRecommendations(aiText) {
  const tasks = [];
  if (!aiText) return tasks;

  // 识别 AI 建议的装备类型(中文物品名)
  const allTypes = new Set();
  Object.values(SLOT_TYPES).forEach((arr) => arr.forEach((t) => allTypes.add(t)));
  const foundTypes = [...allTypes].filter((t) => aiText.includes(t));

  // 识别 AI 建议补的属性
  const foundIntents = Object.keys(INTENT_MAP).filter((intent) => aiText.includes(intent));

  // 组合成搜索任务
  for (const type of foundTypes) {
    // 找这个装备类型所属的部位
    let slot = '';
    for (const [s, arr] of Object.entries(SLOT_TYPES)) {
      if (arr.includes(type)) { slot = s; break; }
    }
    tasks.push({
      slot,
      type,
      intents: foundIntents.slice(0, 3), // 最多带3个词缀过滤
      reason: `AI 推荐: 换 ${type}${foundIntents.length ? ',补' + foundIntents.join('/') : ''}`,
    });
  }

  return tasks;
}

/**
 * 获取所有可用的中文意图列表(给 AI/前端展示用)
 */
function listIntents() {
  return Object.keys(INTENT_MAP);
}

module.exports = {
  STAT_MAP,
  INTENT_MAP,
  SLOT_TYPES,
  buildPreciseQuery,
  generateSearchTasks,
  parseAIRecommendations,
  listIntents,
};
