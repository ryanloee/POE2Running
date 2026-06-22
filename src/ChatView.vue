<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
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
  try { return marked.parse(md); } catch (_) { return md; }
}

function extractShareCode(input) {
  if (!input) return '';
  let s = input.trim();
  const m = s.match(/#\/share\/([A-Za-z0-9_\-]+)/);
  if (m) return m[1];
  return s.replace(/\s+/g, '');
}

// ===== 数据来源 =====
const myShareCode = ref('');
const myBd = ref(null);
const myBdLoading = ref(false);
const myBdError = ref('');

const targetMode = ref('none');
const targetShareCode = ref('');
const targetBd = ref(null);
const targetBdLoading = ref(false);
const targetBdError = ref('');
const targetDocName = ref('');
const targetDocText = ref('');

const contextText = computed(() => {
  let parts = [];
  if (myBd.value) {
    const role = myBd.value.role || {};
    const panel = myBd.value.panel || {};
    const eqList = (myBd.value.equipments || []).map((e) => `- [${e.slotName}] ${e.name ? e.name + ' ' : ''}${e.typeLine}`).join('\n');
    parts.push(`【当前分析角色】${role.name || ''} (${role.class_name || ''} Lv${role.level || ''})\n面板: 生命${panel.life||'-'} 火抗${panel.fire_resistance||'-'}% 冰抗${panel.cold_resistance||'-'}% 雷抗${panel.lightning_resistance||'-'}%\n装备:\n${eqList}`);
  }
  if (targetMode.value === 'bd' && targetBd.value) {
    const role = targetBd.value.role || {};
    parts.push(`【目标 BD】${role.name || ''} (${role.class_name || ''} Lv${role.level || ''})`);
  }
  if (targetMode.value === 'doc' && targetDocText.value) {
    parts.push(`【目标配装文档: ${targetDocName.value}】\n${targetDocText.value.slice(0, 3000)}`);
  }
  return parts.join('\n\n');
});

async function fetchMyBD() {
  const code = extractShareCode(myShareCode.value);
  if (!code) { myBdError.value = '请输入分享码'; return; }
  myBdLoading.value = true; myBdError.value = ''; myBd.value = null;
  try {
    const res = await window.api.fetchBD(code);
    if (!res.ok) throw new Error(res.error);
    myBd.value = res.data;
  } catch (e) { myBdError.value = e.message; }
  finally { myBdLoading.value = false; }
}

async function fetchTargetBD() {
  const code = extractShareCode(targetShareCode.value);
  if (!code) { targetBdError.value = '请输入分享码'; return; }
  targetBdLoading.value = true; targetBdError.value = ''; targetBd.value = null;
  try {
    const res = await window.api.fetchBD(code);
    if (!res.ok) throw new Error(res.error);
    targetBd.value = res.data;
  } catch (e) { targetBdError.value = e.message; }
  finally { targetBdLoading.value = false; }
}

async function uploadTargetDoc() {
  const res = await window.api.openFile();
  if (!res.ok) return;
  const parsed = await window.api.parseDoc(res.filePath);
  if (!parsed.ok) { targetBdError.value = '解析失败: ' + parsed.error; return; }
  targetDocName.value = res.filePath.split(/[\\/]/).pop();
  targetDocText.value = parsed.data.text;
  targetMode.value = 'doc';
  targetBdError.value = '';
}

// ===== 对话 =====
const conversations = ref([]);
const currentConvId = ref(null);
const messages = ref([]);
const inputText = ref('');
const sending = ref(false);
const drawerOpen = ref(false);
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
  drawerOpen.value = false;
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
      context: contextText.value || undefined,
    });
    messages.value.push({
      role: 'assistant',
      content: res.ok ? res.content : ('❌ ' + res.error),
      thinking: streamingThinking.value || undefined,
      toolCalls: toolCalls.value.length ? [...toolCalls.value] : undefined,
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
</script>

<template>
  <div class="poe-chat">
    <!-- 侧边栏遮罩 -->
    <div v-if="drawerOpen" class="drawer-mask" @click="drawerOpen = false"></div>

    <!-- 侧边栏浮层 -->
    <aside class="drawer" :class="{ open: drawerOpen }">
      <!-- 头部 -->
      <div class="drawer-head">
        <span class="drawer-brand">⚔ POE2 配装助手</span>
        <button class="drawer-close" @click="drawerOpen = false">✕</button>
      </div>

      <!-- 数据来源 -->
      <section class="drawer-section">
        <h4 class="ds-title">⚙ 数据来源</h4>

        <div class="ds-block">
          <div class="ds-label">📌 我的 BD</div>
          <div class="ds-input-row">
            <input v-model="myShareCode" placeholder="分享码或链接" class="ds-input" @keyup.enter="fetchMyBD" />
            <button class="ds-go" @click="fetchMyBD" :disabled="myBdLoading">{{ myBdLoading ? '⏳' : '查询' }}</button>
          </div>
          <div v-if="myBd" class="ds-ok">✅ {{ myBd.role?.name }} · {{ myBd.role?.class_name }} Lv{{ myBd.role?.level }}</div>
          <div v-if="myBdError" class="ds-err">{{ myBdError }}</div>
        </div>

        <div class="ds-block">
          <div class="ds-label">🎯 对比目标</div>
          <div class="seg">
            <button :class="['seg-btn', targetMode === 'none' && 'on']" @click="targetMode = 'none'">无</button>
            <button :class="['seg-btn', targetMode === 'bd' && 'on']" @click="targetMode = 'bd'">目标BD</button>
            <button :class="['seg-btn', targetMode === 'doc' && 'on']" @click="targetMode = 'doc'">文档</button>
          </div>
          <div v-if="targetMode === 'bd'" class="ds-input-row">
            <input v-model="targetShareCode" placeholder="目标BD分享码" class="ds-input" @keyup.enter="fetchTargetBD" />
            <button class="ds-go" @click="fetchTargetBD" :disabled="targetBdLoading">{{ targetBdLoading ? '⏳' : '查询' }}</button>
          </div>
          <div v-if="targetMode === 'bd' && targetBd" class="ds-ok">✅ {{ targetBd.role?.name }} · {{ targetBd.role?.class_name }} Lv{{ targetBd.role?.level }}</div>
          <div v-if="targetMode === 'doc'">
            <button class="ds-upload" @click="uploadTargetDoc">📎 选择文档</button>
            <div v-if="targetDocName" class="ds-ok">✅ {{ targetDocName }}</div>
          </div>
          <div v-if="targetBdError" class="ds-err">{{ targetBdError }}</div>
        </div>

        <!-- 已加载标签 -->
        <div v-if="myBd || (targetMode !== 'none')" class="ctx-tags">
          <span v-if="myBd" class="ctx-tag">📌 {{ myBd.role?.name }}</span>
          <span v-if="targetMode === 'bd' && targetBd" class="ctx-tag">🎯 {{ targetBd.role?.name }}</span>
          <span v-if="targetMode === 'doc' && targetDocName" class="ctx-tag">📄 {{ targetDocName }}</span>
        </div>
      </section>

      <!-- 对话历史 -->
      <section class="drawer-section flex-grow">
        <div class="ds-title-row">
          <h4 class="ds-title">💬 历史</h4>
          <button class="ds-new" @click="newConversation">＋</button>
        </div>
        <div class="conv-scroll">
          <div v-for="c in conversations" :key="c.id" :class="['conv', currentConvId === c.id && 'active']" @click="switchConversation(c.id)">
            <span class="conv-name">{{ c.title }}</span>
            <button class="conv-x" @click.stop="deleteConv(c.id)">×</button>
          </div>
          <div v-if="!conversations.length" class="conv-empty">暂无对话</div>
        </div>
      </section>
    </aside>

    <!-- 消息区（纯对话,占据全部高度,内部滚动） -->
    <main class="messages" ref="messagesEl">
      <!-- 空状态 -->
      <div v-if="!messages.length && !sending" class="welcome">
        <div class="welcome-icon">⚔</div>
        <h2>POE2 BD 智能配装</h2>
        <p>点底部 <strong>☰</strong> 配置 BD 和对比目标，然后直接提问。<br>也可以不配 BD，直接问任何游戏问题。</p>
        <div class="welcome-actions">
          <button class="wa-btn" @click="drawerOpen = true">⚙ 配置数据来源</button>
          <button class="wa-btn ghost" @click="inputText = '帮我查一下火抗词缀最高能到多少'; sendMessage()">📚 查知识库</button>
          <button class="wa-btn ghost" @click="inputText = '帮我搜一下便宜的火抗胸甲'; sendMessage()">🛒 搜市集</button>
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
              <span class="tool-icon">{{ tc.status === 'done' ? '✅' : '⏳' }}</span>
              <span class="tool-name">{{ tc.name }}</span>
              <span v-if="tc.args" class="tool-args">{{ JSON.stringify(tc.args).slice(0, 60) }}</span>
            </div>
          </div>
          <details v-if="msg.thinking" class="think">
            <summary>🧠 思考过程</summary>
            <div class="think-body">{{ msg.thinking }}</div>
          </details>
          <div class="bubble ai-bubble" v-html="renderMd(msg.content)"></div>
        </div>
      </template>

      <!-- 流式输出 -->
      <div v-if="sending" class="bubble-row ai">
        <div v-if="toolCalls.length" class="tools">
          <div v-for="(tc, j) in toolCalls" :key="j" class="tool">
            <span class="tool-icon">{{ tc.status === 'done' ? '✅' : '⏳' }}</span>
            <span class="tool-name">{{ tc.name }}</span>
            <span v-if="tc.args" class="tool-args">{{ JSON.stringify(tc.args).slice(0, 60) }}</span>
          </div>
        </div>
        <details v-if="streamingThinking" class="think" open>
          <summary>🧠 思考中...</summary>
          <div class="think-body">{{ streamingThinking }}</div>
        </details>
        <div v-if="streamingContent" class="bubble ai-bubble" v-html="renderMd(streamingContent)"></div>
        <div v-if="!streamingContent && !streamingThinking && !toolCalls.length" class="typing"><span></span><span></span><span></span></div>
      </div>
    </main>

    <!-- 输入栏（菜单按钮在此） -->
    <footer class="input-bar">
      <button class="menu-btn" @click="drawerOpen = true" title="数据来源 / 历史">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
      <textarea v-model="inputText" @keydown="onKeydown" placeholder="输入消息... (Enter 发送)" rows="1" :disabled="sending"></textarea>
      <button class="send" @click="sendMessage" :disabled="sending || !inputText.trim()">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>
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

/* ===== 侧边栏浮层 ===== */
.drawer-mask {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5);
  z-index: 40; backdrop-filter: blur(2px);
}
.drawer {
  position: fixed; top: 0; left: 0; bottom: 0; width: 300px;
  background: var(--bg-elev); border-right: 1px solid var(--border-lit);
  z-index: 50; transform: translateX(-100%);
  transition: transform .25s ease; display: flex; flex-direction: column;
  box-shadow: 4px 0 30px rgba(0,0,0,0.4);
}
.drawer.open { transform: translateX(0); }

/* 侧边栏头部 */
.drawer-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 1px solid var(--gold-dim);
}
.drawer-brand { font-size: 14px; font-weight: 700; color: var(--gold); letter-spacing: .5px; }
.drawer-close {
  background: none; border: none; color: var(--text-dim);
  font-size: 16px; cursor: pointer; padding: 4px 8px; border-radius: 4px;
}
.drawer-close:hover { color: var(--text); background: var(--bg-hover); }

