// 数据获取:从 PoB2 GitHub 仓库下载关键数据文件
// 不 clone 整库(几百MB),只下载 src/Data 下的数据文件

const https = require('https');
const path = require('path');

const RAW_BASE = 'https://raw.githubusercontent.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/master/src/Data';

// 要下载的文件清单(按类别)——精简为核心数据,避免下太多
const FILES = {
  skills: [
    'Skills/act_str.lua', 'Skills/act_dex.lua', 'Skills/act_int.lua',
    'Skills/sup_str.lua', 'Skills/sup_dex.lua', 'Skills/sup_int.lua',
  ],
  mods: [
    'ModItem.lua', 'ModRunes.lua',
  ],
  bases: [
    'Bases/amulet.lua', 'Bases/belt.lua', 'Bases/body.lua', 'Bases/boots.lua',
    'Bases/gloves.lua', 'Bases/helmet.lua', 'Bases/ring.lua', 'Bases/shield.lua',
    'Bases/spear.lua', 'Bases/staff.lua', 'Bases/wand.lua', 'Bases/crossbow.lua',
  ],
};

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 404) return resolve(null);
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

/**
 * 并发下载所有数据文件(分批,每批 CONCURRENCY 个,避免被限流)
 * @param {function} onProgress (done, total, currentFile) => void
 */
async function fetchAll(onProgress) {
  const result = { skills: {}, mods: {}, bases: {} };
  const allTasks = [];
  for (const [cat, files] of Object.entries(FILES)) {
    for (const f of files) allTasks.push({ cat, file: f });
  }
  const total = allTasks.length;
  let done = 0;
  const CONCURRENCY = 6;

  for (let i = 0; i < allTasks.length; i += CONCURRENCY) {
    const batch = allTasks.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async ({ cat, file }) => {
        const url = `${RAW_BASE}/${file}`;
        try {
          const content = await fetchText(url);
          if (content) result[cat][file] = content;
        } catch (e) {
          console.error(`[fetcher] ${file} 失败: ${e.message}`);
        }
        done++;
        if (onProgress) onProgress(done, total, file);
      })
    );
  }
  return result;
}

module.exports = { fetchAll, fetchText, FILES };
