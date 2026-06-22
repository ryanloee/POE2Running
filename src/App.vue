<script setup>
import { ref } from 'vue';
import CompareView from './CompareView.vue';
import DocCompareView from './DocCompareView.vue';
import ChatView from './ChatView.vue';
import Icon from './Icons.vue';

const tab = ref('chat'); // chat | compare | doc | settings

// 设置
const settings = ref({
  apiFormat: 'openai',
  apiBaseUrl: '',
  apiKey: '',
  apiModel: '',
  thinkingLevel: 'max',
  embeddingModel: '',
  embeddingMode: 'local',
  localModelName: 'bge-small-zh',
  proxyUrl: '',
});
const savedTip = ref('');
const testing = ref(false);
const testResult = ref('');
const testMsg = ref('');
const localModels = ref([]);
loadSettings();

// ===== 知识库状态（移入设置页） =====
const kbStatus = ref(null);
const kbBuilding = ref('');
const kbProgress = ref('');
const kbProgressPercent = ref(0);
const kbError = ref('');
let offKbProgress = null;

async function refreshKbStatus() {
  kbStatus.value = await window.api.kbStatus();
}

async function buildDocs() {
  kbBuilding.value = 'docs';
  kbError.value = '';
  kbProgress.value = '开始下载 PoB2 数据...';
  try {
    const res = await window.api.kbBuildDocs();
    if (!res.ok) throw new Error(res.error);
    await refreshKbStatus();
    kbProgress.value = `✓ 文档构建完成: ${res.meta.docCount} 条`;
  } catch (e) { kbError.value = e.message; }
  finally { kbBuilding.value = ''; kbProgressPercent.value = 0; }
}

async function buildIndex() {
  kbBuilding.value = 'index';
  kbError.value = '';
  kbProgressPercent.value = 0;
  kbProgress.value = '开始向量化(首次需下载模型)...';
  try {
    const res = await window.api.kbBuildIndex();
    if (!res.ok) throw new Error(res.error);
    await refreshKbStatus();
    kbProgress.value = `✓ 向量化完成: ${res.result.count} 条`;
    kbProgressPercent.value = 100;
  } catch (e) { kbError.value = e.message; }
  finally { kbBuilding.value = ''; }
}

function onTabSettings() {
  if (!kbStatus.value) refreshKbStatus();
  if (!offKbProgress) {
    offKbProgress = window.api.onKbProgress((p) => {
      kbProgress.value = p.detail || '';
      kbProgressPercent.value = p.percent || 0;
    });
  }
}

async function loadSettings() {
  try {
    const s = await window.api.getSettings();
    settings.value = {
      apiFormat: 'openai', apiBaseUrl: '', apiKey: '', apiModel: '',
      thinkingLevel: 'max', embeddingModel: '', embeddingMode: 'local',
      localModelName: 'bge-small-zh', proxyUrl: '', ...s,
    };
    loadLocalModels();
  } catch (_) {}
}

async function loadLocalModels() {
  try {
    const res = await window.api.kbGetLocalModels();
    if (res.ok) localModels.value = res.models;
  } catch (_) {}
}

async function saveSettings() {
  savedTip.value = '保存中...';
  try {
    const plainSettings = {
      apiFormat: settings.value.apiFormat, apiBaseUrl: settings.value.apiBaseUrl,
      apiKey: settings.value.apiKey, apiModel: settings.value.apiModel,
      thinkingLevel: settings.value.thinkingLevel, embeddingModel: settings.value.embeddingModel,
      embeddingMode: settings.value.embeddingMode, localModelName: settings.value.localModelName,
      proxyUrl: settings.value.proxyUrl,
    };
    const res = await window.api.saveSettings(plainSettings);
    savedTip.value = res?.ok ? '保存成功!' : '保存失败';
  } catch (e) { savedTip.value = '异常: ' + e.message; }
  setTimeout(() => { savedTip.value = ''; }, 2000);
}

