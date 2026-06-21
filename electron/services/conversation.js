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
  return conv.messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    }
    if (m.role === 'assistant' && m.toolCalls) {
      return { role: 'assistant', content: m.content || null, tool_calls: m.toolCalls };
    }
    return { role: m.role, content: m.content };
  });
}

module.exports = {
  setConvDir, createConversation, listConversations, loadConversation,
  appendMessage, renameConversation, deleteConversation, toAIMessages,
};
