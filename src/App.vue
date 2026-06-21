<script setup>
import { ref } from 'vue';
import ChatView from './ChatView.vue';
import SettingsPanel from './SettingsPanel.vue';

const showSettings = ref(false);

// 设置(与 ChatView 共享)
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
loadSettings();

async function loadSettings() {
  try {
    const s = await window.api.getSettings();
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
      ...s,
    };
  } catch (_) {}
}
</script>

<template>
  <ChatView :settings="settings" :onOpenSettings="() => showSettings = true" />
  <SettingsPanel v-if="showSettings" :settings="settings" @close="showSettings = false" />
</template>
