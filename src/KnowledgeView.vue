<script setup>
import { ref, onMounted } from 'vue';
import Icon from './Icons.vue';

const props = defineProps({ settings: Object });

const status = ref(null);
const building = ref('');
const progress = ref('');
const progressStage = ref(''); // 'download' | 'load' | 'embed'
const progressPercent = ref(0);
const error = ref('');

// 测试检索
const testQuery = ref('火抗怎么堆到75');
const retrieving = ref(false);
const retrieveResults = ref([]);
const retrieveError = ref('');

let offProgress = null;

const stageLabel = { download: '下载模型', load: '加载模型', embed: '向量化文档' };

onMounted(async () => {
  await refreshStatus();
  offProgress = window.api.onKbProgress((p) => {
    progressStage.value = p.stage || '';
    progress.value = p.detail || '';
    progressPercent.value = p.percent || 0;
  });
});

async function refreshStatus() {
  status.value = await window.api.kbStatus();
}

async function buildDocs() {
  building.value = 'docs';
  error.value = '';
  progress.value = '开始下载 PoB2 数据...';
  try {
    const res = await window.api.kbBuildDocs();
    if (!res.ok) throw new Error(res.error);
    await refreshStatus();
    progress.value = `文档构建完成: ${res.meta.docCount} 条`;
  } catch (e) {
    error.value = e.message;
  } finally {
    building.value = '';
    progressPercent.value = 0;
  }
}

async function buildIndex() {
  building.value = 'index';
  error.value = '';
  progressPercent.value = 0;
  progressStage.value = '';
  progress.value = '开始向量化(首次需下载模型)...';
  try {
    const res = await window.api.kbBuildIndex();
    if (!res.ok) throw new Error(res.error);
    await refreshStatus();
    progress.value = `✓ 向量化完成: ${res.result.count} 条,维度 ${res.result.dim}`;
    progressPercent.value = 100;
  } catch (e) {
    error.value = e.message;
  } finally {
    building.value = '';
  }
}

async function testRetrieve() {
  retrieving.value = true;
  retrieveError.value = '';
  retrieveResults.value = [];
  try {
    const res = await window.api.kbTestRetrieve(testQuery.value);
    if (!res.ok) throw new Error(res.error);
    retrieveResults.value = res.results;
  } catch (e) {
    retrieveError.value = e.message;
  } finally {
    retrieving.value = false;
  }
}

function fmtDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('zh-CN');
}
</script>

