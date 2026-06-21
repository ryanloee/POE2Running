<script setup>
import { ref, reactive, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { Marked } from 'marked';
import markedKatex from 'marked-katex-extension';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.min.css';
import 'katex/dist/katex.min.css';
import Icon from './Icons.vue';

const props = defineProps({ settings: Object, onOpenSettings: Function });

// ===== Markdown 渲染器 =====
const marked = new Marked(
  markedKatex({ throwOnError: false, output: 'html' }),
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    },
  }),
);
marked.setOptions({ gfm: true, breaks: true });

function renderMd(md) {
  if (!md) return '';
  try { return marked.parse(md); } catch (_) { return md; }
}

// ===== 对话状态 =====
const conversations = ref([]);
const currentConvId = ref(null);
const messages = ref([]);
const inputText = ref('');
const sending = ref(false);
const sidebarOpen = ref(true);
const toolCalls = ref([]); // 当前回复的工具调用
const streamingThinking = ref('');
const streamingContent = ref('');
const attachments = ref([]); // 上传的文档

let offChunk = null;
let offTool = null;

// ===== 消息区自动滚动 =====
const messagesEl = ref(null);
function scrollToBottom() {
  nextTick(() => {
    if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
  });
}

// ===== 对话管理 =====
async function loadConversations() {
  conversations.value = await window.api.agentConversations();
}

async function switchConversation(id) {
  currentConvId.value = id;
  const conv = await window.api.agentHistory(id);
  messages.value = conv ? conv.messages : [];
  scrollToBottom();
}

async function newConversation() {
  const conv = await window.api.agentNew();
  currentConvId.value = conv.id;
  messages.value = [];
  await loadConversations();
}

async function deleteConv(id) {
  await window.api.agentDelete(id);
  if (currentConvId.value === id) {
    currentConvId.value = null;
    messages.value = [];
  }
  await loadConversations();
}

// ===== 发送消息 =====
async function sendMessage() {
  const text = inputText.value.trim();
  if (!text && attachments.value.length === 0) return;
  if (sending.value) return;

  // 如果没有当前对话,先新建
  if (!currentConvId.value) await newConversation();

  const userMsg = { role: 'user', content: text, timestamp: new Date().toISOString() };
  messages.value.push(userMsg);
  inputText.value = '';
  sending.value = true;
  toolCalls.value = [];
  streamingThinking.value = '';
  streamingContent.value = '';
  scrollToBottom();

  // 注册流式回调
  if (offChunk) offChunk();
  if (offTool) offTool();
  offChunk = window.api.onAgentChunk((chunk) => {
    if (chunk.type === 'thinking') streamingThinking.value += chunk.text;
    else streamingContent.value += chunk.text;
    scrollToBottom();
  });
  offTool = window.api.onAgentTool((info) => {
    if (info.stage === 'start') {
      toolCalls.value.push({ name: info.name, args: info.args, status: 'running' });
    } else if (info.stage === 'done') {
      const tc = toolCalls.value.find((t) => t.name === info.name && t.status === 'running');
      if (tc) { tc.status = 'done'; tc.result = info.result; }
    }
    scrollToBottom();
  });

  try {
    const res = await window.api.agentChat({
      conversationId: currentConvId.value,
      message: text,
      attachments: attachments.value.length ? attachments.value : undefined,
    });

    // 将 assistant 回复加入消息列表
    const assistantMsg = {
      role: 'assistant',
      content: res.ok ? res.content : ('❌ ' + res.error),
      thinking: streamingThinking.value || undefined,
      toolCalls: toolCalls.value.length ? [...toolCalls.value] : undefined,
      timestamp: new Date().toISOString(),
    };
    messages.value.push(assistantMsg);
    attachments.value = [];
    await loadConversations();
  } catch (e) {
    messages.value.push({ role: 'assistant', content: '❌ ' + e.message, timestamp: new Date().toISOString() });
  } finally {
    sending.value = false;
    streamingThinking.value = '';
    streamingContent.value = '';
    toolCalls.value = [];
    if (offChunk) { offChunk(); offChunk = null; }
    if (offTool) { offTool(); offTool = null; }
    scrollToBottom();
  }
}

