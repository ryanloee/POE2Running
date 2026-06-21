<script setup>
import { ref } from 'vue';
import CompareView from './CompareView.vue';
import DocCompareView from './DocCompareView.vue';
import KnowledgeView from './KnowledgeView.vue';
import Icon from './Icons.vue';

const tab = ref('bd'); // bd | compare | doc | knowledge | settings
const shareCode = ref('');
const loading = ref(false);
const error = ref('');
const bd = ref(null);

// AI 分析相关
const aiQuestion = ref('请分析这个 BD,重点说明抗性怎么补满、装备该换什么、伤害和生存如何提升。');
const aiAnalyzing = ref(false);
const aiResult = ref('');
const aiThinking = ref(''); // 推理模型的思考内容
const aiError = ref('');
let offChunk = null;

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

// 判断是否配置了 API(决定显示自动分析还是仅导出)
const hasApi = () => settings.value.apiKey && settings.value.apiModel;

// AI 自动分析(流式)
async function analyzeAI() {
  if (!bd.value) {
    aiError.value = '请先查询角色分享码';
    return;
  }
  if (!hasApi()) {
    aiError.value = '未配置 API,请先在「AI 设置」页填写,或使用「导出文本」模式';
    return;
  }
  aiAnalyzing.value = true;
  aiError.value = '';
  aiResult.value = '';
  aiThinking.value = '';
  // 注册流式回调(支持思考内容)
  if (offChunk) offChunk();
  offChunk = window.api.onAiChunk((chunk) => {
    if (chunk.type === 'thinking') {
      aiThinking.value += chunk.text;
    } else {
      aiResult.value += chunk.text;
    }
  });
  try {
    // 只传 shareCode 字符串(避免 Vue Proxy 通过 IPC 克隆失败)
    const res = await window.api.analyzeAI({ scene: 'single', shareCode: extractShareCode(shareCode.value), question: aiQuestion.value });
    if (!res.ok) throw new Error(res.error);
    if (res.content && res.content.length > aiResult.value.length) aiResult.value = res.content;
  } catch (e) {
    aiError.value = e.message;
  } finally {
    aiAnalyzing.value = false;
    if (offChunk) { offChunk(); offChunk = null; }
  }
}

// 导出文本(无 Key 模式)
async function exportText() {
  if (!bd.value) return;
  const res = await window.api.exportReport(bd.value);
  if (res.ok) {
    window.api.writeClipboard(res.text);
    alert('已复制到剪贴板!\n\n你可以直接粘贴到 ChatGPT / 豆包 / kimi 等网页版 AI,然后提问。');
  }
}

// 从输入中提取纯分享码(支持完整链接、带空格/换行)
// 分享码特征:URL 的 #/share/ 后面那串,或一串连续的 base64url 字符
function extractShareCode(input) {
  if (!input) return '';
  let s = input.trim();
  // 情况1:完整链接,提取 #/share/ 后面的部分
  const m = s.match(/#\/share\/([A-Za-z0-9_\-]+)/);
  if (m) return m[1];
  // 情况2:可能包含 share 字样的其他链接形式
  const m2 = s.match(/share[_=/]([A-Za-z0-9_\-]{20,})/);
  if (m2) return m2[1];
  // 情况3:去掉所有空白和换行,直接当作分享码(分享码是 base64url:字母数字_-)
  s = s.replace(/\s+/g, '');
  return s;
}

async function fetchBD() {
  const code = extractShareCode(shareCode.value);
  if (!code) {
    error.value = '请输入分享码(可直接粘贴完整分享链接)';
    return;
  }
  loading.value = true;
  error.value = '';
  bd.value = null;
  try {
    const res = await window.api.fetchBD(code);
    if (!res.ok) throw new Error(res.error);
    bd.value = res.data;
  } catch (e) {
    error.value = e.message || '抓取失败';
  } finally {
    loading.value = false;
  }
}

// 抗性着色
function resistClass(v) {
  const n = parseFloat(v);
  if (isNaN(n)) return '';
  if (n >= 75) return 'good';
  if (n < 60) return 'bad';
  return '';
}
function toHours(sec) {
  const n = parseInt(sec, 10);
  return isNaN(n) ? '-' : (n / 3600).toFixed(1);
}
function rarityClass(r) {
  return { Unique: 'unique', Rare: 'rare', Magic: 'magic' }[r] || '';
}

// 简易 Markdown 渲染(表格/标题/加粗/列表)
function renderMd(md) {
  if (!md) return '';
  let html = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  html = html.replace(/^\|(.+)\|\n\|[-:\s|]+\|\n((?:\|.+\|\n?)+)/gm, (m, header, rows) => {
    const h = header.split('|').filter((s) => s.trim()).map((s) => `<th>${s.trim()}</th>`).join('');
    const r = rows.trim().split('\n').map((row) => {
      const cells = row.split('|').filter((s) => s.trim());
      return '<tr>' + cells.map((c) => `<td>${c.trim()}</td>`).join('') + '</tr>';
    }).join('');
    return `<table><thead><tr>${h}</tr></thead><tbody>${r}</tbody></table>`;
  });
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>[\s\S]+?<\/li>)/g, '<ul>$1</ul>');
  html = html.replace(/\n{2,}/g, '<br><br>');
  return html;
}
</script>

