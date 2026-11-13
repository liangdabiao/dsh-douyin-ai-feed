// 抖音热点日报 · Host 半边（douyin_ai 原生工具 + 技能提供方 + 工作流注入 + 面板数据面）。
// 抓取/聚类/HTML 是纯数据操作由工具完成；话题总结由会话模型按技能输出。
import Schema from '@deepseek-ai/schemastery'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSkillProvider } from '../lib/skills.js'
import { systemSection } from './systemPrompt.js'
import { registerApi } from '../lib/api.js'
import { fetchArticles, resolveApiKey, resolveApiBase, resolveQueryDate, DEFAULT_KEYWORD } from '../lib/redfox.js'
import { clusterArticles, computeStats } from '../lib/cluster.js'
import { normalizeArticles, dedupeByKey } from '../lib/normalize.js'
import { generateReport, renderClustersText, formatNumber } from '../lib/report.js'
import { saveReport, getReportMeta, getReportRaw, listReports, deleteReport, saveReportHtml, readReportHtml, getSettings } from '../lib/store.js'

export const name = 'douyin-ai-feed' // = cordis.patch.yml 的 id

export const inject = ['tools', 'skills', 'systemPrompt', 'webServer', 'connection']

export const Config = Schema.object({
  injectRules: Schema.boolean().default(true).description('注入 抖音热点日报工作流到系统提示'),
  apiKey: Schema.string().default('').description('RedFox API Key（ak_ 开头；留空读面板设置或环境变量 REDFOX_API_KEY）'),
  proxyUrl: Schema.string().default('').description('HTTP(S) 代理（访问 redfox.hk 用），留空直连'),
  defaultKeyword: Schema.string().default('AI').description('默认搜索关键词'),
})

function check(args, spec) {
  const problems = []
  for (const key of spec.required || []) {
    if (args?.[key] === undefined) problems.push(`缺少必填参数 ${key}`)
  }
  for (const [key, rule] of Object.entries(spec.properties || {})) {
    const value = args?.[key]
    if (value === undefined) continue
    if (rule.enum && !rule.enum.includes(value)) problems.push(`${key} 只能是 ${rule.enum.join(' / ')} 之一`)
  }
  for (const key of Object.keys(args || {})) {
    if (!spec.properties || !(key in spec.properties)) problems.push(`未知参数 ${key}`)
  }
  if (problems.length) throw new Error(`参数有误：${problems.join('；')}。`)
}

const str = (description, extra = {}) => ({ type: 'string', description, ...extra })
const num = (description, extra = {}) => ({ type: 'number', description, ...extra })
const text = (value) => [{ type: 'text', text: value }]

const OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['ok', 'summary'],
    properties: {
      ok: { type: 'boolean' },
      summary: { type: 'string', description: '给模型看的回执' },
      data: { type: 'string', description: '可选：分类作品一览' },
    },
  },
  render: (_args, value) => text(value.data ? `${value.summary}\n\n${value.data}` : value.summary),
}

const result = (ok, summary, data = '') => ({ ok, summary, data })

const MAX_TEXT = 56000

function resolveReport(rid) {
  if (rid) {
    const meta = getReportMeta(rid)
    if (!meta) throw new Error(`日报不存在：${rid}。用 history 查看。`)
    return meta
  }
  const [latest] = listReports({ limit: 1 })
  if (!latest) throw new Error('还没有日报。先 fetch。')
  return getReportMeta(latest.report_id)
}

