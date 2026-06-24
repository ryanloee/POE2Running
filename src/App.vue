<script setup>
import { ref, computed, onMounted } from 'vue';
import ChatView from './ChatView.vue';
import Icon from './Icons.vue';

// 浮层控制
const showSettings = ref(false);
const showCompare = ref(false);
const showChat = ref(false);
const chatRef = ref(null);

// ===== BD 数据来源(从 ChatView 移到此处统一管理) =====
const myShareCode = ref('');
const myBd = ref(null);
const myBdLoading = ref(false);
const myBdError = ref('');
const myBdText = ref('');

const targetMode = ref('none');
const targetShareCode = ref('');
const targetBd = ref(null);
const targetBdLoading = ref(false);
const targetBdError = ref('');
const targetBdText = ref('');
const targetDocName = ref('');
const targetDocText = ref('');

function extractShareCode(input) {
  if (!input) return '';
  let s = input.trim();
  const m = s.match(/#\/share\/([A-Za-z0-9_\-]+)/);
  if (m) return m[1];
  return s.replace(/\s+/g, '');
}

// 计算 BD 上下文文本(传给 ChatView 作 props)
const contextText = computed(() => {
  let parts = [];
  if (myBdText.value) parts.push(myBdText.value);
  if (targetMode.value === 'bd' && targetBdText.value) {
    parts.push(`【目标 BD - 对比参考】\n${targetBdText.value}`);
  }
  if (targetMode.value === 'doc' && targetDocText.value) {
    parts.push(`【目标配装文档: ${targetDocName.value}】\n${targetDocText.value.slice(0, 3000)}`);
  }
  return parts.join('\n\n');
});

async function fetchMyBD() {
  const code = extractShareCode(myShareCode.value);
  if (!code) { myBdError.value = '请输入分享码'; return; }
  myBdLoading.value = true; myBdError.value = ''; myBd.value = null; myBdText.value = '';
  try {
    const res = await window.api.fetchBD(code);
    if (!res.ok) throw new Error(res.error);
    myBd.value = res.data;
    myBdText.value = await window.api.bdToText(res.data);
    // 保存时保留已有的 targetCode 和 docPath
    const last = await window.api.getLastCode();
    await window.api.saveLastCode({
      myCode: code,
      targetCode: targetShareCode.value || last?.targetCode || '',
      docPath: targetDocName.value ? undefined : last?.docPath,
    });
  } catch (e) { myBdError.value = e.message; }
  finally { myBdLoading.value = false; }
}

async function fetchTargetBD() {
  const code = extractShareCode(targetShareCode.value);
  if (!code) { targetBdError.value = '请输入分享码'; return; }
  targetBdLoading.value = true; targetBdError.value = ''; targetBd.value = null; targetBdText.value = '';
  try {
    const res = await window.api.fetchBD(code);
    if (!res.ok) throw new Error(res.error);
    targetBd.value = res.data;
    targetBdText.value = await window.api.bdToText(res.data);
    await window.api.saveLastCode({ myCode: myShareCode.value, targetCode: code });
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
  await window.api.saveLastCode({ myCode: myShareCode.value, targetCode: '', docPath: res.filePath });
}

async function getLastDocPath() {
  try { const l = await window.api.getLastCode(); return l?.docPath || ''; } catch (_) { return ''; }
}

// 启动时自动加载上次的 BD
onMounted(async () => {
  try {
    const last = await window.api.getLastCode();
    if (last?.myCode) {
      myShareCode.value = last.myCode;
      await fetchMyBD();
    }
    if (last?.targetCode) {
      targetMode.value = 'bd';
      targetShareCode.value = last.targetCode;
      await fetchTargetBD();
    } else if (last?.docPath) {
      const parsed = await window.api.parseDoc(last.docPath);
      if (parsed.ok) {
        targetDocName.value = last.docPath.split(/[\\/]/).pop();
        targetDocText.value = parsed.data.text;
        targetMode.value = 'doc';
      }
    }
  } catch (_) {}
});

// BD 对比操作:关闭弹窗并发送对比消息
function startCompare() {
  showCompare.value = false;
  chatRef.value?.sendCustomMessage('请逐项对比这两个 BD 的差异,找出我的 BD 相比目标 BD 的不足之处,并给出改进建议');
}
function startDocCompare() {
  showCompare.value = false;
  chatRef.value?.sendCustomMessage('请对比我的 BD 和目标配装文档,找出差距,给出具体的装备/天赋改进建议');
}
function startAnalyze() {
  showCompare.value = false;
  chatRef.value?.sendCustomMessage('请分析我的 BD 配装短板(抗性/生命/伤害等),给出具体的改进方向和装备推荐');
}

// 导入 Icon

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

// ===== 市集登录 =====
const tradeChecking = ref(false);
const tradeLoginMsg = ref('');
const tradeLoginOk = ref(false);

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

async function checkTradeLogin() {
  tradeChecking.value = true;
  tradeLoginMsg.value = '';
  try {
    const res = await window.api.tradeCheckLogin();
    tradeLoginOk.value = res.loggedIn;
    tradeLoginMsg.value = res.loggedIn ? '✅ 已登录市集' : (res.reason || '❌ 未登录');
  } catch (e) { tradeLoginMsg.value = '❌ ' + e.message; tradeLoginOk.value = false; }
  finally { tradeChecking.value = false; }
}

async function openTradeLogin() {
  try {
    await window.api.tradeOpenLogin();
    tradeLoginMsg.value = '⏳ 登录窗口已打开,请在弹出的浏览器中完成 QQ 登录,然后点"检查登录状态"';
  } catch (e) { tradeLoginMsg.value = '❌ ' + e.message; }
}

// 调试:直接测试市集搜索
const debugSearchType = ref('翡翠戒指');
const debugSearching = ref(false);
const debugResult = ref('');

async function runDebugSearch() {
  debugSearching.value = true;
  debugResult.value = '搜索中...';
  try {
    const res = await window.api.debugSearch({ type: debugSearchType.value });
    if (res.ok) {
      debugResult.value = `HTTP ${res.status}\n${res.body}`;
    } else {
      debugResult.value = `❌ ${res.error}`;
    }
  } catch (e) {
    debugResult.value = '❌ ' + e.message;
  } finally {
    debugSearching.value = false;
  }
}
</script>

<template>
  <div class="app-shell">
    <!-- 顶栏 -->
    <div class="topbar">
      <span class="topbar-title"><Icon name="sword" :size="16" /> POE2 BD 助手</span>
      <div class="topbar-actions">
        <button class="topbar-btn" @click="showCompare = true"><Icon name="compare" :size="14" /> BD 比对</button>
        <button class="topbar-btn" @click="showChat = true"><Icon name="chat" :size="14" /> 对话</button>
        <button class="topbar-btn" @click="showSettings = true; onTabSettings()"><Icon name="settings" :size="14" /> 设置</button>
      </div>
    </div>

    <!-- 聊天区 -->
    <ChatView ref="chatRef" :contextText="contextText" />
  </div>

  <!-- BD 比对弹窗 -->
  <div v-if="showCompare" class="modal-mask" @click.self="showCompare = false">
    <div class="modal-panel">
      <div class="modal-head">
        <h2><Icon name="compare" :size="18" /> BD 比对设置</h2>
        <button class="modal-close" @click="showCompare = false"><Icon name="x" :size="18" /></button>
      </div>
      <div class="modal-body">
        <!-- 我的 BD -->
        <div class="bd-block">
          <div class="bd-label"><Icon name="clipboard" :size="14" /> 我的 BD</div>
          <div class="bd-input-row">
            <input v-model="myShareCode" placeholder="输入分享码或链接" class="bd-input" @keyup.enter="fetchMyBD" />
            <button class="bd-go" @click="fetchMyBD" :disabled="myBdLoading">
              {{ myBdLoading ? '查询中...' : '查询' }}
            </button>
          </div>
          <div v-if="myBd" class="bd-ok"><Icon name="check" :size="13" /> {{ myBd.role?.name }} · {{ myBd.role?.class_name }} Lv{{ myBd.role?.level }}</div>
          <div v-if="myBdError" class="bd-err">{{ myBdError }}</div>
        </div>

        <!-- 对比目标 -->
        <div class="bd-block">
          <div class="bd-label"><Icon name="target" :size="14" /> 对比目标</div>
          <div class="seg">
            <button :class="['seg-btn', targetMode === 'none' && 'on']" @click="targetMode = 'none'">无</button>
            <button :class="['seg-btn', targetMode === 'bd' && 'on']" @click="targetMode = 'bd'">目标 BD</button>
            <button :class="['seg-btn', targetMode === 'doc' && 'on']" @click="targetMode = 'doc'">文档</button>
          </div>
          <div v-if="targetMode === 'bd'" class="bd-input-row">
            <input v-model="targetShareCode" placeholder="目标 BD 分享码" class="bd-input" @keyup.enter="fetchTargetBD" />
            <button class="bd-go" @click="fetchTargetBD" :disabled="targetBdLoading">
              {{ targetBdLoading ? '查询中...' : '查询' }}
            </button>
          </div>
          <div v-if="targetMode === 'bd' && targetBd" class="bd-ok"><Icon name="check" :size="13" /> {{ targetBd.role?.name }} · {{ targetBd.role?.class_name }} Lv{{ targetBd.role?.level }}</div>
          <div v-if="targetMode === 'doc'">
            <button class="bd-upload" @click="uploadTargetDoc"><Icon name="upload" :size="14" /> 选择文档</button>
            <div v-if="targetDocName" class="bd-ok"><Icon name="check" :size="13" /> {{ targetDocName }}</div>
          </div>
          <div v-if="targetBdError" class="bd-err">{{ targetBdError }}</div>
        </div>

        <!-- 已加载状态 -->
        <div v-if="myBd || targetMode !== 'none'" class="bd-status">
          <div class="bd-status-title">当前已加载：</div>
          <div class="bd-tags">
            <span v-if="myBd" class="bd-tag"><Icon name="clipboard" :size="12" /> {{ myBd.role?.name }}</span>
            <span v-if="targetMode === 'bd' && targetBd" class="bd-tag"><Icon name="target" :size="12" /> {{ targetBd.role?.name }}</span>
            <span v-if="targetMode === 'doc' && targetDocName" class="bd-tag"><Icon name="file" :size="12" /> {{ targetDocName }}</span>
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="bd-actions">
          <button v-if="myBd && targetMode === 'bd' && targetBd" class="bd-action-btn primary" @click="startCompare">
            <Icon name="compare" :size="15" /> 开始两 BD 对比分析
          </button>
          <button v-if="myBd && targetMode === 'doc' && targetDocName" class="bd-action-btn primary" @click="startDocCompare">
            <Icon name="file" :size="15" /> 开始文档对比分析
          </button>
          <button v-if="myBd && (targetMode === 'none' || (!targetBd && !targetDocName))" class="bd-action-btn primary" @click="startAnalyze">
            <Icon name="shield" :size="15" /> 分析我的配装短板
          </button>
          <div class="bd-hint">配置数据后点击上方按钮开始分析,或关闭弹窗直接在对话中提问</div>
        </div>
      </div>
    </div>
  </div>

  <!-- 对话管理弹窗 -->
  <div v-if="showChat" class="modal-mask" @click.self="showChat = false">
    <div class="modal-panel">
      <div class="modal-head">
        <h2><Icon name="chat" :size="18" /> 对话管理</h2>
        <button class="modal-close" @click="showChat = false"><Icon name="x" :size="18" /></button>
      </div>
      <div class="modal-body">
        <div class="ds-title-row">
          <button class="bd-go" @click="chatRef?.newConversation()"><Icon name="plus" :size="14" /> 新建对话</button>
        </div>
        <div class="conv-list">
          <div v-for="c in (chatRef?.conversations || [])" :key="c.id"
               :class="['conv-item', chatRef?.currentConvId === c.id && 'active']"
               @click="chatRef?.switchConversation(c.id); showChat = false">
            <Icon name="chat" :size="13" class="conv-item-icon" />
            <span class="conv-item-name">{{ c.title }}</span>
            <button class="conv-item-del" @click.stop="chatRef?.deleteConv(c.id)" title="删除"><Icon name="x" :size="12" /></button>
          </div>
          <div v-if="!(chatRef?.conversations?.length)" class="conv-empty">暂无对话</div>
        </div>
      </div>
    </div>
  </div>

  <!-- 设置浮层(模态框) -->
  <div v-if="showSettings" class="modal-mask" @click.self="showSettings = false">
    <div class="modal-panel">
      <div class="modal-head">
        <h2><Icon name="settings" :size="18" /> 设置</h2>
        <button class="modal-close" @click="showSettings = false"><Icon name="x" :size="18" /></button>
      </div>
      <div class="modal-body">
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
              <button class="secondary" @click="testConn" :disabled="testing">{{ testing ? '测试中...' : '测试连接' }}</button>
              <button @click="saveSettings">保存设置</button>
              <span v-if="savedTip" class="ok-tip">{{ savedTip }}</span>
            </div>
            <div v-if="testMsg" :class="['test-msg', testResult]">{{ testMsg }}</div>
          </div>
        </div>
      </div>

      <!-- 知识库配置 -->
      <div class="card">
        <h3><Icon name="database" :size="16" /> 游戏知识库</h3>
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

      <!-- 市集登录 -->
      <div class="card">
        <h3><Icon name="shopping" :size="16" /> 国服市集</h3>
        <div class="notice">登录后 AI 对话可自动搜索市集在售装备。用 QQ 账号登录 WeGame POE2 官网。</div>
        <div class="row" style="margin-top:14px;gap:10px">
          <button class="secondary" @click="checkTradeLogin">{{ tradeChecking ? '检查中...' : '检查登录状态' }}</button>
          <button @click="openTradeLogin"><Icon name="key" :size="13" /> 打开市集登录</button>
        </div>
        <div v-if="tradeLoginMsg" :class="['notice', tradeLoginOk ? '' : 'err']" style="margin-top:10px">{{ tradeLoginMsg }}</div>

        <!-- 调试搜索 -->
        <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px">
          <div style="font-size:13px;font-weight:600;margin-bottom:8px">🔧 搜索调试</div>
          <div class="row" style="gap:10px;align-items:center">
            <input type="text" v-model="debugSearchType" placeholder="物品类型,如 翡翠戒指/蜥鳞外套" style="flex:1;min-width:200px" />
            <button @click="runDebugSearch" :disabled="debugSearching">{{ debugSearching ? '搜索中...' : '搜索' }}</button>
          </div>
          <pre v-if="debugResult" style="margin-top:10px;padding:10px;background:rgba(0,0,0,0.3);border-radius:6px;font-size:12px;white-space:pre-wrap;word-break:break-all;max-height:300px;overflow:auto">{{ debugResult }}</pre>
        </div>
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
  </div>
</template>

<style scoped>
/* 整体布局 */
.app-shell {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  position: relative;
  display: flex;
  flex-direction: column;
}

/* 顶栏 */
.topbar {
  height: 44px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  background: var(--bg-card, #181a20);
  border-bottom: 1px solid var(--border, #2a2d35);
  -webkit-app-region: drag;
}
.topbar-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--accent, #c9a96a);
}
.topbar-actions {
  display: flex;
  gap: 8px;
  -webkit-app-region: no-drag;
}
.topbar-btn {
  background: none;
  border: 1px solid var(--border, #333);
  color: var(--text, #e0e0e0);
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}
.topbar-btn:hover {
  background: var(--accent, #c9a96a);
  color: #1a1a1a;
  border-color: var(--accent, #c9a96a);
}

/* 模态浮层 */
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}
.modal-panel {
  width: 90%;
  max-width: 720px;
  max-height: 88vh;
  background: var(--bg, #1a1a1a);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border, #333);
}
.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border, #333);
}
.modal-head h2 { margin: 0; font-size: 18px; }
.modal-close {
  background: none; border: none; color: var(--text-dim);
  font-size: 20px; cursor: pointer; padding: 4px 8px;
}
.modal-close:hover { color: var(--text); }
.modal-body {
  padding: 20px;
  overflow-y: auto;
}

/* BD 比对弹窗内部样式 */
.bd-block {
  margin-bottom: 20px;
  padding: 16px;
  background: rgba(0,0,0,0.2);
  border-radius: 8px;
  border: 1px solid var(--border, #2a2d35);
}
.bd-label {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 10px;
  color: var(--text, #e0e0e0);
  display: flex;
  align-items: center;
  gap: 6px;
}
.bd-input-row {
  display: flex;
  gap: 8px;
}
.bd-input {
  flex: 1;
  padding: 8px 12px;
  background: var(--bg, #0f1117);
  border: 1px solid var(--border, #333);
  border-radius: 6px;
  color: var(--text, #e0e0e0);
  font-size: 13px;
}
.bd-input:focus { outline: none; border-color: var(--accent, #c9a96a); }
.bd-go {
  padding: 8px 16px;
  background: var(--accent, #c9a96a);
  color: #1a1a1a;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
}
.bd-go:hover { opacity: 0.9; }
.bd-go:disabled { opacity: 0.5; cursor: not-allowed; }
.bd-ok {
  margin-top: 8px;
  font-size: 13px;
  color: var(--success, #5a9e5a);
  display: flex;
  align-items: center;
  gap: 4px;
}
.bd-err {
  margin-top: 8px;
  font-size: 13px;
  color: var(--danger, #c44040);
}
.bd-upload {
  padding: 8px 16px;
  background: var(--bg-elev, #1a1e28);
  color: var(--text, #e0e0e0);
  border: 1px solid var(--border, #333);
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.bd-upload:hover { border-color: var(--accent, #c9a96a); }
.seg {
  display: flex;
  gap: 4px;
  margin-bottom: 10px;
}
.seg-btn {
  flex: 1;
  padding: 6px;
  background: var(--bg-elev, #1a1e28);
  color: var(--text-dim, #7a7368);
  border: 1px solid var(--border, #333);
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}
.seg-btn.on {
  background: var(--accent, #c9a96a);
  color: #1a1a1a;
  border-color: var(--accent, #c9a96a);
}
.bd-status {
  margin-top: 8px;
  padding: 12px;
  background: rgba(200,164,78,0.08);
  border-radius: 8px;
  border: 1px solid rgba(200,164,78,0.2);
}
.bd-status-title {
  font-size: 12px;
  color: var(--text-dim, #7a7368);
  margin-bottom: 8px;
}
.bd-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.bd-tag {
  font-size: 12px;
  padding: 3px 10px;
  background: rgba(200,164,78,0.15);
  border-radius: 12px;
  color: var(--accent, #c9a96a);
  display: flex;
  align-items: center;
  gap: 4px;
}
.bd-hint {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-dim, #7a7368);
  text-align: center;
}

/* BD 对比操作按钮 */
.bd-actions {
  margin-top: 16px;
  text-align: center;
}
.bd-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 24px;
  background: var(--accent, #c9a96a);
  color: #1a1a1a;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  transition: all 0.15s;
}
.bd-action-btn:hover { opacity: 0.9; transform: translateY(-1px); }
.bd-action-btn.primary { width: 100%; justify-content: center; }

/* 对话管理弹窗 */
.ds-title-row {
  margin-bottom: 12px;
}
.conv-list {
  max-height: 400px;
  overflow-y: auto;
}
.conv-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
  margin-bottom: 4px;
}
.conv-item:hover { background: rgba(255,255,255,0.05); }
.conv-item.active { background: rgba(200,164,78,0.15); }
.conv-item-icon { color: var(--text-dim, #7a7368); flex-shrink: 0; }
.conv-item.active .conv-item-icon { color: var(--accent, #c9a96a); }
.conv-item-name {
  flex: 1;
  font-size: 13px;
  color: var(--text, #e0e0e0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.conv-item-del {
  background: none;
  border: none;
  color: var(--text-dim, #7a7368);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
}
.conv-item-del:hover { color: var(--danger, #c44040); background: rgba(196,64,64,0.1); }
.conv-empty {
  text-align: center;
  padding: 30px;
  color: var(--text-dim, #7a7368);
  font-size: 13px;
}
</style>
