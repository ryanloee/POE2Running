// AI Agent:多轮对话 + 多工具调用循环
// 核心:function calling 多轮循环
//   1. 用户发消息 → 带上所有工具定义发给 AI
//   2. AI 返回 tool_calls → 执行真实工具(市集搜索/知识库检索/BD 获取等)
//   3. 把结果喂回 AI → AI 继续推理或给出最终回答
//   4. 循环直到 AI 不再调用工具

const ai = require('./ai');
const agentTools = require('./agent-tools');

// 系统 prompt
const SYSTEM_PROMPT = `你是 POE2(流放之路2)国服资深配装顾问 Agent。你可以:

1. **获取 BD**: 用 fetch_build 根据分享码查玩家角色数据
2. **搜索知识库**: 用 search_knowledge 查游戏数据(技能/词缀/装备基底)
3. **对比 BD**: 用 compare_builds 对比两份配装
4. **分析短板**: 用 analyze_gaps 诊断角色属性缺陷
5. **搜索市集**: 用 search_market 搜国服在售装备

你可以同时调用多个工具。分析时要基于真实数据,不要编造数值。回答用中文,Markdown 格式输出。涉及数值时精确到小数。`;

/**
 * 执行 Agent 对话(支持多轮工具调用)
 * @param {object} opts
 * @param {object} opts.settings API 配置
 * @param {Array}  opts.history 对话历史(不含 system)
 * @param {string} opts.userMessage 当前用户消息
 * @param {object} opts.electron { session, net } (市集搜索用)
 * @param {function} opts.onChunk 流式回调 { type: 'content'|'thinking', text }
 * @param {function} opts.onToolCall 工具调用通知 { name, stage, args?, result? }
 * @returns {Promise<{ content, toolCalls[] }>}
 */
async function runAgent({ settings, history = [], userMessage, electron, onChunk, onToolCall }) {
  const toolDefs = agentTools.getToolDefinitions();

  // 构建 messages: system + history + user
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: userMessage },
  ];

  const MAX_ROUNDS = 8;
  const allToolCalls = []; // 记录所有工具调用

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const result = await callAIWithTools(settings, toolDefs, messages, onChunk);

    if (result.toolCalls && result.toolCalls.length > 0) {
      // AI 要调工具
      messages.push({ role: 'assistant', content: result.content || null, tool_calls: result.toolCalls });

      // 并行执行所有工具调用
      const toolResults = await Promise.all(result.toolCalls.map(async (call) => {
        const name = call.function.name;
        let args = {};
        try { args = JSON.parse(call.function.arguments); } catch (e) {}

        onToolCall && onToolCall({ name, stage: 'start', args });

        const ctx = { settings, electron };
        const toolResult = await agentTools.executeTool(name, args, ctx);

        onToolCall && onToolCall({ name, stage: 'done', args, result: toolResult });
        allToolCalls.push({ name, args, result: toolResult });

        return { role: 'tool', tool_call_id: call.id, content: JSON.stringify(toolResult) };
      }));

      messages.push(...toolResults);
      continue; // 下一轮
    }

    // AI 不再调工具,返回最终结果
    return { content: result.content, toolCalls: allToolCalls };
  }

  // 达到最大轮数
  messages.push({ role: 'user', content: '请基于已有的工具调用结果,直接给出最终回答,不要再调用工具。' });
  const final = await callAIWithTools(settings, toolDefs, messages, onChunk, true);
  return { content: final.content, toolCalls: allToolCalls };
}

/**
 * 调用 AI(带工具定义),解析 tool_calls
 */