async function testConn() {
  if (!settings.value.apiBaseUrl || !settings.value.apiKey) { testResult.value = 'err'; testMsg.value = '请先填写 URL 和 Key'; return; }
  if (!settings.value.apiModel) { testResult.value = 'err'; testMsg.value = '请先填写模型名'; return; }
  testing.value = true; testResult.value = ''; testMsg.value = '测试中...';
  try {
    const res = await window.api.testAI({
      apiFormat: settings.value.apiFormat, apiBaseUrl: settings.value.apiBaseUrl,
      apiKey: settings.value.apiKey, apiModel: settings.value.apiModel,
      thinkingLevel: settings.value.thinkingLevel,
    });
    testResult.value = res.ok ? 'ok' : 'err';
    testMsg.value = res.ok ? '连接成功!' + (res.reply ? ` "${res.reply}"` : '') : res.error;
  } catch (e) { testResult.value = 'err'; testMsg.value = e.message; }
  finally { testing.value = false; }
}

function onFormatChange() { testResult.value = ''; testMsg.value = ''; }
</script>

<template>
  <div class="topbar">
    <h1><Icon name="sword" :size="18" /> POE2 BD 配装助手</h1>
    <div class="tabs">
      <button :class="['tab', tab === 'chat' && 'active']" @click="tab = 'chat'"><Icon name="robot" :size="14" /> AI 对话</button>
      <button :class="['tab', tab === 'compare' && 'active']" @click="tab = 'compare'"><Icon name="compare" :size="14" /> 两码对比</button>
      <button :class="['tab', tab === 'doc' && 'active']" @click="tab = 'doc'"><Icon name="file" :size="14" /> 文档对比</button>
      <button :class="['tab', tab === 'settings' && 'active']" @click="tab = 'settings'; onTabSettings()"><Icon name="settings" :size="14" /> 设置</button>
    </div>
  </div>

  <div class="content">
    <!-- AI 对话页（Agent） -->
    <div v-show="tab === 'chat'" style="height: calc(100vh - 52px);">
      <ChatView :settings="settings" />
    </div>

    <!-- 两码对比页 -->
    <div v-show="tab === 'compare'">
      <CompareView :settings="settings" />
    </div>

    <!-- 文档对比页 -->
    <div v-show="tab === 'doc'">
      <DocCompareView :settings="settings" />
    </div>

    <!-- 设置页（API配置 + 知识库） -->
    <div v-show="tab === 'settings'">
      <!-- API 配置 -->
      <div class="card">
        <h3>大模型 API 配置</h3>
        <div class="notice">配置后启用 AI 分析。Key 仅保存在本机,不上传。</div>
        <div class="form-grid">
          <div class="form-row">
            <label>API 格式</label>
            <div class="row">
              <label class="radio"><input type="radio" v-model="settings.apiFormat" value="openai" @change="onFormatChange" /> OpenAI 格式</label>
              <label class="radio"><input type="radio" v-model="settings.apiFormat" value="anthropic" @change="onFormatChange" /> Anthropic 格式</label>
            </div>
          </div>
          <div class="form-row">
            <label>API Base URL</label>
            <input type="text" v-model="settings.apiBaseUrl" :placeholder="settings.apiFormat === 'anthropic' ? 'https://api.anthropic.com' : 'https://open.bigmodel.cn/api/paas/v4'" />
          </div>
          <div class="form-row">
            <label>API Key</label>
            <input type="text" v-model="settings.apiKey" placeholder="sk-... / sk-ant-..." />
          </div>
          <div class="form-row">
            <label>模型</label>
            <input type="text" v-model="settings.apiModel" placeholder="如 glm-4-flash / deepseek-r1" />
          </div>
          <div class="form-row">
            <label>思考深度 <span style="font-weight:normal;color:var(--text-dim)">(推理模型的思考强度)</span></label>
            <select v-model="settings.thinkingLevel">
              <option value="max">最高(推荐)</option>
              <option value="high">高</option>
              <option value="low">低</option>
              <option value="off">关闭</option>
            </select>
          </div>
          <div class="form-row">
            <label>下载代理 <span style="font-weight:normal;color:var(--text-dim)">(加速模型下载)</span></label>
            <input type="text" v-model="settings.proxyUrl" placeholder="http://127.0.0.1:7890" />
            <div class="preset-row">
              <button class="preset-btn" @click="settings.proxyUrl = 'http://127.0.0.1:7890'">Clash</button>
              <button class="preset-btn" @click="settings.proxyUrl = 'http://127.0.0.1:10809'">V2Ray</button>
              <button class="preset-btn" @click="settings.proxyUrl = ''">清空</button>
            </div>
          </div>
          <div class="form-row">
            <div class="row">
              <button class="secondary" @click="testConn" :disabled="testing">{{ testing ? '测试中...' : '🔌 测试连接' }}</button>
              <button @click="saveSettings">💾 保存设置</button>
              <span v-if="savedTip" class="ok-tip">{{ savedTip }}</span>
            </div>
            <div v-if="testMsg" :class="['test-msg', testResult]">{{ testMsg }}</div>
          </div>
        </div>
      </div>

      <!-- 知识库配置 -->
      <div class="card">
        <h3>📚 游戏知识库</h3>
        <div class="notice">从 Path of Building 2 官方数据构建本地知识库,让 AI 分析时基于真实游戏数据。构建分两步:① 下载解析文档(约1分钟)② 向量化(约2-3分钟)。</div>

        <!-- 状态 -->
        <div v-if="kbStatus" class="status-grid" style="margin-top:14px">
          <div class="status-item">
            <div class="si-label">文档库</div>
            <div :class="['si-value', kbStatus.docsBuilt ? 'ok' : 'off']">{{ kbStatus.docsBuilt ? '已构建' : '未构建' }}</div>
          </div>
          <div class="status-item">
            <div class="si-label">向量索引</div>
            <div :class="['si-value', kbStatus.indexBuilt ? 'ok' : 'off']">{{ kbStatus.indexBuilt ? '已构建' : '未构建' }}</div>
          </div>
          <div class="status-item" v-if="kbStatus.meta">
            <div class="si-label">文档总数</div>
            <div class="si-value">{{ kbStatus.meta.docCount }}</div>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="row" style="margin-top:16px;gap:10px">
          <button @click="buildDocs" :disabled="!!kbBuilding">
            {{ kbBuilding === 'docs' ? '构建中...' : (kbStatus?.docsBuilt ? '重建文档' : '① 构建文档') }}
          </button>
          <button @click="buildIndex" :disabled="!!kbBuilding || !kbStatus?.docsBuilt" :class="{ disabled: !kbStatus?.docsBuilt }">
            {{ kbBuilding === 'index' ? '向量化中...' : (kbStatus?.indexBuilt ? '重建索引' : '② 向量化') }}
          </button>
        </div>

        <!-- 向量化模型选择 -->
        <div class="form-row" style="margin-top:14px">
          <label>知识库向量化模型</label>
          <select v-model="settings.localModelName">
            <option v-for="m in localModels" :key="m.id" :value="m.id">
              {{ m.desc }} {{ m.downloaded ? '- 已下载' : '(需下载)' }}
            </option>
          </select>
        </div>

        <!-- 进度 -->
        <div v-if="kbProgress" class="progress-box">
          <div>{{ kbProgress }}</div>
          <div v-if="kbProgressPercent > 0" class="progress-bar-container">
            <div class="progress-bar"><div class="progress-bar-fill" :style="{ width: kbProgressPercent + '%' }"></div></div>
            <div style="font-size:12px;color:var(--text-dim);min-width:50px;text-align:right">{{ kbProgressPercent.toFixed(1) }}%</div>
          </div>
        </div>
        <div v-if="kbError" class="notice err"><Icon name="error" :size="14" /> {{ kbError }}</div>
      </div>

      <!-- 说明 -->
      <div class="card">
        <h3>说明</h3>
        <div style="font-size:13px;color:var(--text-dim);line-height:1.9">
          • <strong style="color:var(--text)">OpenAI 格式</strong>:智谱GLM、通义千问、Kimi、DeepSeek、OpenAI、本地 Ollama 等<br>
          • <strong style="color:var(--text)">Anthropic 格式</strong>:Claude 官方及兼容中转<br>
          • Key 保存在系统 userData 目录,仅本机读取
        </div>
      </div>
    </div>
  </div>
</template>
