// POE2 国服助手数据层(Electron 主进程,纯 Node fetch,无 CORS 限制)
// 接口与字段逻辑迁移自 D:\codex\流放之路\fetch_my_bd.ps1

const BASE = 'https://www.wegame.com.cn/api/v1/wegame.pallas.poe2.Profile';

// 装备槽位中文名映射
const SLOT_NAME = {
  Weapon: '主武器',
  Weapon2: '武器组2-武器',
  Offhand: '主副手',
  Offhand2: '武器组2-副手',
  Helm: '头盔',
  BodyArmour: '胸甲',
  Gloves: '手套',
  Boots: '鞋子',
  Belt: '腰带',
  Amulet: '项链',
  Ring: '戒指1',
  Ring2: '戒指2',
  Flask: '药剂/咒符',
};
const SLOT_ORDER = ['Weapon2', 'Weapon', 'Offhand2', 'Offhand', 'Helm', 'BodyArmour', 'Gloves', 'Boots', 'Belt', 'Amulet', 'Ring', 'Ring2', 'Flask'];

/**
 * 调用单个 WeGame 接口(Node fetch,主进程无 CORS)
 */
async function fetchApi(path, shareCode) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Referer': 'https://www.wegame.com.cn/helper/poe2/',
      'User-Agent': 'Mozilla/5.0',
    },
    body: JSON.stringify({ share_code: shareCode, from_src: 'poe2_helper' }),
  });
  if (!res.ok) {
    throw new Error(`接口 ${path} HTTP ${res.status}`);
  }
  const result = await res.json();
  if (!result || !result.result || result.result.error_code !== 0) {
    throw new Error(`接口 ${path} 返回错误: ${result ? JSON.stringify(result.result) : '空响应'}`);
  }
  return result;
}

/**
 * 抓取某分享码的完整 BD 数据(并行调 7 接口 + 装备解析)
 * Electron 主进程是 Node,fetch 不受 CORS 限制,可直接调用
 */
async function fetchAll(shareCode) {
  const [info, panel, equips, currency, dimension, summary, skills] = await Promise.all([
    fetchApi('GetRoleInfo', shareCode).catch((e) => { logErr('GetRoleInfo', e); return null; }),
    fetchApi('GetPanelAttr', shareCode).catch((e) => { logErr('GetPanelAttr', e); return null; }),
    fetchApi('GetEquipments', shareCode).catch((e) => { logErr('GetEquipments', e); return null; }),
    fetchApi('GetSeasonCurrencySummary', shareCode).catch((e) => { logErr('GetSeasonCurrencySummary', e); return null; }),
    fetchApi('GetDimensionEvaluation', shareCode).catch((e) => { logErr('GetDimensionEvaluation', e); return null; }),
    fetchApi('GetRoleSummary', shareCode).catch((e) => { logErr('GetRoleSummary', e); return null; }),
    fetchApi('GetSkills', shareCode).catch((e) => { logErr('GetSkills', e); return null; }),
  ]);

  if (!info) {
    throw new Error('无法获取角色信息,请检查分享码是否正确');
  }

  return {
    role: info.role,
    panel: panel || null,
    currency: currency || null,
    dimension: dimension || null,
    summary: summary || null,
    equipments: groupEquipments(equips ? equips.equipments : []),
    // 完整技能组(主技能 + 辅助宝石),来自 GetSkills
    skillGroups: parseSkillGroups(skills ? skills.skills : []),
  };
}

/**
 * 解析完整技能组(每个技能组 = 1个主技能宝石 + N个辅助宝石)
 */
function parseSkillGroups(skills) {
  if (!Array.isArray(skills)) return [];
  return skills.map((g) => ({
    name: g.name ? `${g.name} ${g.typeLine}` : g.typeLine,
    isSupport: !!g.support,
    secDescr: g.secDescrText || '',
    // 辅助宝石(镶嵌在同一组的)
    supportGems: (g.socketedItems || []).map((si) => ({
      name: si.name ? `${si.name} ${si.typeLine}` : si.typeLine,
    })),
  }));
}

/**
 * 装备按槽位分组并排序
 */
function groupEquipments(equipments) {
  const grouped = {};
  for (const e of equipments) {
    if (!grouped[e.inventoryId]) grouped[e.inventoryId] = [];
    grouped[e.inventoryId].push(normalizeEquip(e));
  }
  const result = [];
  for (const slot of SLOT_ORDER) {
    if (!grouped[slot]) continue;
    grouped[slot].forEach((eq, i) => {
      result.push({
        slot,
        slotName: grouped[slot].length > 1 ? `${SLOT_NAME[slot]} #${i + 1}` : SLOT_NAME[slot],
        ...eq,
      });
    });
  }
  return result;
}

/**
 * 提取单件装备关键信息
 */
function normalizeEquip(e) {
  return {
    name: e.name,
    typeLine: e.typeLine,
    baseType: e.baseType,
    rarity: e.rarity,
    ilvl: e.ilvl,
    corrupted: !!e.corrupted,
    grantedSkills: (e.grantedSkills || []).map((g) => {
      const v = (g.values || []).map((arr) => (Array.isArray(arr) ? arr[0] : arr));
      return v.join('/');
    }),
    implicitMods: e.implicitMods || [],
    explicitMods: e.explicitMods || [],
    runeMods: e.runeMods || [],
    enchantMods: e.enchantMods || [],
    utilityMods: e.utilityMods || [],
    socketedItems: (e.socketedItems || []).map((si) => ({
      name: si.name,
      typeLine: si.typeLine,
      explicitMods: si.explicitMods || [],
      bondedMods: si.bondedMods || [],
    })),
  };
}

function logErr(api, e) {
  console.error(`[poe2] ${api} 失败: ${e.message}`);
}

module.exports = { fetchAll, fetchApi, groupEquipments, parseSkillGroups, normalizeEquip, SLOT_NAME, SLOT_ORDER };