.drawer-section { border-bottom: 1px solid var(--border); }
.drawer-section.flex-grow { flex: 1; display: flex; flex-direction: column; border-bottom: none; overflow: hidden; }

.ds-title { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--gold); padding: 14px 16px 8px; font-weight: 700; }
.ds-title-row { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 8px; }
.ds-new { background: none; border: 1px solid var(--border); color: var(--gold); width: 26px; height: 26px; border-radius: 6px; cursor: pointer; font-size: 16px; }
.ds-new:hover { border-color: var(--gold); background: var(--gold-glow); }

.ds-block { padding: 0 16px 14px; }
.ds-label { font-size: 12px; color: var(--text-dim); margin-bottom: 6px; font-weight: 600; }
.ds-input-row { display: flex; gap: 6px; }
.ds-input {
  flex: 1; background: var(--bg); border: 1px solid var(--border);
  border-radius: 6px; padding: 7px 10px; color: var(--text);
  font-size: 12px; outline: none; transition: border-color .15s;
}
.ds-input:focus { border-color: var(--gold); box-shadow: 0 0 0 2px var(--gold-glow); }
.ds-go {
  background: var(--gold-dim); color: var(--text); border: none;
  border-radius: 6px; padding: 7px 14px; font-size: 12px;
  cursor: pointer; white-space: nowrap; font-weight: 600;
}
.ds-go:hover:not(:disabled) { background: var(--gold); color: var(--bg); }
.ds-go:disabled { opacity: .4; }
.ds-ok { margin-top: 6px; font-size: 12px; color: var(--success); }
.ds-err { margin-top: 6px; font-size: 12px; color: var(--danger); }
.ds-upload {
  width: 100%; background: var(--bg); border: 1px dashed var(--border-lit);
  border-radius: 6px; padding: 8px; font-size: 12px; cursor: pointer;
  color: var(--text-dim); transition: all .15s;
}
.ds-upload:hover { border-color: var(--gold); color: var(--gold); }

