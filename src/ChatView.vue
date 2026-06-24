<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import Icon from './Icons.vue';

// 接收父组件传入的 BD 上下文文本
const props = defineProps({
  contextText: { type: String, default: '' },
});

import { Marked } from 'marked';
import markedKatex from 'marked-katex-extension';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.min.css';
import 'katex/dist/katex.min.css';

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
  try {
    let html = marked.parse(md);
    // 所有外部链接在新窗口打开(市集购买链接等)
    html = html.replace(/<a\s+href=/g, '<a target="_blank" rel="noopener noreferrer" href=');
    return html;
  } catch (_) { return md; }
}

// ===== 对话 =====
const conversations = ref([]);
const currentConvId = ref(null);
const messages = ref([]);
const inputText = ref('');
const sending = ref(false);
const toolCalls = ref([]);
const streamingThinking = ref('');
const streamingContent = ref('');

let offChunk = null;
let offTool = null;

const messagesEl = ref(null);
function scrollToBottom() {
  nextTick(() => { if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight; });
}

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
  if (currentConvId.value === id) { currentConvId.value = null; messages.value = []; }
  await loadConversations();
}

async function sendMessage() {
  const text = inputText.value.trim();
  if (!text || sending.value) return;
  if (!currentConvId.value) await newConversation();

  messages.value.push({ role: 'user', content: text, timestamp: new Date().toISOString() });
  inputText.value = '';
  sending.value = true;
  toolCalls.value = [];
  streamingThinking.value = '';
  streamingContent.value = '';
  scrollToBottom();

  if (offChunk) offChunk();
  if (offTool) offTool();
  offChunk = window.api.onAgentChunk((chunk) => {
    if (chunk.type === 'thinking') streamingThinking.value += chunk.text;
    else streamingContent.value += chunk.text;
    scrollToBottom();
  });
  offTool = window.api.onAgentTool((info) => {
    if (info.stage === 'start') toolCalls.value.push({ name: info.name, args: info.args, status: 'running' });
    else if (info.stage === 'done') {
      const tc = toolCalls.value.find((t) => t.name === info.name && t.status === 'running');
      if (tc) { tc.status = 'done'; }
    }
    scrollToBottom();
  });

  try {
    const res = await window.api.agentChat({
      conversationId: currentConvId.value,
      message: text,
      context: props.contextText || undefined,
    });
    messages.value.push({
      role: 'assistant',
      content: res.ok ? res.content : ('❌ ' + res.error),
      thinking: streamingThinking.value || undefined,
      toolCalls: toolCalls.value.length ? [...toolCalls.value] : undefined,
      recommendations: res.ok ? res.recommendations : undefined,
      timestamp: new Date().toISOString(),
    });
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

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

onMounted(async () => {
  await loadConversations();
  if (conversations.value.length > 0) await switchConversation(conversations.value[0].id);
});
onUnmounted(() => { if (offChunk) offChunk(); if (offTool) offTool(); });

// 快捷按钮:点击后根据推荐内容发送搜索或分析指令
function quickAction(rec) {
  let msg;
  if (rec.type) {
    // 有 type → 触发市集搜索
    msg = `帮我搜便宜的${rec.type}${rec.intent ? '，要' + rec.intent + '词缀' : ''}，列出5个候选并给出购买链接`;
  } else {
    // 无 type → 深入分析
    msg = rec.label === '深入分析' ? '请进一步深入分析我的 BD，给出更详细的改进方向' : rec.label;
  }
  inputText.value = msg;
  sendMessage();
}

// 暴露对话管理方法给父组件(App.vue 弹窗用)
defineExpose({
  conversations, currentConvId,
  newConversation, switchConversation, deleteConv,
  sendCustomMessage: (text) => { inputText.value = text; sendMessage(); },
});
</script>

<template>
  <div class="poe-chat">
    <!-- 消息区（纯对话,占据全部高度,内部滚动） -->
    <main class="messages" ref="messagesEl">
      <!-- 空状态 -->
      <div v-if="!messages.length && !sending" class="welcome">
        <div class="welcome-icon"><Icon name="sword" :size="48" /></div>
        <h2>POE2 BD 智能配装</h2>
        <p>已自动加载你的 BD。直接提问即可,或点顶栏 <strong>BD 比对</strong> 配置对比目标。<br>先对比分析差距,再推荐装备!</p>
        <div class="welcome-actions">
          <button class="wa-btn ghost" @click="inputText = '帮我查一下火抗词缀最高能到多少'; sendMessage()"><Icon name="book" :size="14" /> 查知识库</button>
          <button class="wa-btn ghost" @click="inputText = '帮我搜一下便宜的火抗胸甲'; sendMessage()"><Icon name="shopping" :size="14" /> 搜市集</button>
        </div>
      </div>

      <!-- 消息列表 -->
      <template v-for="(msg, i) in messages" :key="i">
        <div v-if="msg.role === 'user'" class="bubble-row user">
          <div class="bubble user-bubble">{{ msg.content }}</div>
        </div>
        <div v-else-if="msg.role === 'assistant'" class="bubble-row ai">
          <div v-if="msg.toolCalls?.length" class="tools">
            <div v-for="(tc, j) in msg.toolCalls" :key="j" class="tool">
              <span class="tool-icon"><Icon :name="tc.status === 'done' ? 'check' : 'refresh'" :size="12" /></span>
              <span class="tool-name">{{ tc.name }}</span>
              <span v-if="tc.args" class="tool-args">{{ JSON.stringify(tc.args).slice(0, 60) }}</span>
            </div>
          </div>
          <details v-if="msg.thinking" class="think">
            <summary>思考过程</summary>
            <div class="think-body">{{ msg.thinking }}</div>
          </details>
          <div class="bubble ai-bubble" v-html="renderMd(msg.content)"></div>
          <!-- 智能推荐按钮:只在最后一条 AI 消息且非发送中时显示 -->
          <div v-if="!sending && i === messages.length - 1 && msg.recommendations?.length" class="quick-actions">
            <button v-for="(rec, k) in msg.recommendations" :key="k" class="qa-btn" @click="quickAction(rec)">
              <Icon :name="rec.type ? 'shopping' : 'compare'" :size="13" /> {{ rec.label }}
            </button>
          </div>
        </div>
      </template>

      <!-- 流式输出 -->
      <div v-if="sending" class="bubble-row ai">
        <div v-if="toolCalls.length" class="tools">
          <div v-for="(tc, j) in toolCalls" :key="j" class="tool">
            <span class="tool-icon"><Icon :name="tc.status === 'done' ? 'check' : 'refresh'" :size="12" /></span>
            <span class="tool-name">{{ tc.name }}</span>
            <span v-if="tc.args" class="tool-args">{{ JSON.stringify(tc.args).slice(0, 60) }}</span>
          </div>
        </div>
        <details v-if="streamingThinking" class="think" open>
          <summary>思考中...</summary>
          <div class="think-body">{{ streamingThinking }}</div>
        </details>
        <div v-if="streamingContent" class="bubble ai-bubble" v-html="renderMd(streamingContent)"></div>
        <div v-if="!streamingContent && !streamingThinking && !toolCalls.length" class="typing"><span></span><span></span><span></span></div>
      </div>
    </main>

    <!-- 输入栏 -->
    <footer class="input-bar">
      <textarea v-model="inputText" @keydown="onKeydown" placeholder="输入消息... (Enter 发送)" rows="1" :disabled="sending"></textarea>
      <button class="send" @click="sendMessage" :disabled="sending || !inputText.trim()" title="发送">
        <Icon name="send" :size="18" />
      </button>
    </footer>
  </div>
</template>

<style scoped>
/* ===== POE 暗金配色 ===== */
.poe-chat {
  --bg: #0a0c12;
  --bg-elev: #12151c;
  --bg-hover: #1a1e28;
  --border: #232836;
  --border-lit: #2d3344;
  --text: #e8e6e0;
  --text-dim: #7a7368;
  --gold: #c8a44e;
  --gold-dim: #8a6f30;
  --gold-glow: rgba(200,164,78,0.12);
  --danger: #c44040;
  --success: #5a9e5a;

  display: flex; flex-direction: column;
  height: 100%; background: var(--bg);
  color: var(--text); overflow: hidden;
}

/* 自定义滚动条 */
.poe-chat ::-webkit-scrollbar { width: 6px; }
.poe-chat ::-webkit-scrollbar-track { background: transparent; }
.poe-chat ::-webkit-scrollbar-thumb { background: var(--gold-dim); border-radius: 3px; }
.poe-chat ::-webkit-scrollbar-thumb:hover { background: var(--gold); }

/* ===== 消息区 ===== */
.messages { flex: 1; overflow-y: auto; padding: 24px 20px; display: flex; flex-direction: column; gap: 18px; }

/* 欢迎页 */
.welcome { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; gap: 10px; text-align: center; }
.welcome-icon { font-size: 52px; color: var(--gold); filter: drop-shadow(0 0 20px var(--gold-glow)); }
.welcome h2 { font-size: 22px; font-weight: 700; color: var(--text); }
.welcome p { color: var(--text-dim); font-size: 14px; line-height: 1.8; max-width: 380px; }
.welcome-actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; justify-content: center; }
.wa-btn {
  background: var(--gold-dim); color: var(--text); border: 1px solid var(--gold-dim);
  border-radius: 8px; padding: 9px 16px; font-size: 13px; cursor: pointer;
  font-weight: 600; transition: all .15s;
}
.wa-btn:hover { background: var(--gold); color: var(--bg); }
.wa-btn.ghost { background: transparent; color: var(--text-dim); border-color: var(--border-lit); }
.wa-btn.ghost:hover { border-color: var(--gold); color: var(--gold); background: var(--gold-glow); }

/* 消息气泡 */
.bubble-row { display: flex; max-width: 100%; }
.bubble-row.user { justify-content: flex-end; }
.bubble-row.ai { justify-content: flex-start; flex-direction: column; align-items: flex-start; gap: 8px; max-width: 85%; }
.bubble { padding: 12px 16px; border-radius: 14px; font-size: 14px; line-height: 1.8; user-select: text; }
.user-bubble {
  background: linear-gradient(135deg, var(--gold-dim), var(--gold));
  color: #1a1208; border-radius: 14px 14px 4px 14px;
  max-width: 70%; white-space: pre-wrap; font-weight: 500;
}
.ai-bubble {
  background: var(--bg-elev); border: 1px solid var(--border);
  border-left: 2px solid var(--gold-dim); border-radius: 4px 14px 14px 14px;
  max-width: 100%;
}
.ai-bubble :deep(table) { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 12px; }
.ai-bubble :deep(th), .ai-bubble :deep(td) { border: 1px solid var(--border); padding: 6px 10px; text-align: left; }
.ai-bubble :deep(th) { background: var(--bg-hover); color: var(--gold); }
.ai-bubble :deep(h1), .ai-bubble :deep(h2), .ai-bubble :deep(h3) { color: var(--gold); margin: 14px 0 6px; font-size: 15px; }
.ai-bubble :deep(ul), .ai-bubble :deep(ol) { padding-left: 22px; margin: 6px 0; }
.ai-bubble :deep(li) { margin: 3px 0; }
.ai-bubble :deep(strong) { color: var(--gold); }
.ai-bubble :deep(code) { background: var(--bg); padding: 2px 6px; border-radius: 4px; font-size: 12px; color: var(--gold); }
.ai-bubble :deep(pre) { background: var(--bg); padding: 12px; border-radius: 8px; overflow-x: auto; margin: 8px 0; }
.ai-bubble :deep(pre code) { padding: 0; color: var(--text); }
.ai-bubble :deep(blockquote) { border-left: 3px solid var(--gold-dim); padding-left: 12px; margin: 8px 0; color: var(--text-dim); }
.ai-bubble :deep(.katex-display) { margin: 12px 0; overflow-x: auto; }

/* 工具调用 */
.tools { display: flex; flex-direction: column; gap: 4px; width: 100%; }
.tool {
  display: flex; align-items: center; gap: 8px;
  background: var(--bg); border: 1px solid var(--border);
  border-radius: 6px; padding: 6px 10px; font-size: 12px;
}
.tool-icon { font-size: 13px; }
.tool-name { color: var(--gold); font-weight: 600; white-space: nowrap; }
.tool-args { color: var(--text-dim); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 思考折叠 */
.think { width: 100%; }
.think summary { cursor: pointer; color: var(--text-dim); font-size: 12px; user-select: none; padding: 4px 0; }
.think summary:hover { color: var(--gold); }
.think-body {
  padding: 10px 12px; background: var(--bg);
  border-left: 2px solid var(--gold-dim); border-radius: 4px;
  font-size: 12px; color: var(--text-dim); line-height: 1.7;
  white-space: pre-wrap; max-height: 280px; overflow-y: auto;
}

/* 打字动画 */
.typing { display: flex; gap: 5px; padding: 14px 18px; }
.typing span {
  width: 8px; height: 8px; background: var(--gold-dim);
  border-radius: 50%; animation: blink 1.4s infinite ease-in-out;
}
.typing span:nth-child(2) { animation-delay: .2s; }
.typing span:nth-child(3) { animation-delay: .4s; }
@keyframes blink { 0%,80%,100% { opacity: .2; transform: scale(.8); } 40% { opacity: 1; transform: scale(1); } }

/* ===== 快捷操作按钮(跟在 AI 消息后面) ===== */
.quick-actions {
  display: flex; flex-wrap: wrap; gap: 8px;
  margin-top: 10px; padding: 0;
  max-width: 100%;
}
.qa-btn {
  display: flex; align-items: center; gap: 5px;
  padding: 6px 12px; white-space: nowrap;
  background: var(--bg); border: 1px solid var(--border-lit);
  border-radius: 14px; color: var(--text-dim);
  font-size: 12px; cursor: pointer;
  transition: all .15s;
}
.qa-btn:hover {
  border-color: var(--gold); color: var(--gold);
  background: var(--gold-glow);
}

/* ===== 输入栏 ===== */
.input-bar {
  display: flex; align-items: flex-end; gap: 10px;
  padding: 12px 18px; background: var(--bg-elev);
  border-top: 1px solid var(--border); flex-shrink: 0;
}
.input-bar textarea {
  flex: 1; background: var(--bg); border: 1px solid var(--border);
  border-radius: 12px; padding: 11px 16px; color: var(--text);
  font-size: 14px; resize: none; max-height: 120px; outline: none;
  font-family: inherit; line-height: 1.5; transition: border-color .15s;
}
.input-bar textarea:focus { border-color: var(--gold); box-shadow: 0 0 0 2px var(--gold-glow); }
.send {
  width: 42px; height: 42px; border-radius: 50%;
  background: var(--gold); color: var(--bg); border: none;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; transition: all .15s;
}
.send:hover:not(:disabled) { box-shadow: 0 0 12px var(--gold-glow); }
.send:disabled { opacity: .3; cursor: not-allowed; }
</style>