<template>
  <div class="card">
    <h3><Icon name="book" :size="16" /> POE2 游戏知识库</h3>
    <div class="notice">
      从 Path of Building 2 官方数据构建本地知识库,让 AI 分析时基于真实游戏数据(技能/词缀/装备数值),避免用过时知识瞎建议。
      构建分两步:① 下载解析文档(约1分钟)② 向量化(约2-3分钟)。完成后 AI 分析自动启用知识检索。
    </div>

    <!-- 状态 -->
    <div v-if="status" class="status-grid">
      <div class="status-item">
        <div class="si-label">文档库</div>
        <div :class="['si-value', status.docsBuilt ? 'ok' : 'off']">{{ status.docsBuilt ? '已构建' : '未构建' }}</div>
      </div>
      <div class="status-item">
        <div class="si-label">向量索引</div>
        <div :class="['si-value', status.indexBuilt ? 'ok' : 'off']">{{ status.indexBuilt ? '已构建' : '未构建' }}</div>
      </div>
      <div class="status-item" v-if="status.meta">
        <div class="si-label">文档总数</div>
        <div class="si-value">{{ status.meta.docCount }}</div>
      </div>
      <div class="status-item" v-if="status.meta">
        <div class="si-label">构建时间</div>
        <div class="si-value" style="font-size:12px">{{ fmtDate(status.meta.builtAt) }}</div>
      </div>
    </div>
    <div v-if="status?.meta" class="cat-line">
      分类:技能 {{ status.meta.categories?.skill || 0 }} | 词缀 {{ status.meta.categories?.mod || 0 }} | 装备基底 {{ status.meta.categories?.base || 0 }}
    </div>

    <!-- 操作按钮 -->
    <div class="row" style="margin-top: 16px; gap: 10px;">
      <button @click="buildDocs" :disabled="!!building">
        {{ building === 'docs' ? '构建中...' : (status?.docsBuilt ? '重建文档' : '① 构建文档') }}
      </button>
      <button @click="buildIndex" :disabled="!!building || !status?.docsBuilt" :class="{ disabled: !status?.docsBuilt }">
        {{ building === 'index' ? '向量化中...' : (status?.indexBuilt ? '重建索引' : '② 向量化') }}
      </button>
    </div>

    <!-- 进度 -->
    <div v-if="progress" class="progress-box">
      <div class="progress-detail">
        <span v-if="progressStage && stageLabel[progressStage]" class="stage-tag">{{ stageLabel[progressStage] }}</span>
        <span>{{ progress }}</span>
      </div>
      <div v-if="progressStage === 'download' || progressStage === 'embed'" class="progress-bar-container">
        <div class="progress-bar">
          <div class="progress-bar-fill" :style="{ width: progressPercent + '%' }"></div>
        </div>
        <div class="progress-text">{{ progressPercent.toFixed(1) }}%</div>
      </div>
    </div>
    <div v-if="error" class="notice err"><Icon name="error" :size="14" /> {{ error }}</div>
  </div>

  <!-- 测试检索 -->
  <div class="card" v-if="status?.indexBuilt">
    <h3><Icon name="search" :size="16" /> 测试检索</h3>
    <div class="notice">输入问题,看知识库检索出哪些相关文档(验证检索质量)</div>
    <div class="row" style="margin-top: 10px;">
      <input type="text" v-model="testQuery" placeholder="如:火抗怎么堆到75 / 战矛技能 / 闪电伤害词缀" @keyup.enter="testRetrieve" :disabled="retrieving" />
      <button @click="testRetrieve" :disabled="retrieving">{{ retrieving ? '检索中...' : '检索' }}</button>
    </div>
    <div v-if="retrieveError" class="notice err"><Icon name="error" :size="14" /> {{ retrieveError }}</div>
    <div v-if="retrieveResults.length" class="retrieve-list">
      <div v-for="(r, i) in retrieveResults" :key="i" class="retrieve-item">
        <div class="ri-head">
          <span class="ri-score">{{ (r.score * 100).toFixed(1) }}%</span>
          <span class="ri-title">{{ r.title }}</span>
        </div>
        <pre class="ri-content">{{ r.content.slice(0, 200) }}{{ r.content.length > 200 ? '...' : '' }}</pre>
      </div>
    </div>
    <div v-else-if="!retrieving && retrieveResults.length === 0 && testQuery" class="empty" style="padding:20px">点检索查看结果</div>
  </div>

  <div v-if="!status?.docsBuilt" class="empty">
    知识库尚未构建<br />
    <small>点击「构建文档」开始(从 PoB2 官方数据仓库下载)</small>
  </div>
</template>

<style scoped>
.status-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 14px; }
.status-item { background: var(--bg); border-radius: 8px; padding: 10px 12px; }
.si-label { font-size: 11px; color: var(--text-dim); }
.si-value { font-size: 15px; font-weight: 600; margin-top: 4px; }
.si-value.ok { color: var(--success); }
.si-value.off { color: var(--text-dim); }
.cat-line { font-size: 12px; color: var(--text-dim); margin-top: 10px; }
.progress-box { margin-top: 12px; padding: 10px 12px; background: var(--bg); border-radius: 6px; font-size: 13px; color: var(--accent); }
.progress-detail { display: flex; align-items: center; gap: 8px; }
.stage-tag { background: var(--accent); color: #1a1d27; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px; white-space: nowrap; }
.progress-bar-container { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.progress-bar { flex: 1; height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; }
.progress-bar-fill { height: 100%; background: var(--accent); border-radius: 4px; transition: width 0.3s ease; }
.progress-text { font-size: 12px; color: var(--text-dim); min-width: 50px; text-align: right; }
.disabled { opacity: 0.4; }
.retrieve-list { margin-top: 12px; }
.retrieve-item { background: var(--bg); border-radius: 6px; padding: 10px 12px; margin-bottom: 8px; }
.ri-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.ri-score { background: var(--accent); color: #1a1d27; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px; }
.ri-title { font-weight: 600; font-size: 13px; }
.ri-content { white-space: pre-wrap; word-break: break-all; font-size: 11px; color: var(--text-dim); font-family: inherit; }
</style>