/* 已加载标签（侧边栏内） */
.ctx-tags { display: flex; gap: 6px; flex-wrap: wrap; padding: 0 16px 14px; }
.ctx-tag {
  background: var(--gold-glow); border: 1px solid var(--gold-dim);
  border-radius: 12px; padding: 3px 10px; font-size: 11px;
  color: var(--gold); white-space: nowrap;
}

/* 分段控件 */
.seg { display: flex; gap: 0; margin-bottom: 8px; background: var(--bg); border-radius: 6px; padding: 2px; }
.seg-btn {
  flex: 1; background: none; border: none; color: var(--text-dim);
  padding: 5px; font-size: 11px; cursor: pointer; border-radius: 4px;
  font-weight: 600; transition: all .15s;
}
.seg-btn.on { background: var(--gold-dim); color: var(--text); }
.seg-btn:hover:not(.on) { color: var(--text); }

/* 对话历史列表 */
.conv-scroll { flex: 1; overflow-y: auto; padding: 0 8px 8px; }
.conv {
  padding: 9px 12px; border-radius: 6px; cursor: pointer;
  margin-bottom: 2px; display: flex; align-items: center;
  justify-content: space-between; transition: background .1s;
}
.conv:hover { background: var(--bg-hover); }
.conv.active { background: var(--gold-glow); border-left: 2px solid var(--gold); }
.conv-name { font-size: 13px; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.conv-x { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 14px; padding: 0 4px; opacity: 0; transition: opacity .1s; }
.conv:hover .conv-x { opacity: 1; }
.conv-x:hover { color: var(--danger); }
.conv-empty { text-align: center; color: var(--text-dim); padding: 30px; font-size: 13px; }

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
.bubble { padding: 12px 16px; border-radius: 14px; font-size: 14px; line-height: 1.8; }
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

/* ===== 输入栏 ===== */
.input-bar {
  display: flex; align-items: flex-end; gap: 10px;
  padding: 12px 18px; background: var(--bg-elev);
  border-top: 1px solid var(--border); flex-shrink: 0;
}
.menu-btn {
  background: none; border: 1px solid var(--border); color: var(--text-dim);
  border-radius: 10px; width: 42px; height: 42px; cursor: pointer;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  transition: all .15s;
}
.menu-btn:hover { border-color: var(--gold); color: var(--gold); background: var(--gold-glow); }
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
