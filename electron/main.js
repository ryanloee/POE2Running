// Electron 主进程入口
const { app, BrowserWindow, ipcMain, dialog, session, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const trade = require('./services/trade');

// ============================================
// 全局代理(global-agent 猴补丁 http/https,对 Node 内置 fetch 也生效)
// 必须在所有 HTTP 请求之前初始化
// ============================================
try {
  const { bootstrap } = require('global-agent');
  bootstrap();
} catch (e) {
  console.warn('[main] global-agent 加载失败(非致命):', e.message);
}

/**
 * 配置全局代理。对所有 HTTP 请求生效(模型下载 + AI API 调用)。
 * @param {string} proxyUrl 代理地址,空串表示直连
 */
function configureProxy(proxyUrl) {
  try {
    const ga = require('global-agent');
    if (proxyUrl) {
      process.env.GLOBAL_AGENT_HTTP_PROXY = proxyUrl;
      process.env.GLOBAL_AGENT_HTTPS_PROXY = proxyUrl;
      if (ga.globalAgent) {
        ga.globalAgent.forceGlobalAgent = true;
      }
      console.log('[main] 全局代理已设置:', proxyUrl);
    } else {
      delete process.env.GLOBAL_AGENT_HTTP_PROXY;
      delete process.env.GLOBAL_AGENT_HTTPS_PROXY;
      if (ga.globalAgent) {
        ga.globalAgent.forceGlobalAgent = false;
      }
      console.log('[main] 全局代理已清除(直连)');
    }
  } catch (e) {
    console.error('[main] 代理配置失败:', e.message);
  }
}

// 启动时按已有设置配置代理
try {
  const initSettings = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8'));
  if (initSettings.proxyUrl) configureProxy(initSettings.proxyUrl);
} catch (_) { /* 首次运行无设置文件 */ }

const isDev = process.env.NODE_ENV === 'development';
let mainWindow = null;
let tradeWindow = null; // 市集登录/搜索窗口

// 市集登录窗口:用持久化 partition 存 QQ 登录态
function createTradeWindow(initialUrl) {
  if (tradeWindow && !tradeWindow.isDestroyed()) {
    tradeWindow.focus();
    if (initialUrl) tradeWindow.loadURL(initialUrl);
    return tradeWindow;
  }
  tradeWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    title: 'POE2 市集',
    webPreferences: {
      partition: trade.TRADE_PARTITION, // 持久化分区,cookie 存这里
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  tradeWindow.loadURL(initialUrl || `${trade.BASE}/trade2/search/${trade.LEAGUE}`);
  tradeWindow.on('closed', () => {
    tradeWindow = null;
    // 通知主窗口登录状态可能变化
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('trade:login-changed', {});
    }
  });
  return tradeWindow;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    title: 'POE2 BD 智能配装助手',
    backgroundColor: '#0f1117',
    autoHideMenuBar: true, // 隐藏顶部 File/Edit/View 菜单栏
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, // 安全:渲染进程隔离
      nodeIntegration: false,
      sandbox: false,
    },
  });
  // 彻底移除菜单栏(不只是隐藏)
  mainWindow.setMenuBarVisibility(false);

  if (isDev) {
    // 开发模式:加载 Vite dev server(支持热更新)
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // 生产模式:加载构建产物
    mainWindow.loadFile(path.join(__dirname, '..', 'dist-renderer', 'index.html'));
  }

  // 市集购买链接等外部链接 → 用系统默认浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ============================================