async function callAIWithTools(settings, toolDefs, messages, onChunk, forceNoTools = false) {
  const format = settings.apiFormat || 'openai';
  if (format === 'anthropic') {
    return await callAnthropicWithTools(settings, toolDefs, messages, onChunk, forceNoTools);
  }

  const url = ai.normalizeUrl(settings.apiBaseUrl, 'openai', 'chat');
  const bodyObj = {
    model: settings.apiModel,
    messages,
    stream: true,
    temperature: 0.7,
  };
  const thinking = settings.thinkingLevel || 'max';
  if (thinking !== 'off') {
    bodyObj.reasoning_effort = thinking === 'max' ? 'high' : thinking;
    bodyObj.enable_thinking = true;
  }
  if (!forceNoTools && toolDefs.length > 0) {
    bodyObj.tools = toolDefs;
    bodyObj.tool_choice = 'auto';
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
    body: JSON.stringify(bodyObj),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Agent API 失败 HTTP ${res.status}: ${t.slice(0, 200)}`);
  }

  return await parseStreamForTools(res, onChunk);
}

/**
 * 解析流式响应,提取 content + 完整的 tool_calls
 */
async function parseStreamForTools(res, onChunk) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let content = '';
  const toolCallMap = {};

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
      if (data === '[DONE]') continue;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          content += delta.content;
          onChunk && onChunk({ type: 'content', text: delta.content });
        }
        if (delta.reasoning_content) {
          onChunk && onChunk({ type: 'thinking', text: delta.reasoning_content });
        }
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCallMap[idx]) toolCallMap[idx] = { id: '', function: { name: '', arguments: '' } };
            if (tc.id) toolCallMap[idx].id = tc.id;
            if (tc.function?.name) toolCallMap[idx].function.name += tc.function.name;
            if (tc.function?.arguments) toolCallMap[idx].function.arguments += tc.function.arguments;
          }
        }
      } catch (e) {}
    }
  }

  const toolCalls = Object.keys(toolCallMap).length > 0
    ? Object.values(toolCallMap).filter((tc) => tc.function.name)
    : null;

  return { content, toolCalls };
}

/**
 * Anthropic 格式工具调用
 */
async function callAnthropicWithTools(settings, toolDefs, messages, onChunk, forceNoTools) {
  const url = ai.normalizeUrl(settings.apiBaseUrl, 'anthropic', 'chat');
  const systemMsg = messages.find((m) => m.role === 'system');
  const dialogMsgs = messages.filter((m) => m.role !== 'system');

  // 转换 OpenAI tools 格式为 Anthropic 格式
  const anthropicTools = toolDefs.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));

  const bodyObj = {
    model: settings.apiModel,
    system: systemMsg?.content,
    messages: dialogMsgs,
    stream: true,
    max_tokens: 4096,
  };
  const thinking = settings.thinkingLevel || 'max';
  if (thinking !== 'off') {
    const budget = thinking === 'low' ? 2048 : thinking === 'high' ? 8192 : 12000;
    bodyObj.thinking = { type: 'enabled', budget_tokens: budget };
    bodyObj.max_tokens = budget + 4096;
  }
  if (!forceNoTools && anthropicTools.length > 0) {
    bodyObj.tools = anthropicTools;
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
    throw new Error(`Anthropic API 失败 HTTP ${res.status}: ${t.slice(0, 200)}`);
  }

  return await parseAnthropicStreamForTools(res, onChunk);
}

/**
 * 解析 Anthropic SSE 流,提取 content + tool_use
 */
async function parseAnthropicStreamForTools(res, onChunk) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let content = '';
  let thinking = '';
  const toolCalls = [];
  let currentTool = null;

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
      try {
        const json = JSON.parse(data);
        if (json.type === 'content_block_start') {
          if (json.content_block?.type === 'tool_use') {
            currentTool = { id: json.content_block.id, function: { name: json.content_block.name, arguments: '' } };
          }
        } else if (json.type === 'content_block_delta') {
          if (json.delta?.type === 'thinking_delta') {
            thinking += json.delta.thinking || '';
            onChunk && onChunk({ type: 'thinking', text: json.delta.thinking || '' });
          } else if (json.delta?.type === 'text_delta') {
            content += json.delta.text || '';
            onChunk && onChunk({ type: 'content', text: json.delta.text || '' });
          } else if (json.delta?.type === 'input_json_delta') {
            if (currentTool) currentTool.function.arguments += json.delta.partial_json || '';
          }
        } else if (json.type === 'content_block_stop') {
          if (currentTool) {
            toolCalls.push(currentTool);
            currentTool = null;
          }
        }
      } catch (e) {}
    }
  }

  return { content, toolCalls: toolCalls.length > 0 ? toolCalls : null };
}

module.exports = { runAgent };
