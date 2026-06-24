// 对话持久化:管理多轮对话历史(存储在 userData/conversations/)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let CONV_DIR = '';

function setConvDir(dir) {
  CONV_DIR = dir;
  fs.mkdirSync(dir, { recursive: true });
}

function indexPath() {
  return path.join(CONV_DIR, 'index.json');
}

function convPath(id) {
  return path.join(CONV_DIR, `${id}.json`);
}

function genId() {
  return crypto.randomBytes(8).toString('hex');
}

// === 索引管理 ===

function readIndex() {
  try {
    return JSON.parse(fs.readFileSync(indexPath(), 'utf8'));
  } catch (_) {
    return [];
  }
}

function writeIndex(list) {
  fs.writeFileSync(indexPath(), JSON.stringify(list, null, 2), 'utf8');
}

// === 对话操作 ===

/**
 * 新建对话
 * @param {string} title 对话标题(可选,默认"新对话")
 * @returns {{ id, title, createdAt, messages }}
 */
function createConversation(title) {
  const id = genId();
  const now = new Date().toISOString();
  const conv = { id, title: title || '新对话', createdAt: now, updatedAt: now, messages: [] };
  fs.writeFileSync(convPath(id), JSON.stringify(conv, null, 2), 'utf8');

  const index = readIndex();
  index.unshift({ id, title: conv.title, createdAt: now, updatedAt: now, messageCount: 0 });
  writeIndex(index);

  return conv;
}

/**
 * 获取对话列表
 * @returns {Array<{ id, title, createdAt, updatedAt, messageCount }>}
 */
function listConversations() {
  return readIndex();
}

/**
 * 加载完整对话(含消息)
 * @param {string} id
 * @returns {{ id, title, createdAt, messages }|null}
 */
function loadConversation(id) {
  try {
    return JSON.parse(fs.readFileSync(convPath(id), 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * 追加消息到对话
 * @param {string} id 对话 ID
 * @param {object} msg { role: 'user'|'assistant'|'tool', content, ... }
 */
function appendMessage(id, msg) {
  const conv = loadConversation(id);
  if (!conv) return null;

  const entry = {
    role: msg.role,
    content: msg.content || '',
    ...(msg.toolCalls ? { toolCalls: msg.toolCalls } : {}),
    ...(msg.toolCallId ? { toolCallId: msg.toolCallId } : {}),
    ...(msg.toolName ? { toolName: msg.toolName } : {}),
    ...(msg.thinking ? { thinking: msg.thinking } : {}),
    ...(msg.recommendations ? { recommendations: msg.recommendations } : {}),
    timestamp: new Date().toISOString(),
  };
  conv.messages.push(entry);
  conv.updatedAt = entry.timestamp;
  fs.writeFileSync(convPath(id), JSON.stringify(conv, null, 2), 'utf8');

  // 更新索引
  const index = readIndex();
  const idx = index.findIndex((c) => c.id === id);
  if (idx >= 0) {
    index[idx].updatedAt = conv.updatedAt;
    index[idx].messageCount = conv.messages.length;
    // 自动用第一条用户消息作标题
    if (index[idx].title === '新对话') {
      const firstUser = conv.messages.find((m) => m.role === 'user');
      if (firstUser) {
        index[idx].title = firstUser.content.slice(0, 30) + (firstUser.content.length > 30 ? '...' : '');
        conv.title = index[idx].title;
        fs.writeFileSync(convPath(id), JSON.stringify(conv, null, 2), 'utf8');
      }
    }
    writeIndex(index);
  }
  return conv;
}

/**
 * 重命名对话
 */
function renameConversation(id, title) {
  const index = readIndex();
  const idx = index.findIndex((c) => c.id === id);
  if (idx >= 0) {
    index[idx].title = title;
    writeIndex(index);
  }
  const conv = loadConversation(id);
  if (conv) {
    conv.title = title;
    fs.writeFileSync(convPath(id), JSON.stringify(conv, null, 2), 'utf8');
  }
}

/**
 * 删除对话
 */
function deleteConversation(id) {
  try { fs.unlinkSync(convPath(id)); } catch (_) {}
  const index = readIndex().filter((c) => c.id !== id);
  writeIndex(index);
}

/**
 * 将对话历史转为 AI messages 格式(去掉 timestamp 等元数据)
 * @param {string} id
 * @returns {Array<{ role, content, tool_calls?, tool_call_id? }>}
 */
function toAIMessages(id) {
  const conv = loadConversation(id);
  if (!conv) return [];

  // 收集所有 tool 消息的 tool_call_id,用于校验
  const toolCallIds = new Set();
  for (const m of conv.messages) {
    if (m.role === 'tool' && m.toolCallId) toolCallIds.add(m.toolCallId);
  }

  // 用计数器给每个 tool_call 生成唯一 id
  let callCounter = 0;
  const result = [];
  for (const m of conv.messages) {
    // 跳过 tool 消息和带 toolCalls 的 assistant 消息(避免 DeepSeek 格式校验报错)
    // 只保留纯文本的 user/assistant 消息
    if (m.role === 'tool') continue;
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length) {
      // 有 tool_calls 但有正文内容,只保留正文
      if (m.content) result.push({ role: 'assistant', content: m.content });
      continue;
    }
    result.push({ role: m.role, content: m.content });
  }
  return result.filter((m) => m);
}

module.exports = {
  setConvDir, createConversation, listConversations, loadConversation,
  appendMessage, renameConversation, deleteConversation, toAIMessages,
};