// ---------------------------------------------------------------------------
// 工具：douyin_ai —— fetch / clusters / html / history
// ---------------------------------------------------------------------------
export const douyinAiTool = {
  name: 'douyin_ai',
  description:
    '抖音热点日报：按关键词扫描抖音热门作品（默认 AI），按互动量排序、type/topic 两轮自动聚类，' +
    '生成深色青风 HTML 日报（封面图/数据指标/作品直链）。' +
    '流程：fetch（同步秒回，16 点日期规则自动判断查昨天/前天）→ 按分类作品一览输出总结 → html 生成日报。' +
    '分类完全由当天内容决定；每日 16 点更新前一天数据；要每日推送用 dsh 定时任务。需要 RedFox API Key。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: str('fetch 抓取+聚类；clusters 读分类明细；html 生成日报；history 历史', {
        enum: ['fetch', 'clusters', 'html', 'history'],
      }),
      keyword: str('fetch：搜索关键词（默认 AI；如 ChatGPT、AI视频）'),
      pageSize: num('fetch：每次查询条数，默认 200（上游默认）'),
      date: str('fetch：指定日期 YYYY-MM-DD；缺省按 16 点规则自动（≥16 点查昨天，否则前天）'),
      startTime: str('fetch：开始时间 YYYY-MM-DD（含）；与 endTime 配合替代 date'),
      endTime: str('fetch：结束时间 YYYY-MM-DD（不含）'),
      reportId: str('clusters/html/history 定位日报；缺省=最新'),
      perCluster: num('clusters：每个分类最多返回几条作品，默认 10'),
    },
  },
  output: OUTPUT,
  async execute(args, ctxConfig) {
    check(args, this.parameters)
    const cfg = ctxConfig || {}

    // ── fetch ────────────────────────────────────────────────────────────
    if (args.action === 'fetch') {
      const settings = getSettings()
      const apiKey = resolveApiKey({ settings, config: cfg })
      if (!apiKey) {
        return result(false, '未配置 RedFox API Key。请用户到面板「抖音热点日报 → 设置」填入，或在插件配置/环境变量 REDFOX_API_KEY 里配置（获取：https://www.redfox.hk/settings/api-keys?source=github）。')
      }
      const keyword = String(args.keyword || cfg.defaultKeyword || DEFAULT_KEYWORD).trim() || DEFAULT_KEYWORD
      const pageSize = Math.min(Math.max(Number(args.pageSize) || 200, 10), 200)
      const { date, startTime, endTime } = resolveQueryDate({ date: args.date, startTime: args.startTime, endTime: args.endTime })
      const rawArticles = await fetchArticles({
        keyword, pageSize, startTime, endTime,
        apiKey, apiBase: resolveApiBase({ settings }),
      })
      const articles = normalizeArticles(dedupeByKey(rawArticles))
      if (!articles.length) {
        return result(false,
          `未获取到任何作品（keyword="${keyword}"，日期 ${date}）。如实告知用户，建议换关键词（如 ChatGPT、AI视频）或换日期，不要编造。`)
      }
      const clusters = clusterArticles(articles)
      const stats = computeStats(articles)
      const meta = saveReport({ raw: articles, keyword, date, clusters, stats })
      const text = renderClustersText(clusters)
      return result(true,
        `日报已入库（reportId=${meta.report_id}，关键词「${keyword}」数据日期 ${date}，${meta.total} 篇作品 / ${meta.topic_count} 个分类，平均点赞 ${formatNumber(meta.avg_likes)}）。` +
        `把下面的分类作品一览完整输出给用户（分类由当天内容聚类决定），再问是否生成 HTML 日报（action="html"）或订阅每日推送（dsh 定时任务）。`,
        text.slice(0, MAX_TEXT))
    }

    // ── clusters ─────────────────────────────────────────────────────────
    if (args.action === 'clusters') {
      const meta = resolveReport(args.reportId)
      const raw = getReportRaw(meta.report_id)
      const clusters = clusterArticles(raw || [])
      const per = Math.min(Number(args.perCluster) || 10, 50)
      const text = renderClustersText(clusters, { perCluster: per })
      return result(true,
        `「${meta.keyword}」${meta.date} 日报：${meta.total} 篇 / ${meta.topic_count} 分类（每分类最多 ${per} 条）。`,
        text.slice(0, MAX_TEXT))
    }

    // ── html ─────────────────────────────────────────────────────────────
    if (args.action === 'html') {
      const meta = resolveReport(args.reportId)
      const raw = getReportRaw(meta.report_id)
      const clusters = clusterArticles(raw || [])
      const html = generateReport(clusters, raw || [], meta.date)
      const file = saveReportHtml(meta.report_id, html)
      return result(true,
        `HTML 日报已生成：${file}。` +
        '桌面端 WebContentsView 会 deny window.open/target=_blank，日报只能在面板内查看——' +
        '告诉用户点侧栏「抖音热点日报」→「报告」页（或该日报页）的「打开 HTML 日报」，不要把磁盘路径当成可点开的入口。',
        `报告文件: ${file}\n面板入口: 侧栏「抖音热点日报」→「报告」→「打开日报」`)
    }

    // ── history ──────────────────────────────────────────────────────────
    if (args.action === 'history') {
      const list = listReports({ limit: 20 })
      if (!list.length) return result(false, '还没有日报。先 fetch。')
      const lines = list.map((r) => `${r.report_id}｜「${r.keyword}」${r.date}｜${r.total} 篇 / ${r.topic_count} 分类`)
      return result(true, `共 ${list.length} 份日报（新→旧）。对旧日报补 HTML/读明细传 reportId。`, lines.join('\n'))
    }

    throw new Error(`未知 action：${args.action}`)
  },
}

// ---------------------------------------------------------------------------
// 装配
// ---------------------------------------------------------------------------
export function apply(ctx, config) {
  const skillDirs = [join(dirname(fileURLToPath(import.meta.url)), '..', 'skills')]

  const toolWithConfig = { ...douyinAiTool, execute(args) { return douyinAiTool.execute(args, config) } }

  ctx.effect(() => ctx.tools.register(toolWithConfig), `${name}: tool`)
  ctx.effect(() => ctx.skills.registerProvider(() => createSkillProvider(skillDirs)), `${name}: skills`)
  if (config.injectRules !== false) {
    ctx.effect(() => ctx.systemPrompt.section(systemSection()), `${name}: workflow`)
  }
  ctx.effect(() => registerApi(ctx, { config }), `${name}: routes`)
}
