<script setup>
import { ref } from 'vue';
import Icon from './Icons.vue';

const props = defineProps({ settings: Object });
const shareCode = ref('');
const bd = ref(null);
const loading = ref(false);
const error = ref('');

const filePath = ref('');
const fileName = ref('');
const docText = ref('');
const docInfo = ref('');
const parsing = ref(false);

const aiAnalyzing = ref(false);
const aiResult = ref('');
const aiThinking = ref('');
const aiError = ref('');
let offChunk = null;

const hasApi = () => props.settings?.apiKey && props.settings?.apiModel;

function extractShareCode(input) {
  if (!input) return '';
  let s = input.trim();
  const m = s.match(/#\/share\/([A-Za-z0-9_\-]+)/);
  if (m) return m[1];
  return s.replace(/\s+/g, '');
}

async function fetchBD() {
  const code = extractShareCode(shareCode.value);
  if (!code) { error.value = '请输入分享码(可直接粘贴完整链接)'; return; }
  loading.value = true; error.value = ''; bd.value = null;
  try {
    const res = await window.api.fetchBD(code);
    if (!res.ok) throw new Error(res.error);
    bd.value = res.data;
  } catch (e) { error.value = e.message; }
  finally { loading.value = false; }
}

async function pickFile() {
  const res = await window.api.openFile();
  if (!res.ok) return;
  filePath.value = res.filePath;
  fileName.value = res.filePath.split(/[\\/]/).pop();
  docInfo.value = '解析中...';
  parsing.value = true;
  try {
    const r = await window.api.parseDoc(res.filePath);
    if (!r.ok) throw new Error(r.error);
    docText.value = r.data.text;
    docInfo.value = `${fileName.value} (${r.data.text.length} 字符${r.data.images.length ? ', 含' + r.data.images.length + '图' : ''})`;
  } catch (e) {
    docInfo.value = ''; error.value = '文档解析失败: ' + e.message;
  } finally { parsing.value = false; }
}

async function analyze() {
  if (!bd.value) { aiError.value = '请先查询角色分享码'; return; }
  if (!docText.value) { aiError.value = '请先上传并解析目标文档'; return; }
  aiAnalyzing.value = true; aiError.value = ''; aiResult.value = ''; aiThinking.value = '';
  if (offChunk) offChunk();
  offChunk = window.api.onAiChunk((chunk) => {
    if (chunk.type === 'thinking') { aiThinking.value += chunk.text; }
    else { aiResult.value += chunk.text; }
  });
  try {
    // 只传 shareCode 字符串 + docText 字符串(避免 Vue Proxy 通过 IPC 克隆失败)
    const res = await window.api.analyzeAI({ scene: 'doc', shareCode: extractShareCode(shareCode.value), docText: docText.value });
    if (!res.ok) throw new Error(res.error);
    if (res.content?.length > aiResult.value.length) aiResult.value = res.content;
  } catch (e) { aiError.value = e.message; }
  finally { aiAnalyzing.value = false; if (offChunk) { offChunk(); offChunk = null; } }
}

function renderMd(md) {
  if (!md) return '';
  let html = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  html = html.replace(/^\|(.+)\|\n\|[-:\s|]+\|\n((?:\|.+\|\n?)+)/gm, (m, header, rows) => {
    const h = header.split('|').filter((s) => s.trim()).map((s) => `<th>${s.trim()}</th>`).join('');
    const r = rows.trim().split('\n').map((row) => '<tr>' + row.split('|').filter((s) => s.trim()).map((c) => `<td>${c.trim()}</td>`).join('') + '</tr>').join('');
    return `<table><thead><tr>${h}</tr></thead><tbody>${r}</tbody></table>`;
  });
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>').replace(/^## (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>').replace(/(<li>[\s\S]+?<\/li>)/g, '<ul>$1</ul>');
  return html.replace(/\n{2,}/g, '<br><br>');
}
</script>

<template>
  <div class="card">
    <h3>① 你的角色分享码</h3>
    <div class="row">
      <input type="text" v-model="shareCode" placeholder="粘贴分享码" @keyup.enter="fetchBD" :disabled="loading" />
      <button @click="fetchBD" :disabled="loading">{{ loading ? '抓取中...' : '查询' }}</button>
    </div>
    <div v-if="bd" class="notice" style="color:var(--success);border-color:var(--success)"><Icon name="check" :size="14" /> 已加载 {{ bd.role?.name }} ({{ bd.role?.class_name }} Lv{{ bd.role?.level }})</div>
    <div v-if="error" class="notice err"><Icon name="error" :size="14" /> {{ error }}</div>
  </div>

  <div class="card">
    <h3>② 上传目标 BD 文档(攻略/配装方案)</h3>
    <div class="row">
      <input type="text" :value="fileName" placeholder="未选择文件" readonly />
      <button class="secondary" @click="pickFile" :disabled="parsing">选择文件</button>
    </div>
    <div class="notice" style="margin-top:8px">支持 Word(.docx)、PPT(.pptx)、TXT/Markdown、图片</div>
    <div v-if="docInfo" class="notice">{{ docInfo }}</div>
    <div v-if="docText" style="margin-top:10px">
      <details><summary style="cursor:pointer;color:var(--text-dim);font-size:12px">查看解析内容</summary>
        <pre style="white-space:pre-wrap;font-size:11px;color:var(--text-dim);max-height:180px;overflow:auto;background:var(--bg);padding:10px;border-radius:6px;margin-top:6px">{{ docText.slice(0,1500) }}{{ docText.length>1500 ? '\n...(截断)' : '' }}</pre>
      </details>
    </div>
  </div>

  <div class="card ai-card">
    <h3>③ AI 逐条对比</h3>
    <div v-if="!hasApi()" class="notice">未配置 API,无法自动分析。请先在「AI 设置」配置。</div>
    <button v-if="hasApi()" @click="analyze" :disabled="aiAnalyzing || !bd || !docText">{{ aiAnalyzing ? 'AI 分析中...' : '开始对比' }}</button>
    <div v-if="aiError" class="notice err"><Icon name="error" :size="14" /> {{ aiError }}</div>
    <div v-if="aiThinking" class="ai-thinking">
      <details open>
        <summary style="cursor:pointer;color:var(--text-dim);font-size:12px">🧠 AI 思考过程 ({{ aiThinking.length }} 字)</summary>
        <div class="ai-thinking-content">{{ aiThinking }}</div>
      </details>
    </div>
    <div v-if="aiResult" class="ai-result" v-html="renderMd(aiResult)"></div>
  </div>

  <div v-if="!bd && !loading" class="empty">输入分享码 + 上传攻略文档,AI 帮你对比找差距</div>
</template>

<style scoped>
.ai-card { border-left: 3px solid var(--accent); }
.ai-result { margin-top: 12px; padding: 14px; background: var(--bg); border-radius: 8px; font-size: 13px; line-height: 1.8; user-select: text; max-height: 500px; overflow-y: auto; }
.ai-result :deep(table) { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 12px; }
.ai-result :deep(th), .ai-result :deep(td) { border: 1px solid var(--border); padding: 5px 9px; text-align: left; }
.ai-result :deep(th) { background: var(--bg-card-hover); }
.ai-result :deep(h3), .ai-result :deep(h4) { color: var(--accent); margin: 12px 0 6px; }
.ai-result :deep(ul) { padding-left: 22px; }
</style>
