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

【市集搜索规则 - 极其重要】
搜索只按三个条件: 物品类型 + 等级 + 一口价(sale_type),条件极少!
1. type 必须是国服真实基底名(下面列出),不要自己编造!
   - 戒指: 翡翠戒指/蓝玉戒指/紫晶戒指/红玉戒指/黄玉戒指/锻铁戒指/金光戒指
   - 项链: 日曜项链/赤红项链/帝金项链/珠光项链/星辉项链
   - 腰带: 万用腰带/生皮腰带/精致腰带/嵌板腰带/重革腰带
   - 头盔: 海螺头盔/勇士头盔/角斗士头盔/术士冠冕/羽饰冠冕
   - 胸甲: 蜥鳞外套/蛇鳞外套/巨龙鳞外套/皮革背心/铠装背心/斥候背心/寻路者外套
   - 手套: 精纺护腕/精制护腕/宏伟护腕/肃穆手套/精致手套/敦实护手
   - 鞋子: 牢靠绑腿/衬垫绑腿/毛皮绑腿/生皮短靴/蜥鳞靴/锁链战靴
   - 战矛: 飞翼长矛/分叉长矛/狩猎长矛/翱翔战矛/守护者战矛
   - 弓: 粗制弓/短弓/反曲弓/复合弓/寻战之弓/轰击弓
   - 盾牌: 嵌板轻盾/锻铁轻盾/加固塔盾/皇家塔盾
   不确定名字时,先用 list_market_slots 查看!
2. 搜索只传 type 和 level(可选)。不要传 stats!
3. 同一类型只搜1次! 不要反复搜(会触发限流429)!
4. 词缀从搜索结果里挑,不在搜索条件里加。

【返回搜索结果时 - 极其重要】
搜到结果后,必须列出多个候选(至少5个)给用户选择,用表格对比:
| # | 名称 | 价格 | 等级 | 核心词缀 |
- 按价格从低到高排序
- 标注哪些词缀符合用户需求(如火抗)
- 让用户自己选,不要只推荐1个
- 可以在表格下简短点评性价比最高的2-3个

【搜索工具选择策略】
- search_market: 宽泛搜(只按类型),结果多,从里面挑。优先用这个!
- search_market_filter: 精确搜(按类型+词缀+数值),如"火抗≥30的翡翠戒指"。
  当 search_market 结果太多且需要特定数值时才用。
- list_market_slots: 查物品类型名。不确定叫什么时用。

【工作流程 - 极其重要】
1. 先查知识库! 分析抗性/生命/伤害等属性时,用 search_knowledge 查游戏数据(词缀数值范围、技能效果、装备基底),
   给出准确的数值建议,比如"翡翠戒指火抗前缀最高 T1 是 +45%"。不要凭记忆编造数值!
2. 第一轮只做分析! 不要主动调用 search_market!
3. 分析完后,给出诊断结论 + 改进建议
4. 建议里要提到具体的装备类型和需要补的词缀,比如"建议换翡翠戒指补火抗"、"蜥鳞外套补生命"
5. 只有用户明确说"搜"或点击搜索按钮时,才调用 search_market!

【搜索结果必须带购买链接】
搜到装备后,每件物品列出 buyUrl 链接,用户自己去市集购买:
| # | 名称 | 价格 | 等级 | 词缀 | 购买 |
|---|------|------|------|------|------|
| 1 | xxx | 5 崇高 | ilvl65 | 火抗+30 生命+60 | [购买](buyUrl) |
- 表格里的"购买"列放链接,用户点击跳转市集
- 最后附上搜索结果页总链接 searchUrl

你可以同时调用多个工具(但搜索工具不要主动调用,等用户要求)。分析时要基于真实数据,不要编造数值。回答用中文,Markdown 格式输出。涉及数值时精确到小数。`;

/**
 * 执行 Agent 对话(支持多轮工具调用)
 * @param {object} opts
 * @param {object} opts.settings API 配置
 * @param {Array}  opts.history 对话历史(不含 system)
 * @param {string} opts.userMessage 当前用户消息
 * @param {string} opts.systemContext 系统上下文(BD数据/目标文档,注入 system prompt)
 * @param {object} opts.electron { session, net } (市集搜索用)
 * @param {function} opts.onChunk 流式回调 { type: 'content'|'thinking', text }
 * @param {function} opts.onToolCall 工具调用通知 { name, stage, args?, result? }
 * @returns {Promise<{ content, toolCalls[] }>}
 */
async function runAgent({ settings, history = [], userMessage, systemContext, electron, onChunk, onToolCall }) {
  const toolDefs = agentTools.getToolDefinitions();

  // 构建 system prompt: 基础 + 上下文注入
  let systemPrompt = SYSTEM_PROMPT;
  if (systemContext && systemContext.trim()) {
    systemPrompt += `\n\n========================================
【用户当前数据 - 已自动加载,无需再问分享码!】
${systemContext}
========================================
⚠️ 重要: 上面的 BD 数据已经给你了! 用户问"我的装备怎么改进"时,直接基于上面的数据分析,
不要问用户要分享码! 不要让用户自己提供数据! 数据就在上面!`;
  }

  // 构建 messages: system + history + user
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage },
  ];

  const MAX_ROUNDS = 8;
  const allToolCalls = []; // 记录所有工具调用

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const result = await callAIWithTools(settings, toolDefs, messages, onChunk);

    if (result.toolCalls && result.toolCalls.length > 0) {
      // AI 要调工具
      // 注意: DeepSeek 等严格 API 不接受 null content,必须给空串
      messages.push({
        role: 'assistant',
        content: result.content || '',
        tool_calls: result.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.function.name, arguments: tc.function.arguments || '{}' },
        })),
      });

      // 并行执行所有工具调用
      const toolResults = await Promise.all(result.toolCalls.map(async (call) => {
        const name = call.function.name;
        let args = {};
        try { args = JSON.parse(call.function.arguments); } catch (e) {}

        onToolCall && onToolCall({ name, stage: 'start', args });

        const ctx = { settings, electron };
        const toolResult = await agentTools.executeTool(name, args, ctx);

        onToolCall && onToolCall({ name, stage: 'done', args, result: toolResult });
        allToolCalls.push({ id: call.id, name, args, result: toolResult });

        // DeepSeek/严格 API 要求 tool 消息格式完整
        const content = JSON.stringify(toolResult) || '{}';
        return { role: 'tool', tool_call_id: call.id, content };
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

  // 清理 messages: 确保每条消息格式严格符合 OpenAI 规范
  const cleanMessages = messages.map((m) => {
    if (m.role === 'assistant' && m.tool_calls) {
      return {
        role: 'assistant',
        content: m.content || '',
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.function.name,
            arguments: typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments || {}),
          },
        })),
      };
    }
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content || '{}' };
    }
    return m;
  });

  const bodyObj = {
    model: settings.apiModel,
    messages: cleanMessages,
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

  // 调试: 打印发送的消息结构(帮助定位格式问题)
  console.log('[agent] 发送消息数:', cleanMessages.length, 'tool_calls消息:', cleanMessages.filter(m => m.tool_calls).length, 'tool消息:', cleanMessages.filter(m => m.role === 'tool').length);
  cleanMessages.forEach((m, i) => {
    if (m.tool_calls || m.role === 'tool') {
      console.log(`[agent] msg[${i}] role=${m.role} keys=${Object.keys(m).join(',')} tool_calls_valid=${m.tool_calls ? m.tool_calls.every(tc => tc.id && tc.type === 'function' && tc.function?.name) : 'N/A'}`);
    }
  });

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
