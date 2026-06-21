<script setup>
import { ref, onMounted } from 'vue';
import Icon from './Icons.vue';

const props = defineProps({ settings: Object });
const emit = defineEmits(['close']);

const savedTip = ref('');
const testing = ref(false);
const testResult = ref('');
const testMsg = ref('');
const localModels = ref([]);

onMounted(async () => {
  try {
    const res = await window.api.kbGetLocalModels();
    if (res.ok) localModels.value = res.models;
  } catch (_) {}
});

async function saveSettings() {
  savedTip.value = '保存中...';
  try {
    const plainSettings = {
      apiFormat: props.settings.apiFormat,
      apiBaseUrl: props.settings.apiBaseUrl,
      apiKey: props.settings.apiKey,
      apiModel: props.settings.apiModel,
      thinkingLevel: props.settings.thinkingLevel,
      embeddingModel: props.settings.embeddingModel,
      embeddingMode: props.settings.embeddingMode,
      localModelName: props.settings.localModelName,
      proxyUrl: props.settings.proxyUrl,
    };
    const res = await window.api.saveSettings(plainSettings);
    savedTip.value = res?.ok ? '保存成功!' : '保存失败';
  } catch (e) {
    savedTip.value = '异常: ' + e.message;
  }
  setTimeout(() => { savedTip.value = ''; }, 2000);
}

async function testConn() {
  if (!props.settings.apiBaseUrl || !props.settings.apiKey) {
    testResult.value = 'err'; testMsg.value = '请先填写 URL 和 Key'; return;
  }
  if (!props.settings.apiModel) {
    testResult.value = 'err'; testMsg.value = '请先填写模型名'; return;
  }
  testing.value = true; testResult.value = ''; testMsg.value = '测试中...';
  try {
    const res = await window.api.testAI({
      apiFormat: props.settings.apiFormat,
      apiBaseUrl: props.settings.apiBaseUrl,
      apiKey: props.settings.apiKey,
      apiModel: props.settings.apiModel,
      thinkingLevel: props.settings.thinkingLevel,
    });
    testResult.value = res.ok ? 'ok' : 'err';
    testMsg.value = res.ok ? '连接成功!' + (res.reply ? ` "${res.reply}"` : '') : res.error;
  } catch (e) {
    testResult.value = 'err'; testMsg.value = e.message;
  } finally { testing.value = false; }
}

function onFormatChange() { testResult.value = ''; testMsg.value = ''; }
</script>

<template>
  <div class="settings-overlay" @click.self="emit('close')">
    <div class="settings-panel">
      <div class="sp-header">
        <h3>⚙ 设置</h3>
        <button class="icon-btn" @click="emit('close')">×</button>
      </div>
      <div class="sp-body">
        <div class="form-grid">
          <div class="form-row">
            <label>API 格式</label>
            <div class="row">
              <label class="radio"><input type="radio" v-model="settings.apiFormat" value="openai" @change="onFormatChange" /> OpenAI</label>
              <label class="radio"><input type="radio" v-model="settings.apiFormat" value="anthropic" @change="onFormatChange" /> Anthropic</label>
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
            <label>思考深度</label>
            <select v-model="settings.thinkingLevel">
              <option value="max">最高(推荐)</option>
              <option value="high">高</option>
              <option value="low">低</option>
              <option value="off">关闭</option>
            </select>
          </div>
          <div class="form-row">
            <label>知识库模型</label>
            <select v-model="settings.localModelName">
              <option v-for="m in localModels" :key="m.id" :value="m.id">
                {{ m.desc }} {{ m.downloaded ? '✓' : '(需下载)' }}
              </option>
            </select>
          </div>
          <div class="form-row">
            <label>下载代理</label>
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
              <button @click="saveSettings">💾 保存</button>
              <span v-if="savedTip" class="ok-tip">{{ savedTip }}</span>
            </div>
            <div v-if="testMsg" :class="['test-msg', testResult]">{{ testMsg }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 100; display: flex; justify-content: flex-end; }
.settings-panel { width: 400px; background: var(--bg-card); height: 100%; display: flex; flex-direction: column; box-shadow: -4px 0 20px rgba(0,0,0,0.3); }
.sp-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--border); }
.sp-header h3 { margin: 0; }
.sp-body { flex: 1; overflow-y: auto; padding: 20px; }
.form-grid { display: flex; flex-direction: column; gap: 16px; }
.form-row { display: flex; flex-direction: column; gap: 6px; }
.form-row > label { font-size: 12px; color: var(--text-dim); font-weight: 600; }
.form-row input[type="text"], .form-row select { width: 100%; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 9px 12px; color: var(--text); font-size: 13px; outline: none; }
.form-row input:focus, .form-row select:focus { border-color: var(--accent); }
.radio { display: flex; align-items: center; gap: 5px; font-size: 13px; color: var(--text); cursor: pointer; }
.radio input { accent-color: var(--accent); }
.preset-row { display: flex; gap: 6px; margin-top: 4px; }
.preset-btn { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 4px 10px; font-size: 11px; cursor: pointer; color: var(--text-dim); }
.preset-btn:hover { border-color: var(--accent); color: var(--text); }
.test-msg { font-size: 12px; margin-top: 6px; }
.test-msg.ok { color: var(--success); }
.test-msg.err { color: var(--danger); }
.ok-tip { color: var(--success); font-size: 12px; }
.icon-btn { background: none; border: none; color: var(--text-dim); cursor: pointer; font-size: 20px; padding: 4px 8px; }
.icon-btn:hover { color: var(--text); }
</style>
