<script setup>
import { ref } from 'vue';
import Icon from './Icons.vue';

const props = defineProps({ settings: Object });
const codeA = ref('');
const codeB = ref('');
const loading = ref(false);
const error = ref('');
const bdA = ref(null);
const bdB = ref(null);

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

async function fetchBoth() {
  const a = extractShareCode(codeA.value);
  const b = extractShareCode(codeB.value);
  if (!a || !b) {
    error.value = '请输入两个分享码(可直接粘贴完整链接)';
    return;
  }
  loading.value = true;
  error.value = '';
  bdA.value = null;
  bdB.value = null;
  try {
    const [ra, rb] = await Promise.all([
      window.api.fetchBD(a),
      window.api.fetchBD(b),
    ]);
    if (!ra.ok) throw new Error('BD A: ' + ra.error);
    if (!rb.ok) throw new Error('BD B: ' + rb.error);
    bdA.value = ra.data;
    bdB.value = rb.data;
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function analyze() {
  if (!bdA.value || !bdB.value) {
    aiError.value = '请先查询两个 BD';
    return;
  }
  aiAnalyzing.value = true;
  aiError.value = '';
  aiResult.value = '';
  aiThinking.value = '';
  if (offChunk) offChunk();
  offChunk = window.api.onAiChunk((chunk) => {
    if (chunk.type === 'thinking') { aiThinking.value += chunk.text; }
    else { aiResult.value += chunk.text; }
  });
  try {
    // 只传 shareCode 字符串(避免 Vue Proxy 通过 IPC 克隆失败)
    const res = await window.api.analyzeAI({ scene: 'compare', shareCodeA: extractShareCode(codeA.value), shareCodeB: extractShareCode(codeB.value) });
    if (!res.ok) throw new Error(res.error);
    if (res.content?.length > aiResult.value.length) aiResult.value = res.content;
  } catch (e) {
    aiError.value = e.message;
  } finally {
    aiAnalyzing.value = false;
    if (offChunk) { offChunk(); offChunk = null; }
  }
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
    <h3>输入两个分享码对比</h3>
    <div class="row" style="margin-bottom: 8px;">
      <input type="text" v-model="codeA" placeholder="BD A 分享码" :disabled="loading" />
    </div>
    <div class="row">
      <input type="text" v-model="codeB" placeholder="BD B 分享码" :disabled="loading" />
      <button @click="fetchBoth" :disabled="loading">{{ loading ? '抓取中...' : '查询两个 BD' }}</button>
    </div>
    <div v-if="error" class="notice err"><Icon name="error" :size="14" /> {{ error }}</div>
  </div>

  <div v-if="bdA && bdB" class="card">
    <h3>对比概览</h3>
    <table class="cmp-table">
      <thead><tr><th>要素</th><th>BD A</th><th>BD B</th></tr></thead>
      <tbody>
        <tr><td>角色</td><td>{{ bdA.role?.name }} ({{ bdA.role?.class_name }} Lv{{ bdA.role?.level }})</td><td>{{ bdB.role?.name }} ({{ bdB.role?.class_name }} Lv{{ bdB.role?.level }})</td></tr>
        <tr><td>生命</td><td>{{ bdA.panel?.life }}</td><td>{{ bdB.panel?.life }}</td></tr>
        <tr><td>火抗</td><td>{{ bdA.panel?.fire_resistance }}%</td><td>{{ bdB.panel?.fire_resistance }}%</td></tr>
        <tr><td>冰抗</td><td>{{ bdA.panel?.cold_resistance }}%</td><td>{{ bdB.panel?.cold_resistance }}%</td></tr>
        <tr><td>雷抗</td><td>{{ bdA.panel?.lightning_resistance }}%</td><td>{{ bdB.panel?.lightning_resistance }}%</td></tr>
        <tr><td>护甲</td><td>{{ bdA.panel?.armour }}</td><td>{{ bdB.panel?.armour }}</td></tr>
        <tr><td>综合评分</td><td>{{ bdA.dimension?.score }}</td><td>{{ bdB.dimension?.score }}</td></tr>
        <tr><td>技能组数</td><td>{{ bdA.skillGroups?.length || '-' }}</td><td>{{ bdB.skillGroups?.length || '-' }}</td></tr>
      </tbody>
    </table>
  </div>

  <div v-if="bdA && bdB" class="card ai-card">
    <h3><Icon name="robot" :size="16" /> AI 对比分析</h3>
    <div v-if="!hasApi()" class="notice">未配置 API,无法自动分析。请在「AI 设置」配置后使用。</div>
    <button v-if="hasApi()" @click="analyze" :disabled="aiAnalyzing">{{ aiAnalyzing ? 'AI 分析中...' : '开始 AI 对比' }}</button>
    <div v-if="aiError" class="notice err"><Icon name="error" :size="14" /> {{ aiError }}</div>
    <div v-if="aiThinking" class="ai-thinking">
      <details open>
        <summary style="cursor:pointer;color:var(--text-dim);font-size:12px">🧠 AI 思考过程 ({{ aiThinking.length }} 字)</summary>
        <div class="ai-thinking-content">{{ aiThinking }}</div>
      </details>
    </div>
    <div v-if="aiResult" class="ai-result" v-html="renderMd(aiResult)"></div>
  </div>

  <div v-if="!bdA && !loading" class="empty">输入两个分享码,对比两份 BD 流派</div>
</template>

<style scoped>
.cmp-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.cmp-table th, .cmp-table td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; }
.cmp-table th { background: var(--bg-card-hover); color: var(--text-dim); font-weight: 600; }
.ai-card { border-left: 3px solid var(--accent); }
.ai-result { margin-top: 12px; padding: 14px; background: var(--bg); border-radius: 8px; font-size: 13px; line-height: 1.8; user-select: text; max-height: 500px; overflow-y: auto; }
.ai-result :deep(table) { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 12px; }
.ai-result :deep(th), .ai-result :deep(td) { border: 1px solid var(--border); padding: 5px 9px; text-align: left; }
.ai-result :deep(th) { background: var(--bg-card-hover); }
.ai-result :deep(h3), .ai-result :deep(h4) { color: var(--accent); margin: 12px 0 6px; }
.ai-result :deep(ul) { padding-left: 22px; }
</style>
