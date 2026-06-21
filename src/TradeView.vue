<script setup>
import { ref, onMounted } from 'vue';

// 接收 App.vue 透传的自动搜索结果(AI 分析后自动搜的)
const props = defineProps({ autoResults: Object });

const loginStatus = ref(null);
const searching = ref(false);
const searchType = ref('');
const searchResults = ref(null);
const error = ref('');

onMounted(async () => {
  await checkLogin();
  // 有自动搜索结果则展示
  if (props.autoResults) {
    searchResults.value = props.autoResults;
  }
});

async function checkLogin() {
  loginStatus.value = await window.api.tradeCheckLogin();
}

async function openLogin() {
  await window.api.tradeOpenLogin();
  // 登录窗口关闭后会触发 login-changed,这里也手动刷新下
  setTimeout(checkLogin, 2000);
}

async function search() {
  if (!searchType.value.trim()) {
    error.value = '请输入物品类型';
    return;
  }
  searching.value = true;
  error.value = '';
  searchResults.value = null;
  try {
    const res = await window.api.tradeSearch({ type: searchType.value.trim(), limit: 20 });
    if (!res.ok) throw new Error(res.error);
    searchResults.value = { results: [{ need: searchType.value.trim(), total: res.result.total, items: res.result.items }] };
  } catch (e) {
    error.value = e.message;
  } finally {
    searching.value = false;
  }
}

const rarityMap = { 0: '普通', 1: '魔法', 2: '稀有', 3: '传奇' };
</script>

<template>
  <!-- 登录状态 -->
  <div class="card">
    <h3>🛒 市集登录</h3>
    <div v-if="loginStatus === null" class="notice">检查登录态中...</div>
    <div v-else-if="loginStatus.loggedIn" class="notice" style="border-color:var(--success);color:var(--success)">
      ✓ 已登录市集(QQ 登录态有效)
    </div>
    <div v-else class="notice err">
      ⚠️ 未登录:{{ loginStatus.reason || '请先登录' }}
      <button class="secondary" style="margin-left:12px" @click="openLogin">打开市集登录</button>
    </div>
  </div>

  <!-- 搜索 -->
  <div class="card" v-if="loginStatus?.loggedIn">
    <h3>🔍 搜装备</h3>
    <div class="notice">输入物品类型(国服中文名),如:翡翠戒指、飞翼长矛、海螺头盔</div>
    <div class="row" style="margin-top:10px">
      <input type="text" v-model="searchType" placeholder="如 翡翠戒指" @keyup.enter="search" :disabled="searching" />
      <button @click="search" :disabled="searching">{{ searching ? '搜索中...' : '搜索' }}</button>
    </div>
    <div v-if="error" class="notice err">❌ {{ error }}</div>
  </div>

  <!-- 结果 -->
  <div v-if="searchResults">
    <div v-if="searchResults.needLogin" class="card">
      <div class="notice err">⚠️ 市集未登录,AI 分析后的装备推荐无法自动搜索。请先在上方登录市集。</div>
    </div>
    <div v-else-if="searchResults.note" class="card">
      <div class="notice">{{ searchResults.note }}</div>
    </div>
    <template v-else>
      <div v-for="(group, gi) in searchResults.results" :key="gi" class="card">
        <h3>{{ group.need || group.need?.type }} <span style="font-weight:normal;color:var(--text-dim);font-size:12px">{{ group.reason }}</span></h3>
        <div v-if="group.error" class="notice err">❌ {{ group.error }}</div>
        <template v-else>
          <div class="notice">共 {{ group.total }} 件在售{{ group.total > 5 ? '(显示前5)' : '' }}</div>
          <div v-for="(item, i) in group.items" :key="i" class="trade-item">
            <div class="ti-head">
              <span class="ti-name">
                <span :class="['tag', 'r' + item.rarity]">{{ rarityMap[item.rarity] || '?' }}</span>
                {{ item.name ? item.name + ' ' : '' }}{{ item.typeLine }}
              </span>
              <span class="ti-price">{{ item.price }}</span>
            </div>
            <div class="ti-meta">iLvl {{ item.ilvl }} ｜ 卖家: {{ item.seller }}</div>
            <div v-if="item.explicitMods?.length" class="ti-mods">
              <div v-for="(m, j) in item.explicitMods" :key="j" class="mod-line">{{ m }}</div>
            </div>
          </div>
        </template>
      </div>
    </template>
  </div>

  <div v-else-if="!loginStatus?.loggedIn" class="empty">
    请先登录市集<br />
    <small>登录后可搜索官方市集在售装备</small>
  </div>
</template>

<style scoped>
.trade-item { background: var(--bg-card-hover); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; }
.ti-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.ti-name { font-weight: 600; }
.ti-price { color: var(--accent); font-weight: 600; font-size: 15px; }
.ti-meta { font-size: 12px; color: var(--text-dim); margin-bottom: 6px; }
.ti-mods .mod-line { font-size: 13px; padding-left: 8px; }
.tag { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 3px; margin-right: 6px; }
.tag.r0 { background: var(--border); color: var(--text-dim); }
.tag.r1 { background: #2a4a6a; color: #cfe2f0; }
.tag.r2 { background: #3a5a3a; color: #cfe8cf; }
.tag.r3 { background: var(--accent-dim); color: #fff; }
</style>
