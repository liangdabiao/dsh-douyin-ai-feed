// 冒烟测试（离线）：假 RedFox 服务器 + 工具直调全链路 + 面板 API 全路由。
// 运行：npm run smoke
const { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')
const http = await import('node:http')

const tmp = mkdtempSync(join(tmpdir(), 'dsh-dy-smoke-'))
process.env.DSH_HOME = tmp
delete process.env.REDFOX_API_KEY
delete process.env.X_API_KEY

let failed = 0
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
  if (!cond) failed++
}

const mk = (i, type) => ({
  title: `AI作品${i}`, userName: `作者${i % 4}`, photoId: `p${i}`,
  coverUrl: i % 2 ? `https://img.example/c${i}.jpg` : '',
  likeCount: 5000 - i * 100, shareCount: 200, commentCount: 80, type, topic: type,
})

const srv = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    const payload = JSON.parse(body || '{}')
    const reply = (obj) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
    if (req.headers['x-api-key'] !== 'ak_smoke') return reply({ code: 3107, msg: 'bad key' })
    if (payload.keyword === '空') return reply({ code: 2000, data: { list: [] } })
    // 30 条：AI视频 20（>50% → 二次拆分）+ AI绘画 10
    const arts = []
    for (let i = 0; i < 20; i++) arts.push(mk(i, i % 3 === 0 ? 'AI视频, 教程' : i % 3 === 1 ? 'AI视频, 工具' : 'AI视频'))
    for (let i = 20; i < 30; i++) arts.push(mk(i, 'AI绘画'))
    reply({ code: 2000, data: { list: arts } })
  })
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
mkdirSync(join(tmp, 'douyin-ai-feed'), { recursive: true })
writeFileSync(join(tmp, 'douyin-ai-feed', 'settings.json'), JSON.stringify({ api_key: 'ak_smoke', api_base: `http://127.0.0.1:${srv.address().port}` }))

// ── 工具直调 ──
const { douyinAiTool } = await import('../src/host.js')
const call = async (args) => {
  try { return await douyinAiTool.execute(args, {}) } catch (e) { return { ok: false, summary: String(e?.message || e) } }
}
let rid
{
  const r = await call({ action: 'fetch', keyword: 'AI' })
  check('fetch 30 篇入库', r.ok && r.summary.includes('30 篇作品'), r.summary.slice(0, 60))
  check('fetch 二次拆分生效（教程/工具子类）', r.data.includes('【教程】') && r.data.includes('【工具】'), (r.data || '').slice(0, 200))
  check('fetch 作品直链', r.data.includes('https://www.iesdouyin.com/share/video/p0'), '')
  check('fetch 格式化数字', r.data.includes('5.0k') || r.data.includes('4.9k'), '')
  rid = r.summary.match(/reportId=([\p{L}\p{N}-]+)/u)?.[1]
}
{
  const r = await call({ action: 'html' })
  check('html 生成', r.ok && r.summary.includes('.html'), r.summary.slice(0, 50))
  const file = r.summary.match(/：(.+?\.html)/)?.[1]
  const html = readFileSync(file, 'utf8')
  check('HTML 深色青风模板', html.includes('#25F4EE') && html.includes('category-card'), '')
  check('HTML 封面图', html.includes('img.example'), '')
  check('HTML 无占位符残留', !html.includes('{{DATE}}') && !html.includes('{{CATEGORY_CARDS}}'), '')
  check('HTML 无泄漏', !html.includes('undefined') && !html.includes('[object Object]'), '')
}
{
  const r = await call({ action: 'fetch', keyword: '空' })
  check('空结果拦截', !r.ok && r.summary.includes('未获取到任何作品'), r.summary.slice(0, 40))
  const r2 = await call({ action: 'history' })
  check('history 记录数', r2.ok && r2.data.split('\n').length >= 1, `n=${r2.data.split('\n').length}`)
}

// ── 面板 API ──
const { registerApi } = await import('../lib/api.js')
const { Writable } = await import('node:stream')
const { EventEmitter } = await import('node:events')
const routes = {}
registerApi({ get: () => undefined, webServer: { register: (r) => { routes[r.path] = r.handler } } }, { config: {} })
const req = async (method, path, body) => {
  const reqObj = new EventEmitter()
  reqObj.method = method
  reqObj.url = `/douyin-ai-feed${path}`
  reqObj.headers = body ? { 'content-type': 'application/json', host: 'x', origin: 'http://x' } : { host: 'x' }
  const chunks = []
  const resObj = new Writable({ write(c, _e, cb) { chunks.push(c); cb() } })
  resObj.statusCode = 0
  resObj.writeHead = (code) => { resObj.statusCode = code }
  const done = new Promise((resolve) => {
    const origEnd = resObj.end.bind(resObj)
    resObj.end = (...args) => { origEnd(...args); resolve({ status: resObj.statusCode, json: (() => { try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return null } })() }) }
  })
  const p = routes['/douyin-ai-feed'](reqObj, resObj)
  if (body) reqObj.emit('data', Buffer.from(JSON.stringify(body)))
  reqObj.emit('end')
  await p
  return done
}
{
  const cat = await req('GET', '/api/catalog')
  check('catalog：key/默认关键词/日报', cat.status === 200 && cat.json.has_key && cat.json.default_keyword === 'AI' && cat.json.reports.length >= 1, '')
  const one = await req('GET', `/api/reports/${rid}`)
  check('report 详情带 clusters', one.status === 200 && one.json.clusters.length >= 2 && one.json.report.total === 30, `clusters=${one.json?.clusters?.length}`)
  const created = await req('POST', '/api/reports', { keyword: 'ChatGPT' })
  check('面板直查新关键词', created.status === 200 && created.json.ok && created.json.report.total === 30, '')
  const rawRep = await req('POST', `/api/reports/${rid}/report`)
  check('面板直出 HTML', rawRep.status === 200 && rawRep.json.ok, '')
  const del = await req('DELETE', `/api/reports/${created.json.report.report_id}`)
  check('面板删日报', del.status === 200 && del.json.ok, '')
}
{
  const st = await req('GET', '/api/settings')
  check('settings 尾号', st.status === 200 && st.json.settings.key_tail === '_smoke', String(st.json.settings.key_tail))
  const saved = await req('POST', '/api/settings', { default_keyword: 'ChatGPT' })
  check('settings 默认关键词保存', saved.status === 200, '')
  const bad = await req('POST', '/api/settings', { api_key: 'no-prefix' })
  check('settings 非 ak_ 拒绝', bad.status === 400, '')
}
{
  const idx = readFileSync(new URL('../lab/index.html', import.meta.url), 'utf8')
  check('lab 引用 scheme/app', idx.includes('app.js') && idx.includes('scheme.js'), '')
  const appjs = readFileSync(new URL('../lab/app.js', import.meta.url), 'utf8')
  check('lab 消息类型与 client 对齐', appjs.includes('douyin-ai-feed:refresh') && appjs.includes('douyin-ai-feed:start-ok'), '')
  const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  check('client 消息类型一致', client.includes('douyin-ai-feed:refresh') && client.includes('douyin-ai-feed:start-ok'), '')
  check('上游模板在 assets/', existsSync(new URL('../assets/report_template.html', import.meta.url)), '')
}

srv.close()
rmSync(tmp, { recursive: true, force: true })
console.log(failed ? `\n${failed} 项失败` : '\n全部通过')
process.exit(failed ? 1 : 0)
