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
async function getPipeline(modelName, onProgress, proxyUrl) {
  const key = modelName || DEFAULT_MODEL;

  // 模型已缓存且没换,直接用
  if (cachedPipeline && cachedModelName === key) return cachedPipeline;

  const modelInfo = MODELS[key] || MODELS[DEFAULT_MODEL];
  const cacheDir = MODEL_DIR || path.join(process.cwd(), '.models');
  fs.mkdirSync(cacheDir, { recursive: true });

  // 先检查模型是否已下载,如果没有则用 model-downloader(支持国内镜像)
  const modelDir = path.join(cacheDir, modelInfo.id.replace('/', '--'));
  const modelFile = path.join(modelDir, 'onnx', 'model_quantized.onnx');
  if (!fs.existsSync(modelFile) || fs.statSync(modelFile).size < 1000000) {
    onProgress && onProgress({ stage: 'download', percent: 0, detail: `准备下载 ${key}...` });
    try {
      const downloader = require('./model-downloader');
      if (downloader.MODEL_FILES[key]) {
        // 用 model-downloader 走国内镜像下载
        // 不传 proxyUrl(global-agent 已全局代理)
        await downloader.downloadModel(key, cacheDir, null, (fileIndex, fileName, loaded, total) => {
          if (!onProgress) return;
          const percent = total > 0 ? Math.min(100, (loaded / total) * 100) : 0;
          onProgress({ stage: 'download', percent, detail: `下载 ${fileName}` });
        });
        onProgress && onProgress({ stage: 'download', percent: 100, detail: '下载完成' });
      }
    } catch (e) {
      console.error('[embed] 镜像下载失败,尝试直连:', e.message);
    }
  }

  try {
    const { pipeline, env } = await getTransformers();
    env.allowRemoteModels = true;
    env.allowLocalModels = true;
    env.localModelPath = cacheDir;
    onProgress && onProgress({ stage: 'load', percent: 0, detail: `加载模型 ${key}...` });

    cachedPipeline = await pipeline('feature-extraction', modelInfo.id, {
      cache_dir: cacheDir,
      local_files_only: false,
      quantized: true,
      progress_callback: (progress) => {
        if (!onProgress || progress.status !== 'progress') return;
        if (progress.file && progress.total) {
          const percent = Math.min(100, ((progress.loaded || 0) / progress.total) * 100);
          onProgress({ stage: 'download', percent, detail: `下载 ${progress.file.split('/').pop()}` });
        }
      },
    });

    cachedModelName = key;
    onProgress && onProgress({ stage: 'load', percent: 100, detail: `模型 ${key} 加载完成` });
    return cachedPipeline;
  } catch (e) {
    throw new Error(`加载模型失败: ${e.message}`);
  }
}

async function embedBatch(texts, modelName, onProgress, proxyUrl) {
  const pipe = await getPipeline(modelName, onProgress, proxyUrl);
  const vectors = [];
  for (let i = 0; i < texts.length; i++) {
    // 进度只报 batch 内的位置(done/total),percent 由上层 indexer 按总数换算
    // 这样避免 batch 内 0-100 反复循环的假象
    onProgress && onProgress({ stage: 'embed', done: i + 1, total: texts.length, batchPercent: texts.length > 0 ? ((i + 1) / texts.length) * 100 : 0 });
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
