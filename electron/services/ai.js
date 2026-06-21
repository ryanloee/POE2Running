// AI 服务层:支持 OpenAI 与 Anthropic 两种 API 格式,流式输出
// OpenAI 格式:智谱GLM/通义/kimi/DeepSeek/OpenAI/本地Ollama 等
// Anthropic 格式:Claude 官方及兼容中转
// 主进程调用,无 CORS 问题

// ============================================
// URL 规范化
// ============================================
function normalizeUrl(baseUrl, format, endpoint) {
  let base = (baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('未填写 API Base URL');
  // 判断 base 是否已含版本段(/v1 /v2 /v4 等),智谱用 /v4,OpenAI/通义用 /v1
  const hasVersion = /\/v\d+$/.test(base);
  if (endpoint === 'chat') {
    if (format === 'anthropic') {
      if (/\/messages$/.test(base)) return base;
      return base + (hasVersion ? '/messages' : '/v1/messages');
    }
    // openai
    if (/\/chat\/completions$/.test(base)) return base;
    return base + (hasVersion ? '/chat/completions' : '/v1/chat/completions');
  }
  // models 端点
  if (format === 'anthropic') {
    if (/\/models$/.test(base)) return base;
    return base + (hasVersion ? '/models' : '/v1/models');
  }
  if (/\/models$/.test(base)) return base;
  return base + (hasVersion ? '/models' : '/v1/models');
}

// ============================================
// 流式对话
// ============================================
async function chatStream(settings, messages, onChunk) {
  if (!settings.apiKey || !settings.apiModel) {
    throw new Error('未配置 API Key 或模型名');
  }
  const format = settings.apiFormat || 'openai';
  if (format === 'anthropic') {
    return chatAnthropic(settings, messages, onChunk);
  }
  return chatOpenAI(settings, messages, onChunk);
}

// OpenAI 格式流式
async function chatOpenAI(settings, messages, onChunk) {
  const url = normalizeUrl(settings.apiBaseUrl, 'openai', 'chat');
  const bodyObj = {
    model: settings.apiModel,
    messages,
    stream: true,
    temperature: 0.7,
  };
  // 思考深度(推理模型用)。映射: max/high→high, low→low, off→不传
  const thinking = settings.thinkingLevel || 'max';
  if (thinking !== 'off') {
    bodyObj.reasoning_effort = thinking === 'max' ? 'high' : thinking; // OpenAI o系列/DeepSeek-R1 标准
    bodyObj.enable_thinking = true; // 部分平台(硅基流动等)用这个开关
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify(bodyObj),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API 请求失败 HTTP ${res.status}: ${t.slice(0, 300)}`);
  }
  // OpenAI 推理模型:思考内容在 delta.reasoning_content,正式内容在 delta.content
  return parseSSE(res, (json) => {
    const d = json.choices?.[0]?.delta || {};
    return { content: d.content || '', thinking: d.reasoning_content || '' };
  }, onChunk);
}

// Anthropic 格式流式
async function chatAnthropic(settings, messages, onChunk) {
  const url = normalizeUrl(settings.apiBaseUrl, 'anthropic', 'chat');
  // Anthropic:system 单独字段,messages 只含 user/assistant
  const systemMsg = messages.find((m) => m.role === 'system');
  const dialogMsgs = messages.filter((m) => m.role !== 'system');
  const bodyObj = {
    model: settings.apiModel,
    system: systemMsg ? systemMsg.content : undefined,
    messages: dialogMsgs,
    stream: true,
    max_tokens: 4096,
  };
  // 思考深度:Anthropic 用 thinking.budget_tokens 控制思考预算
  const thinking = settings.thinkingLevel || 'max';
  if (thinking !== 'off') {
    const budget = thinking === 'low' ? 2048 : thinking === 'high' ? 8192 : 12000; // max=12000
    bodyObj.thinking = { type: 'enabled', budget_tokens: budget };
    // 开启思考时 max_tokens 要足够大(>= budget + 输出)
    bodyObj.max_tokens = budget + 4096;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(bodyObj),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API 请求失败 HTTP ${res.status}: ${t.slice(0, 300)}`);
  }
  // Anthropic SSE: thinking_delta → 思考内容, text_delta → 正式内容
  return parseSSE(res, (json) => {
    if (json.type === 'content_block_delta') {
      if (json.delta?.type === 'thinking_delta') return { content: '', thinking: json.delta?.thinking || '' };
      if (json.delta?.type === 'text_delta') return { content: json.delta?.text || '', thinking: '' };
    }
    return { content: '', thinking: '' };
  }, onChunk);
}

// 通用 SSE 解析
// extractDelta 返回 { content: string, thinking: string }
// onChunk(chunk) chunk 格式: { type: 'content'|'thinking', text: string }
async function parseSSE(res, extractDelta, onChunk) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let full = '';
  let fullThinking = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') return full;
      try {
        const { content, thinking } = extractDelta(JSON.parse(data));
        if (thinking) {
          fullThinking += thinking;
          if (onChunk) onChunk({ type: 'thinking', text: thinking });
        }
        if (content) {
          full += content;
          if (onChunk) onChunk({ type: 'content', text: content });
        }
      } catch (e) {}
    }
  }
  return full;
}

// ============================================
// 测试连接:发一句"你好"用流式验证对话链路
// 用流式是因为很多中转API(如opencode)只支持stream模式,非流式会500
// ============================================
async function testConnection(settings) {
  if (!settings.apiBaseUrl || !settings.apiKey) {
    return { ok: false, error: '请填写 Base URL 和 API Key' };
  }
  if (!settings.apiModel) {
    return { ok: false, error: '请填写模型名' };
  }
  try {
    // 复用 chatStream(流式),收到任意内容即视为连接成功
    let firstReply = '';
    const full = await chatStream(settings, [{ role: 'user', content: '你好' }], (chunk) => {
      // chunk = { type: 'content'|'thinking', text: string }
      if (!firstReply && chunk.type === 'content' && chunk.text) firstReply = chunk.text;
    });
    if (full && full.trim()) {
      return { ok: true, reply: full.trim().slice(0, 50) };
    }
    return { ok: false, error: 'API 未返回内容(可能模型名错误或额度不足)' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { chatStream, testConnection, normalizeUrl };
