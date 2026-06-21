// 知识库向量化:使用本地 embedding 模型(@xenova/transformers)
// 把文档批量转成向量,存本地 JSON(供 retriever 检索)
// 完全离线运行,无需 API,首次使用自动下载模型

const path = require('path');
const fs = require('fs');
const builder = require('./builder');
const localEmbedder = require('./local-embedder');

// 向量文件路径
function vectorsPath() {
  return path.join(builder.docsPath().replace('documents.json', ''), 'vectors.json');
}

/**
 * 把一批文本转成向量(使用本地模型)
 * @param {object} settings 完整设置
 * @param {string[]} texts 文本数组
 * @param {function} onProgress 进度回调
 * @returns {Promise<number[][]>} 向量数组
 */
async function embedBatch(settings, texts, onProgress) {
  const modelName = settings.localModelName || localEmbedder.DEFAULT_MODEL;
  const proxyUrl = settings.proxyUrl || '';
  return await localEmbedder.embedBatch(texts, modelName, onProgress, proxyUrl);
}

/**
 * 给单个文本生成向量(用于检索时把 query 向量化)
 */
async function embedQuery(settings, text) {
  const modelName = settings.localModelName || localEmbedder.DEFAULT_MODEL;
  const proxyUrl = settings.proxyUrl || '';
  return await localEmbedder.embedQuery(text, modelName, proxyUrl);
}

/**
 * 对全部文档建索引:批量 embedding + 存盘
 * 总进度映射:下载阶段 0-30%,加载 30-35%,向量化 35-100%(单调递增,不倒退)
 * @param {object} settings 配置
 * @param {function} onProgress (info) => void  info={stage,percent,detail}
 */
async function buildIndex(settings, onProgress) {
  const docs = builder.loadDocs();
  if (!docs.length) throw new Error('知识库为空,请先构建文档');

  const BATCH = 8; // 本地模型用较小批次(内存限制)
  const vectors = []; // [{id, type, title, vector}]
  const total = docs.length;
  let processed = 0; // 已向量化的文档数

  for (let i = 0; i < total; i += BATCH) {
    const batch = docs.slice(i, i + BATCH);
    const texts = batch.map((d) => `${d.title}\n${d.content}`);
    // 重试 3 次
    let vecs;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        vecs = await embedBatch(settings, texts, (info) => {
          if (!onProgress) return;
          // 下载阶段:映射到 0-30%
          if (info.stage === 'download') {
            const mapped = (info.percent || 0) * 0.3;
            onProgress({ stage: 'download', percent: mapped, detail: info.detail || '下载模型' });
          } else if (info.stage === 'load') {
            // 加载:30-35%
            onProgress({ stage: 'load', percent: 32 + (info.percent || 0) * 0.03, detail: info.detail || '加载模型' });
          } else if (info.stage === 'embed') {
            // 向量化:35-100%(基于总文档数,单调递增)
            const batchDone = info.done || 0;
            const overall = processed + batchDone;
            const embedRatio = total > 0 ? overall / total : 0;
            const percent = 35 + embedRatio * 65; // 35% 到 100%
            onProgress({ stage: 'embed', percent, detail: `向量化 ${overall}/${total}`, done: overall, total });
          }
        });
        break;
      } catch (e) {
        if (attempt === 2) throw e;
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    processed += batch.length;
    batch.forEach((d, j) => {
      vectors.push({ id: d.id, type: d.type, title: d.title, vector: vecs[j] });
    });
    // 每个 batch 完成后报一次总进度
    if (onProgress) {
      const embedRatio = total > 0 ? processed / total : 0;
      onProgress({ stage: 'embed', percent: 35 + embedRatio * 65, detail: `向量化 ${processed}/${total}`, done: processed, total });
    }
  }

  // 存盘(向量 + 维度信息)
  const dim = vectors[0]?.vector?.length || 0;
  const meta = {
    dim,
    count: vectors.length,
    model: settings.localModelName || localEmbedder.DEFAULT_MODEL,
    builtAt: new Date().toISOString(),
  };
  fs.writeFileSync(vectorsPath(), JSON.stringify({ ...meta, vectors }), 'utf8');
  return { dim, count: vectors.length };
}

/**
 * 加载已建好的向量
 */
function loadVectors() {
  try {
    return JSON.parse(fs.readFileSync(vectorsPath(), 'utf8'));
  } catch (e) {
    return null;
  }
}

function isIndexed() {
  return fs.existsSync(vectorsPath());
}

module.exports = { 
  buildIndex, 
  embedQuery, 
  loadVectors, 
  isIndexed, 
  vectorsPath, 
  localEmbedder,
};
