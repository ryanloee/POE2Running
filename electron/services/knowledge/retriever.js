// 知识库检索:向量检索(用本地 embedding 把 query 向量化,与库中向量算余弦相似度)
// 复用 indexer 的 loadVectors 和 local-embedder 的 embedQuery

const builder = require('./builder');
const indexer = require('./indexer');

/**
 * 检索最相关的 K 条文档
 * @param {object} settings 配置(含 localModelName/proxyUrl,用于 embedQuery)
 * @param {string} query 查询文本
 * @param {number} topK 返回条数,默认 5
 * @returns {Promise<Array<{title, content, score, type, id}>>}
 */
async function retrieve(settings, query, topK = 5) {
  const store = indexer.loadVectors();
  if (!store || !store.vectors || !store.vectors.length) {
    return []; // 未建索引,返回空(调用方降级为不带知识库)
  }

  // 1. query 向量化(用本地 embedding 模型)
  const queryVec = await indexer.embedQuery(settings, query);

  // 2. 算余弦相似度,排序
  const scored = store.vectors.map((v) => ({
    title: v.title,
    type: v.type,
    id: v.id,
    score: cosine(queryVec, v.vector),
  }));
  scored.sort((a, b) => b.score - a.score);

  // 3. 取 TopK,从 documents.json 取完整 content
  const docs = builder.loadDocs();
  const docMap = {};
  for (const d of docs) docMap[`${d.type}_${d.id}`] = d;

  const top = scored.slice(0, topK);
  return top
    .map((s) => {
      const doc = docMap[`${s.type}_${s.id}`];
      if (!doc) return null;
      return { title: doc.title, content: doc.content, score: s.score, type: s.type, id: s.id };
    })
    .filter(Boolean);
}

/**
 * 余弦相似度
 */
function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

module.exports = { retrieve, cosine };
