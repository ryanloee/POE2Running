<script setup>
import { ref } from 'vue';
import CompareView from './CompareView.vue';
import DocCompareView from './DocCompareView.vue';
import KnowledgeView from './KnowledgeView.vue';
import TradeView from './TradeView.vue';
import Icon from './Icons.vue';

const tab = ref('compare'); // compare | doc | knowledge | trade | settings
const tradeAutoResults = ref(null); // AI 分析后的自动搜索结果
let offTrade = null;

// API 设置(后续 SettingsView 用)
const settings = ref({ 
  apiFormat: 'openai', 
  apiBaseUrl: '', 
  apiKey: '', 
  apiModel: '', 
  thinkingLevel: 'max', // 思考深度: off | low | high | max
  embeddingModel: '',
  embeddingMode: 'local', // 'api' | 'local'
  localModelName: 'bge-small-zh',
  proxyUrl: '', // 代理地址
});
const savedTip = ref('');
const testing = ref(false);
const testResult = ref(''); // '' | 'ok' | 'err'
const testMsg = ref('');
const localModels = ref([]);
loadSettings();

// 接收 AI 分析后的自动市集搜索结果
if (typeof window !== 'undefined' && window.api?.onTradeAutoResults) {
  offTrade = window.api.onTradeAutoResults((results) => {
    tradeAutoResults.value = results;
    // 如果有结果,自动切到市集页(但不强制,用户可能还在看 AI 结果)
  });
}

async function loadSettings() {
  try {
    const s = await window.api.getSettings();
    // 兼容旧配置(没有的字段补上默认)
    settings.value = { 
      apiFormat: 'openai', 
      apiBaseUrl: '', 
      apiKey: '', 
      apiModel: '', 
      thinkingLevel: 'max',
      embeddingModel: '',
      embeddingMode: 'local',
      localModelName: 'bge-small-zh',
      proxyUrl: '',
      ...s 
    };
    // 加载本地模型列表
    loadLocalModels();
  } catch (e) {}
}

async function loadLocalModels() {
  try {
    const res = await window.api.kbGetLocalModels();
    if (res.ok) {
      localModels.value = res.models;
    }
  } catch (e) {}
}

async function saveSettings() {
  savedTip.value = '保存中...';
  try {
    const plainSettings = {
      apiFormat: settings.value.apiFormat,
      apiBaseUrl: settings.value.apiBaseUrl,
      apiKey: settings.value.apiKey,
      apiModel: settings.value.apiModel,
      thinkingLevel: settings.value.thinkingLevel,
      embeddingModel: settings.value.embeddingModel,
      embeddingMode: settings.value.embeddingMode,
      localModelName: settings.value.localModelName,
      proxyUrl: settings.value.proxyUrl,
    };
    const res = await window.api.saveSettings(plainSettings);
    if (res && res.ok) {
      savedTip.value = '保存成功!';
    } else {
      savedTip.value = '保存失败: ' + (res?.error || '未知错误');
    }
  } catch (e) {
    savedTip.value = '保存异常: ' + e.message;
  }
}

// 测试连接
async function testConn() {
  if (!settings.value.apiBaseUrl || !settings.value.apiKey) {
    testResult.value = 'err';
    testMsg.value = '请先填写 Base URL 和 API Key';
    return;
  }
  if (!settings.value.apiModel) {
    testResult.value = 'err';
    testMsg.value = '请先填写模型名';
    return;
  }
  testing.value = true;
  testResult.value = '';
  testMsg.value = '测试中...';
  try {
    const plainSettings = {
      apiFormat: settings.value.apiFormat,
      apiBaseUrl: settings.value.apiBaseUrl,
      apiKey: settings.value.apiKey,
      apiModel: settings.value.apiModel,
      thinkingLevel: settings.value.thinkingLevel,
      embeddingModel: settings.value.embeddingModel,
    };
    console.log('[前端] 准备测试:', plainSettings);
    const res = await window.api.testAI(plainSettings);
    console.log('[前端] 测试返回:', res);
    if (res.ok) {
      testResult.value = 'ok';
      testMsg.value = '连接成功!' + (res.reply ? ` AI 回复:"${res.reply}"` : '');
    } else {
      testResult.value = 'err';
      testMsg.value = res.error;
    }
  } catch (e) {
    testResult.value = 'err';
    testMsg.value = e.message;
  } finally {
    testing.value = false;
  }
}

