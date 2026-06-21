// 预加载脚本:通过 contextBridge 安全地把主进程能力暴露给渲染进程
// 渲染进程通过 window.api.xxx() 调用,无需直接访问 Node/Electron
const { contextBridge, ipcRenderer } = require('electron');

// Vue 3 的响应式对象是 Proxy,IPC 结构化克隆算法(Structured Clone)无法克隆 Proxy
// 统一深拷贝成纯对象,避免 "an object could not be cloned" 错误
const plain = (x) => {
  if (x === null || x === undefined) return x;
  if (typeof x !== 'object') return x;
  try {
    // JSON.stringify 能穿透 Vue Proxy 读取原始数据,再 parse 回纯对象
    return JSON.parse(JSON.stringify(x));
  } catch (e) {
    console.error('[preload] plain() 序列化失败,尝试逐字段提取:', e);
    // 兜底:逐个属性提取(处理含 BigInt / 循环引用等边缘情况)
    if (Array.isArray(x)) return x.map((v) => plain(v));
    const out = {};
    for (const key of Object.keys(x)) {
      try { out[key] = JSON.parse(JSON.stringify(x[key])); } catch (_) { /* 跳过不可序列化字段 */ }
    }
    return out;
  }
};

contextBridge.exposeInMainWorld('api', {
  // 抓取 BD
  fetchBD: (shareCode) => ipcRenderer.invoke('poe2:fetch', shareCode),

  // 文件选择对话框
  openFile: () => ipcRenderer.invoke('dialog:openFile'),

  // 解析文档
  parseDoc: (filePath) => ipcRenderer.invoke('doc:parse', filePath),

  // 设置读写
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', plain(settings)),

  // AI 分析(流式)—— onAiChunk 注册流式回调,analyzeAI 触发分析
  // chunk 格式: { type: 'content'|'thinking', text: string }
  analyzeAI: (payload) => ipcRenderer.invoke('ai:analyze', plain(payload)),
  onAiChunk: (callback) => {
    const handler = (_e, chunk) => callback(chunk);
    ipcRenderer.on('ai:chunk', handler);
    return () => ipcRenderer.removeListener('ai:chunk', handler);
  },

  // AI 连接测试(发"你好"验证链路)
  testAI: (settings) => ipcRenderer.invoke('ai:test', plain(settings)),

  // 知识库
  kbStatus: () => ipcRenderer.invoke('knowledge:status'),
  kbBuildDocs: () => ipcRenderer.invoke('knowledge:buildDocs'),
  kbBuildIndex: () => ipcRenderer.invoke('knowledge:buildIndex'),
  kbDownloadModel: () => ipcRenderer.invoke('knowledge:downloadModel'),
  kbTestRetrieve: (query) => ipcRenderer.invoke('knowledge:testRetrieve', query),
  kbGetLocalModels: () => ipcRenderer.invoke('knowledge:getLocalModels'),
  onKbProgress: (callback) => {
    const handler = (_e, p) => callback(p);
    ipcRenderer.on('kb:progress', handler);
    return () => ipcRenderer.removeListener('kb:progress', handler);
  },

  // 导出报告
  exportReport: (bd) => ipcRenderer.invoke('export:report', plain(bd)),

  // 剪贴板
  writeClipboard: (text) => {
    try { require('electron').clipboard.writeText(text); } catch (e) {}
  },
});