// ===== 文档上传 =====
async function uploadFile() {
  const res = await window.api.openFile();
  if (!res.ok) return;
  const parsed = await window.api.parseDoc(res.filePath);
  if (!parsed.ok) { alert('文档解析失败: ' + parsed.error); return; }
  const name = res.filePath.split(/[\\/]/).pop();
  attachments.value.push({ name, text: parsed.data.text.slice(0, 8000) });
}

// ===== 快捷键 =====
function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

// ===== 生命周期 =====
onMounted(async () => {
  await loadConversations();
  // 如果有对话,打开第一个
  if (conversations.value.length > 0) {
    await switchConversation(conversations.value[0].id);
  }
});

onUnmounted(() => {
  if (offChunk) offChunk();
  if (offTool) offTool();
});
</script>

<template>
  <div class="chat-layout">
    <!-- 侧栏:对话列表 -->
    <div v-if="sidebarOpen" class="chat-sidebar">
      <div class="sidebar-header">
        <span>对话历史</span>
        <button class="icon-btn" @click="newConversation" title="新对话"><Icon name="plus" :size="16" /></button>
      </div>
      <div class="conv-list">
        <div v-for="c in conversations" :key="c.id" :class="['conv-item', currentConvId === c.id && 'active']" @click="switchConversation(c.id)">
          <div class="conv-title">{{ c.title }}</div>
          <div class="conv-meta">{{ c.messageCount }} 条消息</div>
          <button class="conv-del" @click.stop="deleteConv(c.id)" title="删除">×</button>
        </div>
        <div v-if="!conversations.length" class="conv-empty">暂无对话</div>
      </div>
    </div>

    <!-- 主区域 -->
    <div class="chat-main">
      <!-- 顶栏 -->
      <div class="chat-topbar">
        <button class="icon-btn" @click="sidebarOpen = !sidebarOpen" title="切换侧栏">
          <Icon name="menu" :size="18" />
        </button>
        <div class="topbar-title">🤖 POE2 BD Agent</div>
        <button class="icon-btn" @click="onOpenSettings?.()" title="设置"><Icon name="settings" :size="18" /></button>
      </div>

      <!-- 消息区 -->
      <div class="chat-messages" ref="messagesEl">
        <!-- 空状态 -->
        <div v-if="!messages.length && !sending" class="chat-empty">
          <div class="empty-icon">🤖</div>
          <div class="empty-title">POE2 BD 智能配装 Agent</div>
          <div class="empty-desc">
            问我任何关于流放之路2的问题！<br>
            我可以帮你查 BD、分析短板、搜市集装备、查游戏数据。
          </div>
          <div class="empty-examples">
            <button class="example-btn" @click="inputText = '帮我分析这个BD的短板: lePqIvMTUCeSzPPfEhVSLLKnvIo2o_x_IMPmnW4nrCvs_Ar3N2BQU3G-P9kS735L'; sendMessage()">
              📊 分析 BD 短板
            </button>
            <button class="example-btn" @click="inputText = '火抗词缀最高能到多少？帮我查一下知识库'; sendMessage()">
              📚 查游戏知识
            </button>
            <button class="example-btn" @click="inputText = '市集上有没有便宜的火抗胸甲？'; sendMessage()">
              🛒 搜索市集
            </button>
          </div>
        </div>

        <!-- 消息列表 -->
        <div v-for="(msg, i) in messages" :key="i" :class="['msg', msg.role]">
          <!-- 用户消息 -->
          <div v-if="msg.role === 'user'" class="msg-user">
            <div class="msg-bubble user-bubble">{{ msg.content }}</div>
          </div>

          <!-- AI 回复 -->
          <div v-else-if="msg.role === 'assistant'" class="msg-assistant">
            <!-- 工具调用 -->
            <div v-if="msg.toolCalls?.length" class="tool-calls">
              <div v-for="(tc, j) in msg.toolCalls" :key="j" class="tool-card">
                <div class="tool-header">
                  <span :class="['tool-status', tc.status === 'done' ? 'done' : 'running']">
                    {{ tc.status === 'done' ? '✅' : '⏳' }}
                  </span>
                  <span class="tool-name">{{ tc.name }}</span>
                </div>
                <div v-if="tc.args" class="tool-args">{{ JSON.stringify(tc.args) }}</div>
              </div>
            </div>

            <!-- 思考内容 -->
            <div v-if="msg.thinking" class="thinking-block">
              <details>
                <summary>🧠 思考过程 ({{ msg.thinking.length }} 字)</summary>
                <div class="thinking-content">{{ msg.thinking }}</div>
              </details>
            </div>

            <!-- 正文 -->
            <div class="msg-bubble ai-bubble" v-html="renderMd(msg.content)"></div>
          </div>
        </div>

        <!-- 流式输出中 -->
        <div v-if="sending" class="msg assistant">
          <!-- 流式工具调用 -->
          <div v-if="toolCalls.length" class="tool-calls">
            <div v-for="(tc, j) in toolCalls" :key="j" class="tool-card">
              <div class="tool-header">
                <span :class="['tool-status', tc.status === 'done' ? 'done' : 'running']">
                  {{ tc.status === 'done' ? '✅' : '⏳' }}
                </span>
                <span class="tool-name">{{ tc.name }}</span>
              </div>
              <div v-if="tc.args" class="tool-args">{{ JSON.stringify(tc.args) }}</div>
            </div>
          </div>

          <!-- 流式思考 -->
          <div v-if="streamingThinking" class="thinking-block">
            <details open>
              <summary>🧠 思考中...</summary>
              <div class="thinking-content">{{ streamingThinking }}</div>
            </details>
          </div>

          <!-- 流式正文 -->
          <div v-if="streamingContent" class="msg-bubble ai-bubble streaming" v-html="renderMd(streamingContent)"></div>
          <div v-if="!streamingContent && !streamingThinking && !toolCalls.length" class="typing-indicator">
            <span></span><span></span><span></span>
          </div>
        </div>
      </div>

      <!-- 输入区 -->
      <div class="chat-input-area">
        <!-- 附件 -->
        <div v-if="attachments.length" class="attachments">
          <div v-for="(a, i) in attachments" :key="i" class="attachment">
            📎 {{ a.name }} ({{ a.text.length }} 字)
            <button @click="attachments.splice(i, 1)">×</button>
          </div>
        </div>
        <div class="input-row">
          <button class="icon-btn" @click="uploadFile" title="上传文档"><Icon name="file" :size="18" /></button>
          <textarea
            v-model="inputText"
            @keydown="onKeydown"
            placeholder="输入消息... (Shift+Enter 换行,Enter 发送)"
            rows="1"
            :disabled="sending"
          ></textarea>
          <button class="send-btn" @click="sendMessage" :disabled="sending || (!inputText.trim() && !attachments.length)">
            {{ sending ? '⏳' : '▶' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-layout { display: flex; height: 100vh; overflow: hidden; }

/* 侧栏 */
.chat-sidebar { width: 260px; background: var(--bg-card); border-right: 1px solid var(--border); display: flex; flex-direction: column; flex-shrink: 0; }
.sidebar-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; border-bottom: 1px solid var(--border); font-weight: 600; font-size: 14px; }
.conv-list { flex: 1; overflow-y: auto; padding: 8px; }
.conv-item { padding: 10px 12px; border-radius: 8px; cursor: pointer; margin-bottom: 4px; position: relative; }
.conv-item:hover { background: var(--bg-card-hover); }
.conv-item.active { background: var(--accent-dim); border-left: 3px solid var(--accent); }
.conv-title { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 20px; }
.conv-meta { font-size: 11px; color: var(--text-dim); margin-top: 2px; }
.conv-del { position: absolute; right: 8px; top: 8px; background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 16px; padding: 2px 6px; border-radius: 4px; }
.conv-del:hover { background: var(--danger); color: #fff; }
.conv-empty { text-align: center; color: var(--text-dim); padding: 40px 16px; font-size: 13px; }

/* 主区域 */
.chat-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.chat-topbar { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--border); background: var(--bg-card); flex-shrink: 0; }
.topbar-title { flex: 1; font-weight: 600; font-size: 15px; }

/* 消息区 */
.chat-messages { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 16px; }

/* 空状态 */
.chat-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; gap: 12px; }
.empty-icon { font-size: 48px; }
.empty-title { font-size: 20px; font-weight: 700; }
.empty-desc { text-align: center; color: var(--text-dim); font-size: 14px; line-height: 1.8; }
.empty-examples { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; justify-content: center; }
.example-btn { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer; color: var(--text); }
.example-btn:hover { border-color: var(--accent); background: var(--accent-dim); }

