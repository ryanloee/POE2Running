// PoB2 Lua 数据解析器
// PoB2 数据是标准 Lua table,用 luaparse 解析成 AST 再转 JS 对象
// 注意:luaparse 在某些文件里把 StringLiteral.value 解析成 null,真实值在 raw 字段,
// 所以这里统一从 raw 提取字符串

const parser = require('luaparse');

/**
 * 把 Lua 文件解析成 JS 对象
 * 支持:
 *   1. return { ["key"] = {...}, ... }
 *   2. tableName["key"] = {...}  (IndexExpression 赋值)
 *   3. tableName.key = ...        (MemberExpression 赋值)
 */
function parseLua(lua) {
  const ast = parser.parse(lua, { comments: false, locations: false, luaVersion: '5.1' });
  const result = {};

  for (const stmt of ast.body) {
    if (stmt.type === 'ReturnStatement' && stmt.arguments[0]?.type === 'TableConstructorExpression') {
      // 格式1:return { ... }
      Object.assign(result, tableToObject(stmt.arguments[0]));
    } else if (stmt.type === 'AssignmentStatement') {
      const left = stmt.variables[0];
      const right = stmt.init[0];
      if (right?.type !== 'TableConstructorExpression') continue;
      // 格式2:tableName["key"] = {...}
      if (left?.type === 'IndexExpression') {
        const key = nodeToValue(left.index);
        if (key) result[key] = tableToObject(right);
      }
      // 格式3:tableName.key = {...}(极少,跳过整体赋值)
    }
  }
  return result;
}

/**
 * TableConstructorExpression → JS 对象/数组
 */
function tableToObject(tableNode) {
  const fields = tableNode.fields;
  const obj = {};
  const arr = [];
  let hasNamedKey = false;

  for (const f of fields) {
    if (f.type === 'TableKeyString' || f.type === 'TableKey') {
      let k;
      if (f.key.type === 'Identifier') k = f.key.name;
      else k = nodeToValue(f.key);
      obj[k] = nodeToValue(f.value);
      hasNamedKey = true;
    } else if (f.type === 'TableValue' || f.type === 'TableValueExpression') {
      // 裸值(数组元素)——luaparse 5.x 用 TableValue,旧版用 TableValueExpression
      arr.push(nodeToValue(f.value));
    }
  }
  if (!hasNamedKey && arr.length) return arr;
  if (arr.length) obj._array = arr;
  return obj;
}

/**
 * 任意 AST 节点 → JS 值(关键:字符串从 raw 提取)
 */
function nodeToValue(node) {
  if (!node) return null;
  switch (node.type) {
    case 'StringLiteral':
      // value 可能是 null,从 raw 提取(去掉首尾引号,转义处理)
      if (node.raw) return unquoteRaw(node.raw);
      return node.value;
    case 'NumericLiteral':
      return Number(node.raw !== undefined ? node.raw : node.value);
    case 'BooleanLiteral':
      return node.value;
    case 'NilLiteral':
      return null;
    case 'TableConstructorExpression':
      return tableToObject(node);
    case 'UnaryExpression':
      const v = nodeToValue(node.argument);
      return node.operator === '-' ? -v : v;
    case 'IndexExpression':
    case 'MemberExpression':
      // SkillType.Attack 这种枚举,返回标识符名字
      if (node.identifier) return node.identifier.name;
      if (node.index) return nodeToValue(node.index);
      return null;
    case 'Identifier':
      return node.name;
    default:
      return null;
  }
}

/**
 * 从 raw 字符串提取真实值
 * raw 形如 "Alchemist's Boon" 或 'key123' 或 [[多行]]
 */
function unquoteRaw(raw) {
  if (raw.startsWith('[[') && raw.endsWith(']]')) {
    return raw.slice(2, -2);
  }
  if (raw.startsWith('[=[') && raw.endsWith(']=]')) {
    return raw.slice(3, -3);
  }
  // 单双引号
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    let s = raw.slice(1, -1);
    // 处理转义
    s = s.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    return s;
  }
  return raw;
}

// ============================================
// 业务解析:原始 Lua 对象 → 知识库文档
// ============================================

function parseSkills(luaObj) {
  const docs = [];
  for (const [id, skill] of Object.entries(luaObj)) {
    if (!skill || typeof skill !== 'object' || Array.isArray(skill)) continue;
    const title = skill.name || id;
    const parts = [`技能: ${title}`];
    if (skill.baseTypeName) parts.push(`宝石: ${skill.baseTypeName}`);
    if (skill.description) parts.push(`效果: ${skill.description}`);
    if (skill.color !== undefined && skill.color !== null) {
      parts.push(`类型: ${['', '力量', '敏捷', '智慧'][skill.color] || '其他'}`);
    }
    // skillTypes 可能是对象 {Attack:true} 或数组
    const st = skill.skillTypes;
    if (st) {
      let labels = [];
      if (Array.isArray(st)) labels = st;
      else if (typeof st === 'object') labels = Object.keys(st);
      if (labels.length) parts.push(`技能标签: ${labels.join(', ')}`);
    }
    // 辅助宝石
    if (skill.support || (JSON.stringify(skill).includes('"Support"'))) {
      parts.push('(辅助宝石)');
    }
    if (skill.castTime) parts.push(`施法时间: ${skill.castTime}`);
    docs.push({ id, type: 'skill', title, content: parts.join('\n') });
  }
  return docs;
}

function parseMods(luaObj, source) {
  const groups = {};
  for (const [id, mod] of Object.entries(luaObj)) {
    if (!mod || typeof mod !== 'object' || Array.isArray(mod)) continue;
    const grp = mod.group || '其他';
    if (!groups[grp]) groups[grp] = { group: grp, type: source, entries: [] };
    // 词缀数值:在 _array 里的非 affix 字符串
    let statText = '';
    if (mod._array) {
      statText = mod._array.filter((s) => typeof s === 'string' && s !== mod.affix && !['Prefix', 'Suffix'].includes(s)).join('; ');
    }
    groups[grp].entries.push({
      id,
      affix: mod.affix,
      type: mod.type,
      stat: statText,
      level: mod.level,
    });
  }

  const docs = [];
  for (const grp of Object.values(groups)) {
    const tiers = grp.entries
      .filter((e) => e.affix)
      .sort((a, b) => (a.level || 0) - (b.level || 0))
      .map((e) => `${e.affix} [${e.type}, Lv${e.level}]: ${e.stat}`);
    if (!tiers.length) continue;
    docs.push({
      id: `mod_${grp.group}`,
      type: 'mod',
      title: `词缀组: ${grp.group} (${grp.type})`,
      content: `词缀组 ${grp.group} 的各等级数值:\n${tiers.join('\n')}`,
    });
  }
  return docs;
}

function parseBases(luaObj, slot) {
  const docs = [];
  for (const [id, base] of Object.entries(luaObj)) {
    if (!base || typeof base !== 'object' || Array.isArray(base)) continue;
    const title = base.name || id;
    const parts = [`装备基底: ${title}`];
    if (slot) parts.push(`部位: ${slot}`);
    if (base._array) {
      const info = base._array.filter((s) => typeof s === 'string').join(', ');
      if (info) parts.push(`属性: ${info}`);
    }
    docs.push({ id, type: 'base', title, content: parts.join('\n') });
  }
  return docs;
}

module.exports = { parseLua, parseSkills, parseMods, parseBases };
