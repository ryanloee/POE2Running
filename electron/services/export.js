// 导出/模板层:生成 BD 文本报告 + 三种场景的 AI prompt 模板
// 这是双模式的纽带:
//   - 自动模式:buildXxxPrompt() → ai.chatStream()
//   - 导出模式:exportBDText() 生成纯文本,用户复制去网页版 AI

// 把结构化 BD 压成精简可读文本(给 AI 看或导出)
function bdToText(bd) {
  const role = bd.role || {};
  const panel = bd.panel || {};
  const eqList = (bd.equipments || []).map((e) => {
    const mods = [...(e.explicitMods || []), ...(e.implicitMods || []), ...(e.runeMods || [])];
    const socketed = (e.socketedItems || []).map((s) => s.typeLine).join(',');
    return `- [${e.slotName}] ${e.name ? e.name + ' ' : ''}${e.typeLine} (${e.rarity}, iLvl${e.ilvl})${socketed ? ' [镶:' + socketed + ']' : ''}\n  词条: ${mods.join(' | ')}`;
  });
  // 完整技能组(主技能 + 辅助宝石),给 AI 更全面的技能信息
  const skillGroups = (bd.skillGroups || []).map((g) => {
    const sup = g.supportGems.length ? ' +辅[' + g.supportGems.map((s) => s.name).join(',') + ']' : '';
    return g.name + sup;
  }).join(' | ');

  return `角色: ${role.name || '-'} | 职业: ${role.class_name || '-'} | 等级: ${role.level || '-'} | 进度: ${role.phrase || '-'}
面板: 生命${panel.life || '-'} 魔力${panel.mana || '-'} 精魂${panel.spirit || '-'} 护甲${panel.armour || '-'} 闪避${panel.evasion_rating || '-'} 格挡${panel.block_chance || '-'}%
抗性: 火${panel.fire_resistance || '-'}% 冰${panel.cold_resistance || '-'}% 雷${panel.lightning_resistance || '-'}% 混沌${panel.chaos_resistance || '-'}%
完整技能组(主技能+辅助宝石): ${skillGroups}
评分: 综合${bd.dimension?.score || '-'} 生存${bd.dimension?.survival || '-'} 宝藏${bd.dimension?.treasure || '-'} 清图${bd.dimension?.clear || '-'} 战胜${bd.dimension?.beat || '-'}
装备:
${eqList.join('\n')}`;
}

// === 三种场景的 prompt 模板 ===

// 场景1:单角色 AI 配装建议
function buildSinglePrompt(bd, question) {
  const q = question || '请分析这个 BD 的优缺点,重点说明:抗性怎么补满、装备该换什么、伤害和生存如何提升。给出具体可执行的建议。';
  return `你是流放之路2(POE2)资深配装顾问。以下是玩家当前角色的完整 BD 数据:

${bdToText(bd)}

玩家的问题:${q}

请给出专业、具体、可执行的建议。优先解决最致命的短板(如抗性负值)。用 Markdown 输出,条理清晰。`;
}

// 场景2:两个分享码对比
function buildComparePrompt(bdA, bdB) {
  return `你是流放之路2(POE2)资深配装顾问。请对比下面两份 BD,输出一个 Markdown 表格逐条对比,并在表格后给出建议。

【BD A】
${bdToText(bdA)}

【BD B】
${bdToText(bdB)}

请输出:
1. Markdown 表格,列:对比要素 | BD A | BD B | 差异说明。要素至少含:抗性(火/冰/雷/混沌)、生命、护甲/闪避、核心技能DPS、武器关键词条、防具关键词条。
2. 表格后用"### 建议"总结哪个 BD 更强、另一个可以借鉴什么。`;
}

// 场景3:角色 vs 文档对比
function buildDocComparePrompt(bd, docText) {
  return `你是流放之路2(POE2)资深配装顾问。请对比玩家当前角色 BD 与目标配装文档,逐条对比找差距。

【玩家当前角色】
${bdToText(bd)}

【目标 BD 文档(玩家想达到的配装方案)】
${docText}

请输出:
1. Markdown 表格,列:对比要素 | 目标BD要求 | 玩家现状 | 是否达标(✅/⚠️/❌) | 建议。要素至少含:抗性、生命、护甲/闪避、核心输出技能、武器关键词条、防具关键词条、核心宝石、天赋方向。
2. 表格后用"### 最优先升级建议"列出 3-5 条具体可执行建议。
只输出 Markdown。`;
}

