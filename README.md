# dsh-douyin-ai-feed · 抖音热点日报

DeepSeek Harness（dsh）插件：**每日扫描抖音热门作品，自动聚类生成深色青风 HTML 日报**。16 点日期规则、type/topic 两轮自动聚类、互动量排序、封面图+作品直链，侧栏看板。

移植自 [redfox-data/redfox-community](https://github.com/redfox-data/redfox-community) 的 `skills/douyin-ai-feed`（Python 全量重写为 Node 原生，**零 Python 依赖**；上游 report_template.html 深色模板原样复用）。
<img width="1377" height="1118" alt="image" src="https://github.com/user-attachments/assets/e8c039b8-05bf-40c8-9505-c716087db096" />

## 功能

- 🔥 **爆款发现**：按关键词搜索抖音热门作品（默认 AI，可换 ChatGPT/AI视频 等），pageSize 200
- 🧠 **两轮自动聚类**：分类完全由当天内容的 type/topic 标签决定——首标签聚类 → 小组（<2 篇）并入「其他」→ 超过总量 50% 的大类按第二标签二次拆分（`{大类}·其他` 兜底）→ 再合并；组内按点赞+分享+评论降序
- 📊 **数据指标**：总作品数/分类数/平均点赞/总分享/头号作者，数字格式 1.2k / 1.2w
- 🌙 **深色青风日报**：上游 HTML 模板原样复用（抖音 #25F4EE 主题、Archivo Black 展示字体、封面图、滚动分区卡片）
- 📅 **16 点日期规则**：每日 16 点更新前一天数据（≥16 点查昨天，<16 点查前天；支持指定日期与 startTime/endTime 自定义范围）
- 🔔 **订阅推送**：通过 dsh 定时任务实现每日 16:00 自动生成

## 工作流

```
douyin_ai(action="fetch", keyword="AI")     ← 同步 6 秒（含去重+聚类+入库）
  → 分类作品一览输出 + agent 解读今日 AI 内容风向
  → douyin_ai(action="html")                 ← 深色青风 HTML 日报
  → 用户要订阅 → dsh 定时任务（schedule_create，先确认频率）
```

## 面板（侧栏「抖音热点日报」）

- **概览**：关键词/条数查询表单 + 日报历史卡片（卡片上直接有「📄 打开日报」入口）；「去对话总结今日热点」开新对话
- **报告**：报告库页，列出全部已生成的深色青风 HTML 日报，「打开日报」在面板内覆盖层查看
- **日报页**：统计条（作品/分类/平均点赞/总分享/头号作者）+ 分类卡片流（编号/分类名/篇数 + 作品封面图+互动+直链）+ 打开/生成 HTML 日报
- **设置**：API Key、默认关键词、代理、接口地址

> ⚠️ 桌面端 dsh 的 WebContentsView 会 deny `window.open`/`target=_blank`，所以日报**不能**用新窗口打开：
> 面板改为同源 fetch 日报 HTML → `iframe.srcdoc` 在覆盖层里渲染；日报里的作品链接由宿主 `POST /api/open`
> （`lib/open.js`，系统默认浏览器打开）处理——报告 `/report` 路由会用 `injectOpenLinks` 注入点击转发脚本。
> 报告是否存在由 `meta.has_report`（宿主）给出，宿主未重启时面板用 `HEAD /api/reports/<rid>/report` 探测兜底。
> `/api/open` 是宿主路由：改完要**重启一次 dsh** 才生效（`lab/` 静态文件改完刷新面板即可）。

## 配置

**RedFox API Key**（必需，`ak_` 开头）：[红狐 hub](https://www.redfox.hk/settings/api-keys?source=github) 获取。优先级：插件配置 `apiKey` > 面板「设置」页 > 环境变量 `REDFOX_API_KEY`。

> ✅ 2026-11-13 实测：该接口**免费积分可用**，6 秒返回 200 篇真实作品（「AI」关键词聚类出 5 个分类）。

## 开发

```bash
npm i
npm run build      # client.js → dist/client.js
npm test           # 11 个单测（两轮聚类/16 点规则/统计/去重/模板填充/工具全链路）
npm run smoke      # 离线冒烟：本地假 RedFox 服务器全链路（工具 + 面板 API）
npm run live       # 真实 API 冒烟：node scripts/live.mjs <keyword> ak_xxx
npm run dev        # 面板独立预览：DSH_HOME=<目录> node scripts/devserver.mjs 5183
```

数据落在 `$DSH_HOME/douyin-ai-feed/`：`settings.json` + `reports/<rid>/`（raw/meta/report.html；同关键词+日期覆盖），原子写。上游深色模板在 `assets/report_template.html`。

## 结构

```
src/host.js            douyin_ai 工具（fetch/clusters/html/history）+ 装配
src/systemPrompt.js    工作流硬规则注入
lib/redfox.js          POST queryDyAiMsgs（3108 退避、3106/3107 Key 错误翻译）+ 16 点日期规则
lib/cluster.js         两轮自动聚类（逐行对齐上游 cluster_articles）+ 统计
lib/normalize.js       条目归一化 + photoId 去重（无 ID 不按标题合并）
lib/report.js          上游模板占位符填充 + 分区卡片渲染 + 内置兜底模板
lib/store.js           reports/<rid> 持久化 + 设置
lib/api.js             /douyin-ai-feed 面板路由
client.js / lab/       浏览器半边（侧栏入口 + iframe 面板，明暗跟随 dsh 主题）
assets/report_template.html   上游深色青风模板（原样复用）
skills/douyin-ai-feed/ 方法论技能（输出要求 dsh 适配版）
```

## License

MIT（本插件代码）。方法论、模板与 API 用例参考 redfox-data/redfox-community skills/douyin-ai-feed（上游未附许可证文件，仅作技术参考）；RedFox API 使用受其服务条款约束。
