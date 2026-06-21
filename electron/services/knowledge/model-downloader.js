// 模型下载器：支持代理、进度显示、断点续传
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// 模型文件列表
const MODEL_FILES = {
  'bge-small-zh': {
    id: 'Xenova/bge-small-zh-v1.5',
    files: [
      { name: 'config.json', path: 'config.json' },
      { name: 'tokenizer.json', path: 'tokenizer.json' },
      { name: 'tokenizer_config.json', path: 'tokenizer_config.json' },
      { name: 'vocab.txt', path: 'vocab.txt' },
      { name: 'model_quantized.onnx', path: 'onnx/model_quantized.onnx' },
    ]
  }
};

// 镜像源
const MIRRORS = [
  'https://hf-mirror.com',
  'https://huggingface.co',
];

/**
 * 下载单个文件
 * @param {string} url 下载地址
 * @param {string} outputPath 输出路径
 * @param {string} proxyUrl 代理地址
 * @param {function} onProgress 进度回调 (loaded, total, speed)
 * @returns {Promise<void>}
 */
function downloadFile(url, outputPath, proxyUrl, onProgress) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 检查文件是否已存在
    if (fs.existsSync(outputPath)) {
      const stat = fs.statSync(outputPath);
      if (stat.size > 0) {
        onProgress && onProgress(stat.size, stat.size, 0);
        resolve();
        return;
      }
    }

    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    
    // 配置请求选项
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
    };

    // 如果有代理，使用代理
    if (proxyUrl) {
      const proxyObj = new URL(proxyUrl);
      options.hostname = proxyObj.hostname;
      options.port = proxyObj.port;
      options.path = url;
      options.headers['Host'] = urlObj.hostname;
    }

    const client = isHttps ? https : http;
    
    const req = client.get(proxyUrl ? options : url, (res) => {
      // 处理重定向
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirectUrl = res.headers.location;
        downloadFile(redirectUrl, outputPath, proxyUrl, onProgress).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      const total = parseInt(res.headers['content-length'] || '0');
      let loaded = 0;
      let lastTime = Date.now();
      let lastLoaded = 0;

      const fileStream = fs.createWriteStream(outputPath);
      
      res.on('data', (chunk) => {
        loaded += chunk.length;
        fileStream.write(chunk);
        
        // 计算速度
        const now = Date.now();
        const timeDiff = (now - lastTime) / 1000;
        if (timeDiff >= 0.5) {
          const speed = (loaded - lastLoaded) / timeDiff;
          onProgress && onProgress(loaded, total, speed);
          lastTime = now;
          lastLoaded = loaded;
        }
      });

      res.on('end', () => {
        fileStream.end();
        onProgress && onProgress(loaded, total, 0);
        resolve();
      });

      res.on('error', (err) => {
        fileStream.end();
        reject(err);
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('连接超时'));
    });
  });
}

/**
 * 下载模型
 * @param {string} modelName 模型名
 * @param {string} cacheDir 缓存目录
 * @param {string} proxyUrl 代理地址
 * @param {function} onProgress 进度回调 (fileIndex, fileName, loaded, total, speed)
 * @returns {Promise<void>}
 */
async function downloadModel(modelName, cacheDir, proxyUrl, onProgress) {
  const modelInfo = MODEL_FILES[modelName];
  if (!modelInfo) throw new Error(`未知模型: ${modelName}`);

  const modelDir = path.join(cacheDir, modelInfo.id.replace('/', '--'));
  
  for (let i = 0; i < modelInfo.files.length; i++) {
    const file = modelInfo.files[i];
    const outputPath = path.join(modelDir, file.path);
    
    // 跳过已下载的文件
    if (fs.existsSync(outputPath)) {
      const stat = fs.statSync(outputPath);
      if (stat.size > 0) {
        onProgress && onProgress(i, file.name, stat.size, stat.size, 0);
        continue;
      }
    }

    // 尝试每个镜像源
    let downloaded = false;
    for (const mirror of MIRRORS) {
      const url = `${mirror}/${modelInfo.id}/resolve/main/${file.path}`;
      
      try {
        await downloadFile(url, outputPath, proxyUrl, (loaded, total, speed) => {
          onProgress && onProgress(i, file.name, loaded, total, speed);
        });
        downloaded = true;
        break;
      } catch (e) {
        // 尝试下一个镜像
        continue;
      }
    }

    if (!downloaded) {
      throw new Error(`下载失败: ${file.name}，所有源都不可用`);
    }
  }
}

module.exports = { downloadModel, downloadFile, MODEL_FILES };
