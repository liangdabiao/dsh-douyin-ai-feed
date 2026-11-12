// 真实网络冒烟：默认关键词 AI 生成今日日报（16 点日期规则），打印分类概览并生成 HTML。
//   DSH_HOME=<目录> node scripts/live.mjs [keyword] [ak_xxx]
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [, , kwArg, keyArg] = process.argv
const keyword = kwArg || 'AI'
const home = process.env.DSH_HOME || join(process.env.HOME || process.env.USERPROFILE, '.dsh')

if (keyArg) {
  mkdirSync(join(home, 'douyin-ai-feed'), { recursive: true })
  writeFileSync(join(home, 'douyin-ai-feed', 'settings.json'), JSON.stringify({ api_key: keyArg }, null, 2))
  console.log('API key 已写入 settings.json')
}
const { getSettings } = await import('../lib/store.js')
if (!getSettings().api_key && !process.env.REDFOX_API_KEY) {
  console.error('缺少 RedFox API Key：node scripts/live.mjs <keyword> ak_xxx')
  process.exit(1)
}

const { douyinAiTool } = await import('../src/host.js')
const call = (args) => douyinAiTool.execute(args, {})

console.log(`真实抓取：「${keyword}」今日日报`)
const t0 = Date.now()
const r = await call({ action: 'fetch', keyword })
console.log(`\n[${Math.round((Date.now() - t0) / 1000)}s] ${r.summary}`)
if (r.data) console.log('\n' + r.data.split('\n').slice(0, 18).join('\n') + '\n…')
if (r.ok) {
  const rid = r.summary.match(/reportId=([\p{L}\p{N}-]+)/u)?.[1]
  const rep = await call({ action: 'html', reportId: rid })
  console.log(`\n${rep.summary}`)
}
