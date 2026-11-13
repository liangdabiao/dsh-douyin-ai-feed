// RedFox API · 抖音 AI 信息源（POST queryDyAiMsgs）。
// 移植自 fetch_douyin_ai.py 的 fetch_articles：3108 限频退避 5s 重试一次；3106/3107 是 Key 错误。
import http from 'node:http'
import https from 'node:https'
import { DEFAULT_API_BASE_TOKENS } from './common.js'

export const API_PATH = '/story/api/parseWork/queryDyAiMsgs'
export const SOURCE = '抖音热点日报-dsh'
export const DEFAULT_KEYWORD = 'AI'

export function resolveApiKey({ settings = {}, config = {} } = {}) {
  return String(config.apiKey || settings.api_key || process.env.REDFOX_API_KEY || '').trim()
}

export function resolveApiBase({ settings = {} } = {}) {
  const base = String(settings.api_base || process.env.REDFOX_API_BASE || '').trim()
  return (base || DEFAULT_API_BASE_TOKENS).replace(/\/+$/, '')
}

// POST JSON（支持 http 本地假服务器；真实环境 https）
export function httpPostJson(url, body, { timeout = 30000, headers = {} } = {}) {
  const u = new URL(url)
  const transport = u.protocol === 'http:' ? http : https
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  return new Promise((resolve, reject) => {
    const req = transport.request({
      host: u.hostname,
      port: Number(u.port) || (u.protocol === 'http:' ? 80 : 443),
      method: 'POST',
      path: `${u.pathname}${u.search}`,
      headers: { 'content-type': 'application/json', 'content-length': payload.length, ...headers },
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        try { resolve({ status: res.statusCode, json: JSON.parse(text) }) }
        catch { reject(new Error(`响应不是合法 JSON（HTTP ${res.statusCode}）：${text.slice(0, 200)}`)) }
      })
    })
    req.on('error', reject)
    req.setTimeout(timeout, () => req.destroy(new Error(`请求超时（${timeout}ms）`)))
    req.end(payload)
  })
}

export function friendlyApiError(json) {
  const code = json?.code
  const msg = String(json?.msg || json?.message || '')
  if (code === 3106 || code === 3107) return new Error(`RedFox API Key 错误（${code}）：请检查面板「设置」页的 Key。${msg}`)
  if (code === 3201 || msg.includes('积分不足')) return new Error('RedFox 账户积分不足（3201）：请到 https://redfox.hk/dashboard/recharge 充值后重试。')
  if (code === 3203 || msg.includes('付费调用')) return new Error(`RedFox 接口返回 3203（上游原话：${msg || '无'}）：常见原因 ①该接口需单独开通或积分不足 ②同一 Key 请求过密被拦截 ③参数（关键词/日期/翻页）未被接受。已自动重试一次；仍失败请到 https://redfox.hk/dashboard/recharge 核对积分与接口授权，或等 1-2 分钟再试。`)
  if (code === 3108) return new Error('RedFox 限频（3108），稍等片刻再试。')
  if (code === 401 || code === 403) return new Error(`RedFox 鉴权失败（${code}）：请检查 API Key。`)
  return new Error(`API 错误（code=${code ?? '?'}）：${msg || JSON.stringify(json).slice(0, 200)}`)
}

// 获取作品列表（单次调用 + 3108 退避重试一次）
export async function fetchArticles({ keyword, pageSize = 200, startTime, endTime, apiKey, apiBase, timeout = 30000 } = {}) {
  if (!apiKey) {
    throw new Error('未配置 RedFox API Key。请到面板「设置」页填入，或在插件配置/环境变量 REDFOX_API_KEY 里配置（获取：https://www.redfox.hk/settings/api-keys?source=github）。')
  }
  const payload = { keyword, pageNum: 1, pageSize, source: SOURCE }
  if (startTime) payload.startTime = startTime
  if (endTime) payload.endTime = endTime

  const requestOnce = async () => {
    const { json } = await httpPostJson(`${apiBase}${API_PATH}`, payload, {
      timeout, headers: { 'X-API-KEY': apiKey },
    })
    return json
  }

  let result = await requestOnce()
  if (result?.code === 3108 || result?.code === 3203) {
    await new Promise((r) => setTimeout(r, result?.code === 3108 ? 5000 : 2500))
    result = await requestOnce()
  }
  if (result?.code !== 200 && result?.code !== 2000) {
    throw friendlyApiError(result)
  }
  const articles = result?.data?.list || []
  return Array.isArray(articles) ? articles : []
}

// 16 点日期规则（上游 main：查今天且 <16 点 → 前天；≥16 点 → 昨天）
export function resolveQueryDate({ date, startTime, endTime, now = new Date() } = {}) {
  let d = date
  if (!startTime && !endTime) {
    const pad = (n) => String(n).padStart(2, '0')
    const fmt = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
    if (!d || d === fmt(now)) {
      d = fmt(new Date(now.getTime() - (now.getHours() >= 16 ? 1 : 2) * 86400_000))
    }
    startTime = d
    try {
      const dt = new Date(`${d}T00:00:00`)
      endTime = fmt(new Date(dt.getTime() + 86400_000))
    } catch { /* 保持空 */ }
  }
  return { date: d, startTime, endTime }
}
