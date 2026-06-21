// 知识库构建器:整合「下载 PoB2 数据 → 解析 → 生成文档」,持久化为 JSON
// 这是第二步向量化(indexer)的数据来源

const path = require('path');
const fs = require('fs');
const fetcher = require('./fetcher');
const { parseLua, parseSkills, parseMods, parseBases } = require('./parser');

/**
 * 知识库目录(由 main.js 传入 app.getPath('userData'))
 */
let KB_DIR = '';

function setKbDir(dir) {
  KB_DIR = dir;
  fs.mkdirSync(path.join(KB_DIR), { recursive: true });
}

function docsPath() {
  return path.join(KB_DIR, 'documents.json');
}
function metaPath() {
  return path.join(KB_DIR, 'meta.json');
}

/**
 * 构建完整知识库:下载所有 PoB2 数据文件,解析成文档,存 JSON
 * @param {function} onProgress (stage, detail) => void  进度回调
 * @returns {Promise<{docCount, categories}>}
 */
async function build(onProgress) {
  if (!KB_DIR) throw new Error('未设置知识库目录');

  // 1. 下载
  onProgress && onProgress('download', '正在下载 PoB2 数据文件...');
  const raw = await fetcher.fetchAll((done, total, file) => {
    onProgress && onProgress('download', `下载 ${done}/${total}: ${file}`);
  });

  // 2. 解析各类数据
  onProgress && onProgress('parse', '正在解析数据...');
  const allDocs = [];
  const categories = {};

  // 技能
  for (const [file, lua] of Object.entries(raw.skills)) {
    if (!lua) continue;
    const obj = parseLua(lua);
    const docs = parseSkills(obj);
    allDocs.push(...docs);
    categories.skill = (categories.skill || 0) + docs.length;
  }
  onProgress && onProgress('parse', `技能解析完成: ${categories.skill || 0} 条`);

  // 词缀
  for (const [file, lua] of Object.entries(raw.mods)) {
    if (!lua) continue;
    const obj = parseLua(lua);
    const source = file.replace(/^Mod|\.lua$/g, '').toLowerCase();
    const docs = parseMods(obj, source);
    allDocs.push(...docs);
    categories.mod = (categories.mod || 0) + docs.length;
  }
  onProgress && onProgress('parse', `词缀解析完成: ${categories.mod || 0} 条`);

  // 装备基底
  for (const [file, lua] of Object.entries(raw.bases)) {
    if (!lua) continue;
    const obj = parseLua(lua);
    const slot = file.replace(/^Bases\/|\.lua$/g, '');
    const docs = parseBases(obj, slot);
    allDocs.push(...docs);
    categories.base = (categories.base || 0) + docs.length;
  }
  onProgress && onProgress('parse', `装备基底解析完成: ${categories.base || 0} 条`);

  // 3. 存盘
  onProgress && onProgress('save', '正在保存文档...');
  fs.writeFileSync(docsPath(), JSON.stringify(allDocs), 'utf8');
  const meta = {
    builtAt: new Date().toISOString(),
    docCount: allDocs.length,
    categories,
  };
  fs.writeFileSync(metaPath(), JSON.stringify(meta, null, 2), 'utf8');

  onProgress && onProgress('done', `知识库构建完成,共 ${allDocs.length} 条文档`);
  return meta;
}

/**
 * 读取已构建的文档(供 indexer/retriever 用)
 */
function loadDocs() {
  try {
    return JSON.parse(fs.readFileSync(docsPath(), 'utf8'));
  } catch (e) {
    return [];
  }
}

/**
 * 读取构建信息
 */
function loadMeta() {
  try {
    return JSON.parse(fs.readFileSync(metaPath(), 'utf8'));
  } catch (e) {
    return null;
  }
}

/**
 * 知识库是否已构建
 */
function isBuilt() {
  return fs.existsSync(docsPath());
}

module.exports = { setKbDir, build, loadDocs, loadMeta, isBuilt, docsPath, metaPath };
