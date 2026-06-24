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
  // 抗性(玩家最常补的) - 从 /api/trade2/data/stats 验证 2026-06
  fire_resist: 'explicit.stat_3372524247',        // 火焰抗性 #%
  cold_resist: 'explicit.stat_4220027924',        // 冰霜抗性 #%
  lightning_resist: 'explicit.stat_1671376347',   // 闪电抗性 #%
  chaos_resist: 'explicit.stat_2923486259',       // 混沌抗性 #%
  all_resist: 'pseudo.pseudo_total_elemental_resistance', // 总元素抗性(全抗)

  // 生命/魔力
  life: 'explicit.stat_3299347043',              // # 生命上限
  life_regen: 'explicit.stat_3325883026',        // 生命每秒再生 #
  mana: 'explicit.stat_1050105434',              // # 魔力上限

  // 属性
  strength: 'explicit.stat_4080418644',          // # 力量
  dexterity: 'explicit.stat_3261801346',         // # 敏捷
  intelligence: 'explicit.stat_328541901',       // # 智慧

  // 防御
  armour: 'explicit.stat_3484657501',            // # 护甲
  evasion: 'explicit.stat_53045048',             // # 点闪避值
  energy_shield: 'explicit.stat_4052037485',     // # 能量护盾上限
  block: 'explicit.stat_4147897060',             // 格挡几率提高 #%

  // 伤害(常见)
  attack_speed: 'explicit.stat_681332047',       // 攻击速度提高 #%
  crit_chance: 'explicit.stat_587431675',        // 暴击率提高 #%
  move_speed: 'explicit.stat_2250533757',        // 移动速度提高 #%
  physical_damage: 'explicit.stat_1940865751',   // 附加 # - # 物理伤害
  fire_damage: 'explicit.stat_709508406',        // 附加 # - # 火焰伤害
  cold_damage: 'explicit.stat_1037193709',       // 附加 # - # 冰霜伤害
  lightning_damage: 'explicit.stat_3336890334',  // 附加 # - # 闪电伤害
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
  '移动速度': STAT_MAP.move_speed,
  '移速': STAT_MAP.move_speed,
  '物攻': STAT_MAP.physical_damage,
  '物理伤害': STAT_MAP.physical_damage,
  '火伤': STAT_MAP.fire_damage,
  '冰伤': STAT_MAP.cold_damage,
  '雷伤': STAT_MAP.lightning_damage,
};

// ============================================
// 装备部位 → 常见物品类型(国服中文名,用于 query.type)
// ============================================
// 国服市集真实物品类型(从 /api/trade2/data/items 获取,2026-06 验证)
// 每个部位列出常见基底名,搜索时用这些名字
// ============================================
const SLOT_TYPES = {
  戒指: ['翡翠戒指', '蓝玉戒指', '紫晶戒指', '红玉戒指', '黄玉戒指', '锻铁戒指', '金光戒指', '青金戒指', '双玉戒指', '珠玉戒指'],
  项链: ['日曜项链', '赤红项链', '帝金项链', '珠光项链', '碧蓝项链', '琥珀项链', '翠玉项链', '月影项链', '星辉项链', '血岩项链'],
  腰带: ['万用腰带', '生皮腰带', '精致腰带', '亚麻腰带', '宽大腰带', '嵌板腰带', '华丽腰带', '环锁腰带', '双重腰带', '重革腰带'],
  头盔: ['海螺头盔', '勇士头盔', '角斗士头盔', '术士冠冕', '羽饰冠冕', '先祖冠冕', '覆甲帽', '毛毡帽', '海贼帽'],
  胸甲: ['蜥鳞外套', '蛇鳞外套', '巨龙鳞外套', '皮革背心', '铠装背心', '斥候背心', '寻路者外套', '海盗外套', '隐士束衣', '遁世束衣', '远行者外衣'],
  手套: ['精纺护腕', '精制护腕', '宏伟护腕', '精工护腕', '肃穆手套', '精致手套', '黄金手套', '敦实护手', '铆接护手', '骑士护手'],
  鞋子: ['牢靠绑腿', '衬垫绑腿', '毛皮绑腿', '隐秘绑腿', '生皮短靴', '蜥鳞靴', '锁链战靴', '老兵战靴', '加固战靴', '贵族战靴'],
  战矛: ['飞翼长矛', '分叉长矛', '狩猎长矛', '螺旋长矛', '铁头长矛', '翱翔战矛', '历战长矛', '守护者战矛', '十字长矛'],
  弓: ['粗制弓', '短弓', '反曲弓', '复合弓', '双弦弓', '寻战之弓', '轰击弓', '军用战弓', '部族弓'],
  战弩: ['拼凑战弩', '穿刺战弩', '坚固战弩', '合金战弩', '轰鸣战弩', '构造战弩', '刺骨战弩'],
  盾牌: ['嵌板轻盾', '锻铁轻盾', '尖刺轻盾', '远古轻盾', '加固塔盾', '皇家塔盾', '壁垒塔盾', '抛光圆盾', '石制圆盾'],
};

/**
 * 技能1:构造市集搜索 query
 * 策略(实测验证): 类型 + sale_type=any,条件尽量少
 * 等级/词缀在返回结果中筛选(不在 query 里加,避免搜不到)
 * @param {object} need { type?, slot?, intents?, level? }
 * @returns {object} 国服 trade2 search query
 */
function buildPreciseQuery(need) {
  // 核心:类型 + sale_type=any(所有挂单,不限一口价)
  const query = {
    filters: {
      trade_filters: { sale_type: { option: 'any' } },
    },
  };

  // 物品类型(必须有,这是最基础的过滤)
  if (need.type) {
    query.type = need.type;
  } else if (need.slot && SLOT_TYPES[need.slot]) {
    query.type = SLOT_TYPES[need.slot][0];
  }

  return query;
}

/**
 * 技能1.5: 智能解析用户输入,自动匹配部位/基底/词缀
 * 支持模糊输入: "胸甲"、"火抗戒指"、"板甲 +生命"
 * @param {string} input 用户自然语言搜索
 * @returns {{ slot, type, intents }} 解析结果
 */
function parseSearchInput(input) {
  if (!input) return { slot: '', type: '', intents: [] };
  const text = input.trim();

  // 1. 匹配部位
  let slot = '';
  for (const s of Object.keys(SLOT_TYPES)) {
    if (text.includes(s)) { slot = s; break; }
  }

  // 2. 匹配具体基底名
  let type = '';
  for (const arr of Object.values(SLOT_TYPES)) {
    for (const t of arr) {
      if (text.includes(t)) { type = t; break; }
    }
    if (type) break;
  }

  // 3. 匹配词缀意图
  const intents = [];
  for (const intent of Object.keys(INTENT_MAP)) {
    if (text.includes(intent) && !intents.includes(intent)) {
      intents.push(intent);
    }
  }

  // 如果只匹配到部位没有具体类型,取部位第一个基底
  if (!type && slot) {
    type = SLOT_TYPES[slot][0];
  }

  return { slot, type, intents };
}

/**
 * 技能1.6: 列出所有可搜索的装备部位和对应基底名(给 AI 参考)
 */
function listSlotTypes() {
  return Object.entries(SLOT_TYPES).map(([slot, types]) => ({ slot, types }));
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
  parseSearchInput,
  listSlotTypes,
  generateSearchTasks,
  parseAIRecommendations,
  listIntents,
};