<template>
  <div class="topbar">
    <h1><Icon name="sword" :size="18" /> POE2 BD 配装助手</h1>
    <div class="tabs">
      <button :class="['tab', tab === 'bd' && 'active']" @click="tab = 'bd'"><Icon name="clipboard" :size="14" /> BD 详情</button>
      <button :class="['tab', tab === 'compare' && 'active']" @click="tab = 'compare'"><Icon name="compare" :size="14" /> 两码对比</button>
      <button :class="['tab', tab === 'doc' && 'active']" @click="tab = 'doc'"><Icon name="file" :size="14" /> 文档对比</button>
      <button :class="['tab', tab === 'knowledge' && 'active']" @click="tab = 'knowledge'"><Icon name="book" :size="14" /> 知识库</button>
      <button :class="['tab', tab === 'settings' && 'active']" @click="tab = 'settings'"><Icon name="settings" :size="14" /> AI 设置</button>
    </div>
  </div>

  <div class="content">
    <!-- BD 详情页 -->
    <div v-show="tab === 'bd'">
      <div class="card">
        <h3>查询 BD</h3>
        <div class="row">
          <input type="text" v-model="shareCode" placeholder="粘贴分享码或完整链接(https://www.wegame.com.cn/helper/poe2/#/share/...)" @keyup.enter="fetchBD" :disabled="loading" />
          <button @click="fetchBD" :disabled="loading">{{ loading ? '抓取中...' : '查询' }}</button>
        </div>
        <div v-if="error" class="notice err"><Icon name="error" :size="14" /> {{ error }}</div>
      </div>

      <template v-if="bd">
        <!-- AI 分析区 -->
        <div class="card ai-card">
          <h3><Icon name="robot" :size="16" /> AI 配装分析</h3>
          <div v-if="!hasApi()" class="notice">
            未配置 API Key,可点击「导出文本」复制 BD 报告,粘贴到网页版 AI 自己问;或在「AI 设置」配置后启用自动分析。
          </div>
          <div class="row" style="margin-top: 10px; align-items: flex-start; flex-direction: column; gap: 8px;">
            <input type="text" v-model="aiQuestion" placeholder="你想问 AI 什么?(可自定义问题)" :disabled="aiAnalyzing" v-if="hasApi()" style="width:100%" />
            <div class="row" style="width:100%">
              <button v-if="hasApi()" @click="analyzeAI" :disabled="aiAnalyzing">{{ aiAnalyzing ? 'AI 分析中...' : '自动分析' }}</button>
              <button class="secondary" @click="exportText" :disabled="aiAnalyzing"><Icon name="copy" :size="14" /> 导出文本(复制)</button>
            </div>
          </div>
          <div v-if="aiError" class="notice err"><Icon name="error" :size="14" /> {{ aiError }}</div>
          <div v-if="aiThinking" class="ai-thinking">
            <details>
              <summary style="cursor:pointer;color:var(--text-dim);font-size:12px">🧠 AI 思考过程 ({{ aiThinking.length }} 字)</summary>
              <div class="ai-thinking-content">{{ aiThinking }}</div>
            </details>
          </div>
          <div v-if="aiResult" class="ai-result" v-html="renderMd(aiResult)"></div>
        </div>

        <div class="card" v-if="bd.role">
          <h3>角色信息</h3>
          <div class="stats">
            <div class="stat"><span class="label">角色名</span><span class="value">{{ bd.role.name }}</span></div>
            <div class="stat"><span class="label">职业</span><span class="value">{{ bd.role.class_name }}</span></div>
            <div class="stat"><span class="label">等级</span><span class="value">{{ bd.role.level }}</span></div>
            <div class="stat"><span class="label">进度</span><span class="value">{{ bd.role.phrase }}</span></div>
            <div class="stat"><span class="label">本赛季时长</span><span class="value">{{ toHours(bd.role.season_game_duration) }}h</span></div>
          </div>
        </div>

        <div class="card" v-if="bd.panel">
          <h3>面板属性</h3>
          <div class="stats">
            <div class="stat"><span class="label">生命</span><span class="value">{{ bd.panel.life }}</span></div>
            <div class="stat"><span class="label">魔力</span><span class="value">{{ bd.panel.mana }}</span></div>
            <div class="stat"><span class="label">精魂</span><span class="value">{{ bd.panel.spirit }}</span></div>
            <div class="stat"><span class="label">能量护盾</span><span class="value">{{ bd.panel.energy_shield }}</span></div>
            <div class="stat"><span class="label">护甲</span><span class="value">{{ bd.panel.armour }}</span></div>
            <div class="stat"><span class="label">闪避值</span><span class="value">{{ bd.panel.evasion_rating }}</span></div>
            <div class="stat"><span class="label">格挡率</span><span class="value">{{ bd.panel.block_chance }}%</span></div>
          </div>
          <div class="stats" style="margin-top: 12px;">
            <div class="stat"><span class="label">火抗</span><span :class="['value', resistClass(bd.panel.fire_resistance)]">{{ bd.panel.fire_resistance }}%</span></div>
            <div class="stat"><span class="label">冰抗</span><span :class="['value', resistClass(bd.panel.cold_resistance)]">{{ bd.panel.cold_resistance }}%</span></div>
            <div class="stat"><span class="label">雷抗</span><span :class="['value', resistClass(bd.panel.lightning_resistance)]">{{ bd.panel.lightning_resistance }}%</span></div>
            <div class="stat"><span class="label">混沌抗</span><span :class="['value', resistClass(bd.panel.chaos_resistance)]">{{ bd.panel.chaos_resistance }}%</span></div>
          </div>
        </div>

        <div class="card" v-if="bd.dimension">
          <h3>维度评分 (满分100)</h3>
          <div class="stats">
            <div class="stat"><span class="label">综合</span><span class="value">{{ bd.dimension.score }}</span></div>
            <div class="stat"><span class="label">生存</span><span class="value">{{ bd.dimension.survival }}</span></div>
            <div class="stat"><span class="label">宝藏</span><span class="value">{{ bd.dimension.treasure }}</span></div>
            <div class="stat"><span class="label">清图</span><span class="value">{{ bd.dimension.clear }}</span></div>
            <div class="stat"><span class="label">战胜</span><span class="value">{{ bd.dimension.beat }}</span></div>
          </div>
        </div>

        <div class="card" v-if="bd.skillGroups && bd.skillGroups.length">
          <h3>技能组 ({{ bd.skillGroups.length }} 个)</h3>
          <div v-for="(g, i) in bd.skillGroups" :key="i" class="equip-item" :style="{ borderLeftColor: g.isSupport ? 'var(--warn)' : 'var(--accent)' }">
            <div class="equip-title">
              <span class="tag" :style="{ background: g.isSupport ? 'var(--warn)' : 'var(--accent-dim)', color: '#fff' }">{{ g.isSupport ? '辅助' : '主动' }}</span>
              {{ g.name }}
            </div>
            <div v-if="g.supportGems && g.supportGems.length" class="mod-group">
              <div class="mod-label">辅助宝石 ({{ g.supportGems.length }})</div>
              <div v-for="(sg, j) in g.supportGems" :key="j" class="mod-line"><Icon name="diamond" :size="10" /> {{ sg.name }}</div>
            </div>
            <div v-if="g.secDescr" class="equip-meta" style="margin-top: 4px; font-size: 11px;">{{ g.secDescr }}</div>
          </div>
        </div>

        <div class="card" v-if="bd.equipments && bd.equipments.length">
          <h3>装备 ({{ bd.equipments.length }} 件)</h3>
          <div v-for="(eq, i) in bd.equipments" :key="i" class="equip-item">
            <div class="equip-title">
              {{ eq.name ? eq.name + ' ' + eq.typeLine : eq.typeLine }}
              <span :class="['tag', rarityClass(eq.rarity)]">{{ eq.rarity }}</span>
              <span class="tag">iLvl {{ eq.ilvl }}</span>
              <span v-if="eq.corrupted" class="tag" style="background: var(--danger); color: #fff;">已腐化</span>
            </div>
            <div class="equip-meta">{{ eq.slotName }}</div>
            <div v-if="eq.grantedSkills?.length" class="mod-group"><div class="mod-label">赋予技能</div><div v-for="g in eq.grantedSkills" :key="g" class="mod-line">{{ g }}</div></div>
            <div v-if="eq.implicitMods?.length" class="mod-group"><div class="mod-label">隐式词条</div><div v-for="m in eq.implicitMods" :key="m" class="mod-line">{{ m }}</div></div>
            <div v-if="eq.explicitMods?.length" class="mod-group"><div class="mod-label">显式词条</div><div v-for="m in eq.explicitMods" :key="m" class="mod-line">{{ m }}</div></div>
            <div v-if="eq.runeMods?.length" class="mod-group"><div class="mod-label">符文词条</div><div v-for="m in eq.runeMods" :key="m" class="mod-line">{{ m }}</div></div>
            <div v-if="eq.utilityMods?.length" class="mod-group"><div class="mod-label">咒符效果</div><div v-for="m in eq.utilityMods" :key="m" class="mod-line">{{ m }}</div></div>
            <div v-if="eq.socketedItems?.length" class="mod-group">
              <div class="mod-label">镶嵌物</div>
              <div v-for="(si, j) in eq.socketedItems" :key="j">
                <div class="mod-line"><Icon name="diamond" :size="10" /> {{ si.name ? si.name + ' ' + si.typeLine : si.typeLine }}</div>
                <div v-for="m in si.explicitMods" :key="m" class="mod-line" style="padding-left: 24px; color: var(--text-dim); font-size: 11px;">{{ m }}</div>
                <div v-for="m in si.bondedMods" :key="'b'+m" class="mod-line" style="padding-left: 24px; color: var(--accent); font-size: 11px;">[羁绊] {{ m }}</div>
              </div>
            </div>
          </div>
        </div>

        <div class="card" v-if="bd.currency || bd.summary">
          <h3>赛季数据</h3>
          <div v-if="bd.currency" class="stats">
            <div class="stat"><span class="label">神圣石累计</span><span class="value">{{ bd.currency.total_divine_count }}</span></div>
            <div class="stat"><span class="label">崇高石累计</span><span class="value">{{ bd.currency.total_exalted_count }}</span></div>
          </div>
          <div v-if="bd.summary" class="notice" style="margin-top: 12px;">
            <strong>{{ bd.summary.summary_title }}</strong><br />{{ bd.summary.summary_content }}
          </div>
        </div>
      </template>

      <div v-else-if="!loading" class="empty">
        输入分享码,查看完整 BD 数据<br />
        <small>数据通过 Electron 主进程抓取,无 CORS 限制</small>
      </div>
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