// IPC 注册(渲染进程通过 window.api.xxx 调用)
// ============================================
function registerIpc() {
  const poe2 = require('./services/poe2');
  // 初始化知识库目录
  const kb = require('./services/knowledge/builder');
  kb.setKbDir(path.join(app.getPath('userData'), 'knowledge'));

  // 按当前设置配置代理(确保 AI 请求也走代理)
  const curSettings = readSettings();
  if (curSettings.proxyUrl) configureProxy(curSettings.proxyUrl);

  // 抓取 BD 数据
  ipcMain.handle('poe2:fetch', async (_event, shareCode) => {
    try {
      const data = await poe2.fetchAll(shareCode);
      return { ok: true, data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // AI 分析(三种场景,流式推送)
  // payload: { scene: 'single'|'compare'|'doc', bdA?, bdB?, shareCode?, shareCodeA?, shareCodeB?, docText?, question? }
  ipcMain.handle('ai:analyze', async (event, payload) => {
    console.log('[ai:analyze] 收到 payload, scene:', payload?.scene);
    try {
      const settings = readSettings();
      // 确保代理配置是最新的(AI API 请求也走代理)
      if (settings.proxyUrl) configureProxy(settings.proxyUrl);
      const ai = require('./services/ai');
      const exp = require('./services/export');

      // 如果传的是 shareCode,先自己 fetch BD(避免渲染进程 Vue Proxy 克隆问题)
      let bdA = payload.bdA || null;
      let bdB = payload.bdB || null;
      if (!bdA && payload.shareCode) {
        console.log('[ai:analyze] 通过 shareCode 获取 BD A...');
        bdA = await poe2.fetchAll(payload.shareCode);
      }
      if (!bdA && payload.shareCodeA) {
        console.log('[ai:analyze] 通过 shareCodeA 获取 BD A...');
        bdA = await poe2.fetchAll(payload.shareCodeA);
      }
      if (!bdB && payload.shareCodeB) {
        console.log('[ai:analyze] 通过 shareCodeB 获取 BD B...');
        bdB = await poe2.fetchAll(payload.shareCodeB);
      }

      if (!bdA) throw new Error('无法获取角色数据,请检查分享码');

      // 按场景构造 messages
      let userPrompt;
      switch (payload.scene) {
        case 'compare':
          userPrompt = exp.buildComparePrompt(bdA, bdB);
          break;
        case 'doc':
          userPrompt = exp.buildDocComparePrompt(bdA, payload.docText);
          break;
        case 'single':
        default:
          userPrompt = exp.buildSinglePrompt(bdA, payload.question);
      }

      // 知识库检索:从 BD+问题提取关键词检索,有结果则注入 system prompt
      let systemContent = '你是流放之路2(Path of Exile 2)的资深配装顾问,精通各职业 BD 流派、装备词缀、抗性机制。回答用中文,专业且可执行。';
      try {
        const indexer = require('./services/knowledge/indexer');
        if (indexer.isIndexed()) {
          const retriever = require('./services/knowledge/retriever');
          // 构造检索 query:职业 + 关键属性 + 问题
          const role = bdA.role || {};
          const panel = bdA.panel || {};
          const queryParts = [
            role.class_name,
            payload.question || '',
            `抗性 火${panel.fire_resistance} 冰${panel.cold_resistance} 雷${panel.lightning_resistance}`,
          ].filter(Boolean);
          const kbResults = await retriever.retrieve(settings, queryParts.join(' '), 5);
          if (kbResults.length) {
            const kbText = kbResults.map((r, i) => `【${r.title}】\n${r.content}`).join('\n\n');
            systemContent += `\n\n以下是 POE2 官方游戏数据(来自 Path of Building 2),请严格依据这些数据作答,涉及具体数值/词缀/技能时以这些数据为准:\n\n${kbText}`;
          }
        }
      } catch (e) {
        // 知识库检索失败不影响主流程,降级为不带知识库
        console.error('[ai] 知识库检索失败,降级: ' + e.message);
      }

      const messages = [
        { role: 'system', content: systemContent },
        { role: 'user', content: userPrompt },
      ];

      // 流式:每段 chunk 通过 IPC 推给渲染进程
      // chunk 格式: { type: 'content'|'thinking', text: string }
      const full = await ai.chatStream(settings, messages, (chunk) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('ai:chunk', chunk);
        }
      });
      console.log('[ai:analyze] 完成, 长度:', full?.length);

      // AI 分析完后自动搜装备(异步,不阻塞返回)
      // 先检查市集登录态,已登录才搜
      try {
        const loginStatus = await trade.checkLogin({ session, net });
        if (loginStatus.loggedIn) {
          const skills = require('./services/skills');
          // 双线索生成搜索任务(比单一正则可靠):
          // 1. AI 文本推荐(parseAIRecommendations)
          // 2. BD 数据差距分析(generateSearchTasks)—— 抗性/生命不足时自动推荐
          const aiTasks = skills.parseAIRecommendations(full);
          const bdTasks = skills.generateSearchTasks(payload.bdA);
          // 合并去重(按装备类型)
          const seen = new Set();
          const tasks = [...aiTasks, ...bdTasks].filter((t) => {
            if (seen.has(t.type)) return false;
            seen.add(t.type);
            return true;
          }).slice(0, 5);

          if (tasks.length) {
            const tradeResults = [];
            for (const task of tasks) {
              try {
                // 用 skills 的精确 query 构造(词缀 ID 过滤),而非简单类型搜索
                const query = skills.buildPreciseQuery(task);
                const res = await trade.search({ session, net }, query, 10);
                tradeResults.push({
                  need: task.type,
                  reason: task.reason,
                  intents: task.intents || [],
                  total: res.total,
                  items: res.items.slice(0, 5),
                });
              } catch (e) {
                tradeResults.push({ need: task.type, error: e.message });
              }
            }
            if (tradeResults.length && !event.sender.isDestroyed()) {
              event.sender.send('trade:auto-results', { results: tradeResults });
            }
          }
        } else if (!event.sender.isDestroyed()) {
          // 未登录,提示用户
          event.sender.send('trade:auto-results', { needLogin: true, reason: loginStatus.reason });
        }
      } catch (e) {
        console.error('[ai:analyze] 市集自动搜索失败(非致命):', e.message);
      }

      return { ok: true, content: full };
    } catch (e) {
      console.error('[ai:analyze] 错误:', e.message);
      return { ok: false, error: String(e.message || e) };
    }
  });

  // 导出完整报告文本(无 Key 模式)
  ipcMain.handle('export:report', async (_event, bd) => {
    try {
      const exp = require('./services/export');
      return { ok: true, text: exp.exportFullReport(bd) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // BD 转精简文本(给 AI 对话上下文用)
  ipcMain.handle('export:bdToText', async (_event, bd) => {
    try {
      const exp = require('./services/export');
      return exp.bdToText(bd);
    } catch (e) {
      return '';
    }
  });

  // AI 连接测试(发一句"你好"验证)
  ipcMain.handle('ai:test', async (_event, settings) => {
    console.log('[ipc] ai:test 被调用, settings:', JSON.stringify(settings));
    const ai = require('./services/ai');
    return await ai.testConnection(settings);
  });

  // AI Agent:让 AI 自主去市集搜装备并推荐
  // payload: { bd, question? }
  ipcMain.handle('ai:tradeAgent', async (event, payload) => {
    try {
      const settings = readSettings();
      // 先检查市集登录
      const loginStatus = await trade.checkLogin({ session, net });
      if (!loginStatus.loggedIn) {
        return { ok: false, error: '市集未登录,请先在「市集」页登录 QQ' };
      }
      const agent = require('./services/ai-agent');
      const exportMod = require('./services/export');
      // 流式推送思考/搜索过程
      const result = await agent.runAgent({
        settings,
        userMessage: payload.question || '请分析我的BD并在市集搜索合适的装备推荐给我',
        systemContext: payload.bd ? exportMod.bdToText(payload.bd) : undefined,
        electron: { session, net },
        onChunk: (chunk) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('agent:chunk', chunk);
          }
        },
        onToolCall: (info) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('agent:tool', info);
          }
        },
      });
      return { ok: true, ...result };
    } catch (e) {
      console.error('[ai:tradeAgent] 错误:', e.message);
      return { ok: false, error: String(e.message || e) };
    }
  });

  // ============ Agent 对话 ============
  const conversation = require('./services/conversation');
  conversation.setConvDir(path.join(app.getPath('userData'), 'conversations'));

  // 新建对话
  ipcMain.handle('agent:new', async (_event, title) => {
    return conversation.createConversation(title);
  });

  // 对话列表
  ipcMain.handle('agent:conversations', async () => {
    return conversation.listConversations();
  });

  // 加载对话历史
  ipcMain.handle('agent:history', async (_event, id) => {
    return conversation.loadConversation(id);
  });

  // 删除对话
  ipcMain.handle('agent:delete', async (_event, id) => {
    conversation.deleteConversation(id);
    return { ok: true };
  });

  // 重命名对话
  ipcMain.handle('agent:rename', async (_event, id, title) => {
    conversation.renameConversation(id, title);
    return { ok: true };
  });

  // Agent 对话(带工具调用的多轮对话)
  ipcMain.handle('agent:chat', async (event, payload) => {
    const { conversationId, message, context } = payload;
    try {
      const settings = readSettings();
      if (settings.proxyUrl) configureProxy(settings.proxyUrl);

      // 获取对话历史(AI messages 格式)— 先不存 user 消息,成功后再存
      const history = conversation.toAIMessages(conversationId);

      console.log('[agent:chat] context长度:', context?.length || 0, '历史消息数:', history.length);

      // 检查市集登录(如果可能用到市集)
      let tradeSession = null;
      try {
        const loginStatus = await trade.checkLogin({ session, net });
        console.log('[agent:chat] 市集登录检查:', JSON.stringify(loginStatus));
        if (loginStatus.loggedIn) tradeSession = { session, net };
      } catch (e) {
        console.error('[agent:chat] 市集登录检查异常:', e.message);
      }
      console.log('[agent:chat] tradeSession:', !!tradeSession);

      const agent = require('./services/ai-agent');
      let thinkingContent = '';

      const result = await agent.runAgent({
        settings,
        history,
        userMessage: message,
        systemContext: context || undefined,
        electron: tradeSession,
        // 流式推送
        onChunk: (chunk) => {
          if (!event.sender.isDestroyed()) {
            if (chunk.type === 'thinking') thinkingContent += chunk.text;
            event.sender.send('agent:chunk', chunk);
          }
        },
        onToolCall: (info) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('agent:tool', info);
          }
        },
      });

      // 从 AI 回复文本中智能提取推荐按钮(基于装备类型和词缀关键词)
      let recommendations = [];
      try {
        const skills = require('./services/skills');
        recommendations = skills.parseAIRecommendations(result.content).map((r) => ({
          label: `搜${r.intents?.length ? r.intents.join('') : ''}${r.slot || '装备'}`,
          type: r.type,
          intent: r.intents?.[0] || '',
        }));
        recommendations.push({ label: '深入分析' });
      } catch (_) {}

      // 成功后才保存消息(失败不留坏历史)
      conversation.appendMessage(conversationId, { role: 'user', content: message });

      // 只存最终的 assistant 回复(不存 tool_calls/tool 中间消息)
      // 避免 DeepSeek "tool must follow tool_calls" 等严格格式校验报错
      conversation.appendMessage(conversationId, {
        role: 'assistant',
        content: result.content,
        thinking: thinkingContent || undefined,
        recommendations,
      });

      return { ok: true, content: result.content, toolCalls: result.toolCalls, recommendations };
    } catch (e) {
      console.error('[agent:chat] 错误:', e.message);
      return { ok: false, error: String(e.message || e) };
    }
  });

  // ============ 知识库 ============
  // 知识库状态
  ipcMain.handle('knowledge:status', async () => {
    return {
      docsBuilt: kb.isBuilt(),
      indexBuilt: require('./services/knowledge/indexer').isIndexed(),
      meta: kb.loadMeta(),
    };
  });

  // 构建文档(下载 PoB2 + 解析)
  ipcMain.handle('knowledge:buildDocs', async (event) => {
    try {
      const meta = await kb.build((stage, detail) => {
        if (!event.sender.isDestroyed()) event.sender.send('kb:progress', { stage, detail });
      });
      return { ok: true, meta };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // 构建向量索引(本地模型)
  ipcMain.handle('knowledge:buildIndex', async (event) => {
    try {
      const settings = readSettings();
      // 确保代理配置是最新(模型下载走代理)
      if (settings.proxyUrl) configureProxy(settings.proxyUrl);
      const indexer = require('./services/knowledge/indexer');
      // 设置本地模型目录
      const localEmbedder = indexer.localEmbedder;
      localEmbedder.setModelDir(path.join(app.getPath('userData'), 'models'));
      const result = await indexer.buildIndex(settings, (info) => {
        if (!event.sender.isDestroyed()) {
          // 透传标准化进度: {stage, percent, detail}
          event.sender.send('kb:progress', {
            stage: info.stage || 'embed',
            percent: info.percent || 0,
            detail: info.detail || '',
          });
        }
      });
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // 测试检索
  ipcMain.handle('knowledge:testRetrieve', async (_event, query) => {
    try {
      const settings = readSettings();
      const retriever = require('./services/knowledge/retriever');
      const results = await retriever.retrieve(settings, query, 5);
      return { ok: true, results };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ============ 市集 ============
  // 检查市集登录态
  ipcMain.handle('trade:checkLogin', async () => {
    try {
      const result = await trade.checkLogin({ session, net });
      // 诊断:打印市集 session 的所有 cookie
      const tradeSes = session.fromPartition(trade.TRADE_PARTITION);
      const cookies = await tradeSes.cookies.get({});
      console.log('[trade:checkLogin] 结果:', JSON.stringify(result));
      console.log('[trade:checkLogin] 市集session的cookie数:', cookies.length);
      const poe = cookies.filter((c) => c.domain.includes('poe.game') || c.name === 'POESESSID');
      console.log('[trade:checkLogin] poe相关cookie:', poe.map((c) => c.name + '@' + c.domain).join(', '));
      return result;
    } catch (e) {
      console.error('[trade:checkLogin] 异常:', e.message);
      return { loggedIn: false, reason: e.message };
    }
  });

  // 打开市集登录窗口
  ipcMain.handle('trade:openLogin', async () => {
    createTradeWindow();
    return { ok: true };
  });

  // 搜索市集装备
  // payload: { type, statIds?, limit? } 或 { query, limit? }
  ipcMain.handle('trade:search', async (_event, payload) => {
    try {
      const query = payload.query || trade.buildQuery({ type: payload.type, statIds: payload.statIds });
      const result = await trade.search({ session, net }, query, payload.limit || 20);
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // 调试:直接测试市集搜索(带应用 cookie),测试多种过滤格式
  ipcMain.handle('trade:debugSearch', async (_event, payload) => {
    try {
      const itemType = payload.type || '翡翠戒指';
      const skills = require('./services/skills');
      const lines = [];

      // 测试1: 宽泛搜(只类型)
      const q1 = skills.buildPreciseQuery({ type: itemType });
      const r1 = await trade.search({ session, net }, q1, 5);
      lines.push(`【只类型】 total=${r1.total} 返回${r1.items.length}件`);

      // 测试2: 类型 + 火抗(min:20) - 用正确的 stat ID
      const fireId = skills.STAT_MAP.fire_resist;
	      const q2 = {
	        filters: { trade_filters: { sale_type: { option: 'any' } } },
	        type: itemType,
	        stats: [{ type: 'and', filters: [{ id: fireId, disabled: false, value: { min: 20 } }] }],
	      };
      console.log('[debug] 火抗过滤 query:', JSON.stringify(q2));
      const r2 = await trade.search({ session, net }, q2, 5);
      lines.push(`【火抗≥20】 total=${r2.total} 返回${r2.items.length}件`);

      // 测试3: 类型 + 生命(min:50)
      const lifeId = skills.STAT_MAP.life;
	      const q3 = {
	        filters: { trade_filters: { sale_type: { option: 'any' } } },
	        type: itemType,
	        stats: [{ type: 'and', filters: [{ id: lifeId, disabled: false, value: { min: 50 } }] }],
	      };
      const r3 = await trade.search({ session, net }, q3, 5);
      lines.push(`【生命≥50】 total=${r3.total} 返回${r3.items.length}件`);

      // 测试4: 类型 + 火抗 + 生命
	      const q4 = {
	        filters: { trade_filters: { sale_type: { option: 'any' } } },
	        type: itemType,
	        stats: [{ type: 'and', filters: [
	          { id: fireId, disabled: false, value: { min: 20 } },
	          { id: lifeId, disabled: false, value: { min: 50 } },
	        ] }],
	      };
      const r4 = await trade.search({ session, net }, q4, 5);
      lines.push(`【火抗≥20+生命≥50】 total=${r4.total} 返回${r4.items.length}件`);

      // 列出火抗过滤的几件
      if (r2.items.length) {
        lines.push('\n--- 火抗≥20 示例 ---');
        for (const it of r2.items.slice(0, 3)) {
          lines.push(`  ${it.price} | ilvl${it.ilvl} | ${(it.explicitMods||[]).slice(0,3).join('; ')}`);
        }
      }

      return { ok: true, body: lines.join('\n') };
    } catch (e) {
      console.error('[trade:debugSearch] 错误:', e.message);
      return { ok: false, error: e.message };
    }
  });

  // 根据 AI 分析结果自动搜装备(提取 AI 提到的装备类型,逐个搜)
  ipcMain.handle('trade:searchFromAI', async (_event, { aiResult, limit }) => {
    try {
      const needs = trade.extractNeedsFromAI(aiResult);
      if (!needs.length) {
        return { ok: true, results: [], note: 'AI 分析结果中未识别到可搜索的装备类型' };
      }
      const results = [];
      for (const need of needs.slice(0, 5)) {
        try {
          const query = trade.buildQuery(need);
          const res = await trade.search({ session, net }, query, limit || 10);
          results.push({ need, total: res.total, items: res.items.slice(0, 5) });
        } catch (e) {
          results.push({ need, error: e.message });
        }
      }
      return { ok: true, results };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // 获取本地 embedding 模型列表
  ipcMain.handle('knowledge:getLocalModels', async () => {
    try {
      const indexer = require('./services/knowledge/indexer');
      const localEmbedder = indexer.localEmbedder;
      localEmbedder.setModelDir(path.join(app.getPath('userData'), 'models'));
      const models = localEmbedder.getAvailableModels();
      return { ok: true, models };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // 选择文件对话框(用于上传文档)
  ipcMain.handle('dialog:openFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择目标 BD 文档',
      properties: ['openFile'],
      filters: [
        { name: '文档', extensions: ['docx', 'pptx', 'txt', 'md', 'csv', 'png', 'jpg', 'jpeg'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths.length) return { ok: false };
    return { ok: true, filePath: result.filePaths[0] };
  });

  // 解析文档(第二期补 doc.js 后启用,先留接口)
  ipcMain.handle('doc:parse', async (_event, filePath) => {
    try {
      const doc = require('./services/doc');
      const parsed = await doc.parse(filePath);
      return { ok: true, data: parsed };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // 设置读写(持久化到 userData/settings.json)
  ipcMain.handle('settings:get', async () => {
    console.log('[ipc] settings:get 被调用');
    return readSettings();
  });
  ipcMain.handle('settings:save', async (_event, settings) => {
    console.log('[ipc] settings:save 被调用, 内容:', JSON.stringify(settings));
    writeSettings(settings);
    // 保存后立即重新配置代理(下次请求即生效)
    if (settings.proxyUrl !== undefined) configureProxy(settings.proxyUrl);
    return { ok: true };
  });

  // 记住/读取上次的 BD 分享码(单独存,不和 API 设置混)
  const lastCodePath = () => path.join(app.getPath('userData'), 'last-codes.json');
  ipcMain.handle('settings:saveLastCode', async (_event, codes) => {
    try { fs.writeFileSync(lastCodePath(), JSON.stringify(codes), 'utf8'); } catch (_) {}
    return { ok: true };
  });
  ipcMain.handle('settings:getLastCode', async () => {
    try {
      const data = JSON.parse(fs.readFileSync(lastCodePath(), 'utf8'));
      console.log('[settings:getLastCode] 读取到:', JSON.stringify(data));
      return data;
    } catch (_) {
      console.log('[settings:getLastCode] 无记录文件');
      return {};
    }
  });

  // 调试日志(渲染进程 preload 转发到主进程终端)
  ipcMain.handle('debug:log', async (_event, msg) => {
    console.log('[渲染进程]', msg);
  });
}

// 设置文件路径(Electron 提供的 userData 目录,跨平台)
function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}
function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch (e) {
    return { apiBaseUrl: '', apiKey: '', apiModel: '' };
  }
}
function writeSettings(settings) {
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
}

// ============================================
// App 生命周期
// ============================================
app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
