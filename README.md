# POE2 BD 智能配装助手

Electron 桌面应用,双击即用。输入分享码查看完整 BD,支持 AI 自动分析和导出文本两种模式。

## ✨ 功能

| 页面 | 功能 |
|---|---|
| 📋 **BD 详情** | 输入分享码,看角色/面板/全装备词条/评分;可 AI 分析配装建议或导出文本 |
| 🔁 **两码对比** | 输入两个分享码,AI 逐条对比两份 BD |
| 📄 **文档对比** | 输入分享码 + 上传目标 BD 文档(Word/PPT/TXT),AI 对比找差距 |
| ⚙️ **AI 设置** | 配置大模型 API(OpenAI 兼容格式) |

## 🚀 启动

### 开发模式(热更新)
```bash
cd D:\codex\流放之路\poe2-bd-app
npm run dev
```
会同时启动 Vite(前端)和 Electron(桌面窗口),自动打开应用。

### 生产模式(用构建产物)
```bash
npm run build    # 构建前端
npm start        # 启动 Electron 加载构建产物
```

## 🔑 AI 双模式

- **自动分析**:在「⚙️ AI 设置」填 API 配置后,各页面的「🔑 自动分析」按钮可直接调用大模型(流式输出)。兼容 OpenAI 格式:
  - 智谱 GLM:`https://open.bigmodel.cn/api/paas/v4` + Key + 模型如 `glm-4-flash`
  - 通义千问:`https://dashscope.aliyuncs.com/compatible-mode/v1` + Key + 模型如 `qwen-plus`
  - DeepSeek:`https://api.deepseek.com` + Key + 模型如 `deepseek-chat`
  - OpenAI:`https://api.openai.com/v1` + Key + 模型如 `gpt-4o-mini`
- **导出文本**:不填 Key 也能用,点「📋 导出文本」复制完整 BD 报告,粘贴到任意网页版 AI 自己问。

## 🏗️ 架构

```
渲染进程 (Vue3 网页 UI)  ──IPC──>  主进程 (Node, 无 CORS)
  输入分享码/上传文档                  ├ poe2.js   → 直接 fetch WeGame API
  展示BD/AI结果                        ├ ai.js     → 大模型流式调用
                                       ├ doc.js    → 文档解析
                                       └ export.js → 导出文本+prompt模板
```

Electron 主进程是 Node,fetch 不受浏览器 CORS 限制,可直接调用 WeGame API。

## 📁 结构

```
poe2-bd-app/
├── electron/                # 主进程
│   ├── main.js             # 窗口 + IPC 注册
│   ├── preload.js          # 安全桥接
│   └── services/
│       ├── poe2.js         # BD 抓取(7接口+装备解析)
│       ├── ai.js           # 大模型调用(OpenAI兼容,流式)
│       ├── doc.js          # 文档解析(Word/PPT/TXT/图片)
│       └── export.js       # 导出文本 + prompt模板
├── src/                     # 渲染进程(Vue3)
│   ├── App.vue             # 主框架 + BD详情页
│   ├── CompareView.vue     # 两码对比页
│   ├── DocCompareView.vue  # 文档对比页
│   └── style.css
├── index.html
└── vite.config.js
```

## 📌 说明
- BD 数据匿名抓取(分享码),无需任何登录
- AI 分析依赖用户自配 API Key,工具不内置任何 Key
- API 配置持久化保存在系统 userData 目录
