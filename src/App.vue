<script setup>
import { ref } from 'vue';
import CompareView from './CompareView.vue';
import DocCompareView from './DocCompareView.vue';
import KnowledgeView from './KnowledgeView.vue';
import ChatView from './ChatView.vue';
import Icon from './Icons.vue';

const tab = ref('chat'); // chat | compare | doc | knowledge | settings

// AI 分析相关（BD 详情页用）
const aiQuestion = ref('请分析这个 BD,重点说明抗性怎么补满、装备该换什么、伤害和生存如何提升。');
const aiAnalyzing = ref(false);
const aiResult = ref('');
const aiThinking = ref('');
const aiError = ref('');
let offChunk = null;

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
const hasApi = () => settings.value.apiKey && settings.value.apiModel;
</script>

<template>
  <div class="topbar">
    <h1><Icon name="sword" :size="18" /> POE2 BD 配装助手</h1>
    <div class="tabs">
      <button :class="['tab', tab === 'chat' && 'active']" @click="tab = 'chat'"><Icon name="robot" :size="14" /> AI 对话</button>
      <button :class="['tab', tab === 'compare' && 'active']" @click="tab = 'compare'"><Icon name="compare" :size="14" /> 两码对比</button>
      <button :class="['tab', tab === 'doc' && 'active']" @click="tab = 'doc'"><Icon name="file" :size="14" /> 文档对比</button>
      <button :class="['tab', tab === 'knowledge' && 'active']" @click="tab = 'knowledge'"><Icon name="book" :size="14" /> 知识库</button>
      <button :class="['tab', tab === 'settings' && 'active']" @click="tab = 'settings'"><Icon name="settings" :size="14" /> AI 设置</button>
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

    <!-- 知识库页 -->
    <div v-show="tab === 'knowledge'">
      <KnowledgeView :settings="settings" />
    </div>

    <!-- AI 设置页 -->
    <div v-show="tab === 'settings'">
      <div class="card">
        <h3>大模型 API 配置</h3>
        <div class="notice">配置后启用「AI 自动分析」。未配置也能用「导出文本」模式。Key 仅保存在本机,不上传。</div>
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
            <input type="text" v-model="settings.apiModel" placeholder="如 glm-4-flash / claude-3-5-sonnet-20241022" />
          </div>
          <div class="form-row">
            <label>思考深度 <span style="font-weight:normal;color:var(--text-dim)">(推理模型的思考强度,非推理模型忽略)</span></label>
            <select v-model="settings.thinkingLevel">
              <option value="max">最高(推荐,深度思考)</option>
              <option value="high">高</option>
              <option value="low">低(快速响应)</option>
              <option value="off">关闭</option>
            </select>
          </div>
          <div class="form-row">
            <label>知识库向量化模型 <span style="font-weight:normal;color:var(--text-dim)">(首次使用自动下载)</span></label>
            <select v-model="settings.localModelName">
              <option v-for="m in localModels" :key="m.id" :value="m.id">
                {{ m.desc }} {{ m.downloaded ? '- 已下载' : '(需下载)' }}
              </option>
            </select>
            <div style="font-size:11px;color:var(--text-dim);margin-top:4px">推荐:中文小型模型(~90MB),效果好且体积小</div>
          </div>
          <div class="form-row">
            <label>下载代理 <span style="font-weight:normal;color:var(--text-dim)">(可选,加速模型下载)</span></label>
            <input type="text" v-model="settings.proxyUrl" placeholder="如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080" />
            <div class="preset-row">
              <span class="preset-label">快速填写:</span>
              <button class="preset-btn" @click="settings.proxyUrl = 'http://127.0.0.1:7890'">Clash (7890)</button>
              <button class="preset-btn" @click="settings.proxyUrl = 'http://127.0.0.1:10809'">V2Ray (10809)</button>
              <button class="preset-btn" @click="settings.proxyUrl = 'socks5://127.0.0.1:1080'">SOCKS5 (1080)</button>
              <button class="preset-btn" @click="settings.proxyUrl = ''">清空</button>
            </div>
            <div style="font-size:11px;color:var(--text-dim);margin-top:4px">如果模型下载慢或失败,可以配置代理加速。留空则使用国内镜像直连。</div>
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
      <div class="card">
        <h3>说明</h3>
        <div style="font-size:13px;color:var(--text-dim);line-height:1.9">
          • <strong style="color:var(--text)">OpenAI 格式</strong>:智谱GLM、通义千问、Kimi、DeepSeek、OpenAI、本地 Ollama 等(大多数)<br>
          • <strong style="color:var(--text)">Anthropic 格式</strong>:Claude 官方及兼容中转<br>
          • 测试连接/拉取模型使用各平台的标准 <code>/models</code> 接口,不消耗对话额度<br>
          • Key 加密保存在系统 userData 目录,仅本机读取
        </div>
      </div>
    </div>
  </div>
</template>