// 切换格式时清空提示
function onFormatChange() {
  testResult.value = '';
  testMsg.value = '';
}
</script>

<template>
  <div class="topbar">
    <h1><Icon name="sword" :size="18" /> POE2 BD 配装助手</h1>
    <div class="tabs">
      <button :class="['tab', tab === 'compare' && 'active']" @click="tab = 'compare'"><Icon name="compare" :size="14" /> 两码对比</button>
      <button :class="['tab', tab === 'doc' && 'active']" @click="tab = 'doc'"><Icon name="file" :size="14" /> 文档对比</button>
      <button :class="['tab', tab === 'knowledge' && 'active']" @click="tab = 'knowledge'"><Icon name="book" :size="14" /> 知识库</button>
      <button :class="['tab', tab === 'trade' && 'active']" @click="tab = 'trade'"><Icon name="shopping" :size="14" /> 市集</button>
      <button :class="['tab', tab === 'settings' && 'active']" @click="tab = 'settings'"><Icon name="settings" :size="14" /> AI 设置</button>
    </div>
  </div>

  <div class="content">
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

    <!-- 市集页 -->
    <div v-show="tab === 'trade'">
      <TradeView :autoResults="tradeAutoResults" />
    </div>

    <!-- AI 设置页(第二期完善) -->
    <div v-show="tab === 'settings'">
      <div class="card">
        <h3>大模型 API 配置</h3>
        <div class="notice">配置后启用「AI 自动分析」。未配置也能用「导出文本」模式。Key 仅保存在本机,不上传。</div>

        <div class="form-grid">
          <!-- API 格式 -->
          <div class="form-row">
            <label>API 格式</label>
            <div class="row">
              <label class="radio"><input type="radio" v-model="settings.apiFormat" value="openai" @change="onFormatChange" /> OpenAI 格式</label>
              <label class="radio"><input type="radio" v-model="settings.apiFormat" value="anthropic" @change="onFormatChange" /> Anthropic 格式</label>
            </div>
          </div>

          <!-- Base URL -->
          <div class="form-row">
            <label>API Base URL</label>
            <input type="text" v-model="settings.apiBaseUrl" :placeholder="settings.apiFormat === 'anthropic' ? 'https://api.anthropic.com' : 'https://open.bigmodel.cn/api/paas/v4'" />
          </div>

          <!-- API Key -->
          <div class="form-row">
            <label>API Key</label>
            <input type="text" v-model="settings.apiKey" placeholder="sk-... / sk-ant-..." />
          </div>

          <!-- 模型 -->
          <div class="form-row">
            <label>模型</label>
            <input type="text" v-model="settings.apiModel" placeholder="如 glm-4-flash / claude-3-5-sonnet-20241022" />
          </div>

          <!-- 思考深度 -->
          <div class="form-row">
            <label>思考深度 <span style="font-weight:normal;color:var(--text-dim)">(推理模型的思考强度,非推理模型忽略)</span></label>
            <div class="row">
              <select v-model="settings.thinkingLevel" class="select-box">
                <option value="max">最高(推荐,深度思考)</option>
                <option value="high">高</option>
                <option value="low">低(快速响应)</option>
                <option value="off">关闭</option>
              </select>
            </div>
          </div>

          <div class="form-row">
            <label>知识库向量化模型 <span style="font-weight:normal;color:var(--text-dim)">(首次使用自动下载)</span></label>
            <select v-model="settings.localModelName">
              <option v-for="m in localModels" :key="m.id" :value="m.id">
                {{ m.desc }} {{ m.downloaded ? '- 已下载' : '(需下载)' }}
              </option>
            </select>
            <div style="font-size:11px;color:var(--text-dim);margin-top:4px">
              推荐:中文小型模型(~90MB),效果好且体积小
            </div>
          </div>

          <!-- 代理配置 -->
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
            <div style="font-size:11px;color:var(--text-dim);margin-top:4px">
              如果模型下载慢或失败,可以配置代理加速。留空则使用国内镜像直连。
            </div>
          </div>

          <!-- 测试与保存 -->
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