/* 消息 */
.msg { max-width: 85%; }
.msg-user { display: flex; justify-content: flex-end; }
.msg-user .msg-bubble { max-width: 100%; }
.msg-assistant { max-width: 100%; }
.msg-bubble { padding: 12px 16px; border-radius: 12px; font-size: 14px; line-height: 1.8; }
.user-bubble { background: var(--accent); color: #fff; border-radius: 12px 12px 4px 12px; white-space: pre-wrap; }
.ai-bubble { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px 12px 12px 4px; }
.ai-bubble :deep(table) { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 12px; }
.ai-bubble :deep(th), .ai-bubble :deep(td) { border: 1px solid var(--border); padding: 6px 10px; text-align: left; }
.ai-bubble :deep(th) { background: var(--bg-card-hover); }
.ai-bubble :deep(h1), .ai-bubble :deep(h2), .ai-bubble :deep(h3) { color: var(--accent); margin: 12px 0 6px; }
.ai-bubble :deep(ul), .ai-bubble :deep(ol) { padding-left: 22px; margin: 6px 0; }
.ai-bubble :deep(li) { margin: 3px 0; }
.ai-bubble :deep(strong) { color: var(--text); }
.ai-bubble :deep(code) { background: var(--bg); padding: 2px 6px; border-radius: 4px; font-size: 12px; }
.ai-bubble :deep(pre) { background: var(--bg); padding: 12px; border-radius: 8px; overflow-x: auto; margin: 8px 0; }
.ai-bubble :deep(pre code) { padding: 0; background: none; }
.ai-bubble :deep(blockquote) { border-left: 3px solid var(--accent); padding-left: 12px; margin: 8px 0; color: var(--text-dim); }
.ai-bubble :deep(.katex-display) { margin: 12px 0; overflow-x: auto; }

/* 工具调用 */
.tool-calls { margin: 8px 0; display: flex; flex-direction: column; gap: 6px; }
.tool-card { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; font-size: 12px; }
.tool-header { display: flex; align-items: center; gap: 6px; }
.tool-status { font-size: 14px; }
.tool-name { font-weight: 600; color: var(--accent); }
.tool-args { color: var(--text-dim); font-size: 11px; margin-top: 4px; word-break: break-all; }

/* 思考内容 */
.thinking-block { margin: 8px 0; }
.thinking-block summary { cursor: pointer; color: var(--text-dim); font-size: 12px; user-select: none; padding: 4px 0; }
.thinking-content { margin-top: 6px; padding: 10px 12px; background: var(--bg); border-left: 3px solid var(--text-dim); border-radius: 4px; font-size: 12px; color: var(--text-dim); line-height: 1.7; white-space: pre-wrap; max-height: 300px; overflow-y: auto; }

/* 打字动画 */
.typing-indicator { display: flex; gap: 4px; padding: 12px 16px; }
.typing-indicator span { width: 8px; height: 8px; background: var(--text-dim); border-radius: 50%; animation: bounce 1.4s infinite ease-in-out; }
.typing-indicator span:nth-child(1) { animation-delay: 0s; }
.typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
.typing-indicator span:nth-child(3) { animation-delay: 0.4s; }
@keyframes bounce { 0%,80%,100% { transform: scale(0); } 40% { transform: scale(1); } }

/* 输入区 */
.chat-input-area { border-top: 1px solid var(--border); padding: 12px 16px; background: var(--bg-card); flex-shrink: 0; }
.attachments { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
.attachment { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 4px 10px; font-size: 12px; display: flex; align-items: center; gap: 6px; }
.attachment button { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 14px; }
.input-row { display: flex; align-items: flex-end; gap: 8px; }
.input-row textarea { flex: 1; background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 10px 14px; color: var(--text); font-size: 14px; resize: none; max-height: 120px; outline: none; font-family: inherit; line-height: 1.5; }
.input-row textarea:focus { border-color: var(--accent); }
.send-btn { width: 40px; height: 40px; border-radius: 50%; background: var(--accent); color: #fff; border: none; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.icon-btn { background: none; border: none; color: var(--text-dim); cursor: pointer; padding: 6px; border-radius: 6px; display: flex; align-items: center; }
.icon-btn:hover { background: var(--bg-card-hover); color: var(--text); }
</style>