// 导出完整文本报告(无 Key 模式,用户复制去网页 AI)
function exportFullReport(bd) {
  const role = bd.role || {};
  const panel = bd.panel || {};
  const lines = [];
  lines.push('========================================');
  lines.push(`POE2 BD 数据报告  (${new Date().toLocaleString('zh-CN')})`);
  lines.push('========================================');
  lines.push('');
  lines.push('## 角色信息');
  lines.push(`角色名: ${role.name}`);
  lines.push(`职业: ${role.class_name}  等级: ${role.level}  进度: ${role.phrase}`);
  lines.push(`本赛季时长: ${(parseInt(role.season_game_duration || 0) / 3600).toFixed(1)} 小时`);
  lines.push('');
  lines.push('## 面板属性');
  lines.push(`生命: ${panel.life}  魔力: ${panel.mana}  精魂: ${panel.spirit}  能量护盾: ${panel.energy_shield}`);
  lines.push(`护甲: ${panel.armour}  闪避值: ${panel.evasion_rating}  格挡率: ${panel.block_chance}%  移速: ${panel.movement_velocity || '-'}%`);
  lines.push(`抗性: 火 ${panel.fire_resistance}%  冰 ${panel.cold_resistance}%  雷 ${panel.lightning_resistance}%  混沌 ${panel.chaos_resistance}%`);
  lines.push('');
  if (bd.skillGroups?.length) {
    lines.push('## 完整技能组(主技能 + 辅助宝石)');
    bd.skillGroups.forEach((g, i) => {
      const sup = g.supportGems.length ? ' + 辅助: ' + g.supportGems.map((s) => s.name).join(', ') : '';
      lines.push(`${i + 1}. ${g.isSupport ? '[辅助]' : '[主动]'} ${g.name}${sup}`);
    });
    lines.push('');
  }
  if (bd.dimension) {
    lines.push('## 维度评分');
    lines.push(`综合 ${bd.dimension.score} | 生存 ${bd.dimension.survival} | 宝藏 ${bd.dimension.treasure} | 清图 ${bd.dimension.clear} | 战胜 ${bd.dimension.beat}`);
    lines.push('');
  }
  if (bd.equipments?.length) {
    lines.push('## 装备详细词条');
    for (const e of bd.equipments) {
      lines.push('');
      lines.push(`--- [${e.slotName}] ${e.name ? e.name + ' ' : ''}${e.typeLine} (${e.rarity}/iLvl${e.ilvl})${e.corrupted ? ' [已腐化]' : ''}`);
      if (e.grantedSkills?.length) { lines.push('赋予技能: ' + e.grantedSkills.join(', ')); }
      if (e.implicitMods?.length) { lines.push('[隐式]'); e.implicitMods.forEach((m) => lines.push('  - ' + m)); }
      if (e.explicitMods?.length) { lines.push('[显式]'); e.explicitMods.forEach((m) => lines.push('  - ' + m)); }
      if (e.runeMods?.length) { lines.push('[符文]'); e.runeMods.forEach((m) => lines.push('  - ' + m)); }
      if (e.utilityMods?.length) { lines.push('[咒符]'); e.utilityMods.forEach((m) => lines.push('  - ' + m)); }
      if (e.socketedItems?.length) {
        lines.push('[镶嵌物]');
        for (const si of e.socketedItems) {
          lines.push('  * ' + (si.name ? si.name + ' ' : '') + si.typeLine);
          si.explicitMods.forEach((m) => lines.push('      - ' + m));
        }
      }
    }
    lines.push('');
  }
  lines.push('========================================');
  return lines.join('\n');
}

module.exports = { bdToText, buildSinglePrompt, buildComparePrompt, buildDocComparePrompt, exportFullReport };
