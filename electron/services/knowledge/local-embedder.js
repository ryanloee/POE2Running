// 本地 Embedding 模块:使用 @xenova/transformers 在本地运行 embedding 模型
// 代理由 main.js 的 global-agent 全局管理,此处不再单独处理

const path = require('path');
const fs = require('fs');

const MODELS = {
  'bge-small-zh': { id: 'Xenova/bge-small-zh-v1.5', dim: 512, desc: '中文小型模型 (~24MB)' },
  'bge-base-zh': { id: 'Xenova/bge-base-zh-v1.5', dim: 768, desc: '中文基础模型 (~400MB)' },
  'all-MiniLM': { id: 'Xenova/all-MiniLM-L6-v2', dim: 384, desc: '英文轻量模型 (~23MB)' },
};

const DEFAULT_MODEL = 'bge-small-zh';

let cachedPipeline = null;
let cachedModelName = null;
let MODEL_DIR = '';
let transformersModule = null;  // 缓存的 transformers 模块(只能 import 一次)

function setModelDir(dir) {
  MODEL_DIR = dir;
  fs.mkdirSync(dir, { recursive: true });
}

function getModelDir() { return MODEL_DIR; }

/**
 * 获取 transformers 模块(只 import 一次)
 */
async function getTransformers() {
  if (!transformersModule) {
    transformersModule = await import('@xenova/transformers');
  }
  return transformersModule;
}

/**
 * 获取或加载 embedding pipeline
 * @param {string} modelName 模型 key
 * @param {function} onProgress 标准化进度回调 (info) => void
 *   info = { stage: 'download'|'load'|'embed', percent: 0-100, detail: '...' }
 */
async function getPipeline(modelName, onProgress) {
  const key = modelName || DEFAULT_MODEL;

  // 模型已缓存且没换,直接用
  if (cachedPipeline && cachedModelName === key) return cachedPipeline;

  const modelInfo = MODELS[key] || MODELS[DEFAULT_MODEL];
  const cacheDir = MODEL_DIR || path.join(process.cwd(), '.models');
  fs.mkdirSync(cacheDir, { recursive: true });

  onProgress && onProgress({ stage: 'load', percent: 0, detail: `加载模型 ${key} (${modelInfo.desc})` });

  try {
    const { pipeline, env } = await getTransformers();
    env.allowRemoteModels = true;
    env.allowLocalModels = true;
    env.localModelPath = cacheDir;

    // 下载进度跟踪:transformers 会对每个文件多次回调
    // 用每个文件最大的 loaded/total 算百分比
    const fileProgress = {}; // {fileName: {loaded, total}}
    onProgress && onProgress({ stage: 'download', percent: 0, detail: '准备下载...' });

    cachedPipeline = await pipeline('feature-extraction', modelInfo.id, {
      cache_dir: cacheDir,
      local_files_only: false,
      quantized: true,
      progress_callback: (progress) => {
        if (!onProgress) return;
        // transformers 的 progress 对象:
        //   { status: 'initiate', name, file }           → 文件开始下载(无 loaded/total)
        //   { status: 'progress', file, loaded, total }  → 下载中(有进度)
        //   { status: 'done', file }                     → 文件下载完成(无 loaded/total)

        // initiate:通知用户正在下载哪个文件
        if (progress.status === 'initiate') {
          const name = progress.name || progress.file || '';
          onProgress({ stage: 'download', percent: 0, detail: `准备下载 ${name.split('/').pop() || name}` });
          return;
        }

        // progress:有 loaded/total,更新文件进度
        if (progress.status === 'progress' && progress.file && progress.total) {
          fileProgress[progress.file] = { loaded: progress.loaded || 0, total: progress.total };
        }

        // done:标记文件完成(loaded = total)
        if (progress.status === 'done' && progress.file) {
          if (fileProgress[progress.file]) {
            fileProgress[progress.file].loaded = fileProgress[progress.file].total;
          } else {
            // done 事件可能没有对应的 progress 事件(文件很小/缓存命中)
            fileProgress[progress.file] = { loaded: 1, total: 1 };
          }
        }

        // 算总进度:所有文件 loaded 之和 / total 之和
        let sumLoaded = 0;
        let sumTotal = 0;
        for (const f of Object.values(fileProgress)) {
          sumLoaded += f.loaded;
          sumTotal += f.total;
        }
        const percent = sumTotal > 0 ? Math.min(100, (sumLoaded / sumTotal) * 100) : 0;
        const fileName = progress.file ? progress.file.split('/').pop() : '';
        const stageDetail = progress.status === 'done'
          ? `${fileName} 下载完成`
          : fileName ? `下载 ${fileName}` : '下载中...';
        onProgress({
          stage: 'download',
          percent,
          detail: stageDetail,
        });
      },
    });

    cachedModelName = key;
    onProgress && onProgress({ stage: 'load', percent: 100, detail: `模型 ${key} 加载完成` });
    return cachedPipeline;
  } catch (e) {
    throw new Error(`加载模型失败: ${e.message}`);
  }
}

async function embedBatch(texts, modelName, onProgress) {
  const pipe = await getPipeline(modelName, onProgress);
  const vectors = [];
  for (let i = 0; i < texts.length; i++) {
    const percent = texts.length > 0 ? ((i + 1) / texts.length) * 100 : 0;
    onProgress && onProgress({ stage: 'embed', percent, detail: `向量化 ${i + 1}/${texts.length}`, done: i + 1, total: texts.length });
    const output = await pipe(texts[i], { pooling: 'mean', normalize: true });
    vectors.push(Array.from(output.data));
  }
  return vectors;
}

async function embedQuery(text, modelName) {
  return (await embedBatch([text], modelName, null))[0];
}

function isModelDownloaded(modelName) {
  const key = modelName || DEFAULT_MODEL;
  const modelInfo = MODELS[key] || MODELS[DEFAULT_MODEL];
  const cacheDir = MODEL_DIR || path.join(process.cwd(), '.models');
  const modelPath = path.join(cacheDir, modelInfo.id.replace('/', '--'), 'onnx', 'model_quantized.onnx');
  return fs.existsSync(modelPath) && fs.statSync(modelPath).size > 1000000;
}

function getAvailableModels() {
  return Object.entries(MODELS).map(([key, info]) => ({
    id: key, name: info.id, dim: info.dim, desc: info.desc,
    downloaded: isModelDownloaded(key),
  }));
}

/**
 * 切换模型时清缓存(强制重新加载)
 */
function switchModel() {
  cachedPipeline = null;
  cachedModelName = null;
}

module.exports = {
  embedBatch, embedQuery, getPipeline, isModelDownloaded,
  getAvailableModels, setModelDir, getModelDir, switchModel,
  MODELS, DEFAULT_MODEL,
};
