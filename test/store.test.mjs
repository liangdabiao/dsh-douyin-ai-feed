// store + host 工具直调单测（离线假服务器）：日报生命周期、fetch/clusters/html/history、16 点规则
process.env.REDFOX_API_KEY = ''
const { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')
const tmp = mkdtempSync(join(tmpdir(), 'dsh-dy-store-'))
process.env.DSH_HOME = tmp
delete process.env.X_API_KEY

import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

const { saveReport, getReportMeta, listReports, deleteReport, saveReportHtml, DATA_DIR } = await import('../lib/store.js')
const { clusterArticles, computeStats } = await import('../lib/cluster.js')

const mk = (i, type) => ({
  title: `作品${i}`, userName: `作者${i % 3}`, photoId: `p${i}`, coverUrl: '',
  likeCount: 1000 - i * 10, shareCount: 50, commentCount: 20, type, topic: type,
})

test('store：日报生命周期（同关键词+日期覆盖）', () => {
  const arts = [mk(0, 'AI视频'), mk(1, 'AI视频'), mk(2, 'AI绘画')]
  const clusters = clusterArticles(arts)
  const stats = computeStats(arts)
  const m1 = saveReport({ raw: arts, keyword: 'AI', date: '2026-11-11', clusters, stats })
  const m2 = saveReport({ raw: arts, keyword: 'AI', date: '2026-11-11', clusters, stats })
  assert.equal(m1.report_id, m2.report_id)
  assert.equal(listReports().length, 1)
  assert.equal(DATA_DIR, join(tmp, 'douyin-ai-feed'))
  assert.ok(m2.report_id.includes('-AI-2026-11-11'))
  const htmlFile = saveReportHtml(m2.report_id, '<html>x</html>')
  assert.ok(existsSync(htmlFile))
  assert.equal(deleteReport(m2.report_id).ok, true)
  assert.equal(listReports().length, 0)
})

test('host 工具：fetch/clusters/html/history + 16 点规则 + 空/无 key', async () => {
  let lastPayload = null
  const srv = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      lastPayload = JSON.parse(body || '{}')
      const reply = (obj) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
      if (req.headers['x-api-key'] !== 'ak_tool') return reply({ code: 3106, msg: 'key error' })
      if (lastPayload.keyword === '空关键词') return reply({ code: 2000, data: { list: [] } })
      // 12 条：AI视频 9（>50% 触发二次拆分）、AI绘画 3
      const arts = []
      for (let i = 0; i < 9; i++) arts.push(mk(i, i % 3 === 0 ? 'AI视频, 教程' : 'AI视频'))
      for (let i = 9; i < 12; i++) arts.push(mk(i, 'AI绘画'))
      reply({ code: 2000, data: { list: arts } })
    })
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  mkdirSync(join(tmp, 'douyin-ai-feed'), { recursive: true })
  writeFileSync(join(tmp, 'douyin-ai-feed', 'settings.json'), JSON.stringify({ api_key: 'ak_tool', api_base: `http://127.0.0.1:${srv.address().port}` }))

  const { douyinAiTool } = await import('../src/host.js')
  const call = async (args) => {
    try { return await douyinAiTool.execute(args, {}) } catch (e) { return { ok: false, summary: String(e?.message || e) } }
  }
  function check(name, cond, detail = '') {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
    if (!cond) process.exitCode = 1
  }

  {
    const r = await call({ action: 'fetch', keyword: 'AI' })
    check('fetch 入库带统计', r.ok && r.summary.includes('reportId=') && r.summary.includes('12 篇作品'), r.summary.slice(0, 70))
    check('fetch 分类一览', r.data.includes('【AI绘画】3 篇') || r.data.includes('【教程】'), (r.data || '').split('\n')[1])
    check('fetch 16 点规则自动日期', lastPayload.startTime && lastPayload.endTime && lastPayload.endTime > lastPayload.startTime, JSON.stringify(lastPayload))
    check('fetch source 标识', lastPayload.source === '抖音热点日报-dsh', lastPayload.source)
    check('fetch pageNum/pageSize', lastPayload.pageNum === 1 && lastPayload.pageSize === 200, '')
    globalThis.__rid = r.summary.match(/reportId=([\p{L}\p{N}-]+)/u)?.[1]
  }
  {
    const r = await call({ action: 'clusters', perCluster: 5 })
    check('clusters 读明细', r.ok && r.data.includes('iesdouyin.com/share/video/'), '')
  }
  {
    const r = await call({ action: 'html' })
    check('html 生成（上游模板）', r.ok && r.summary.includes('.html'), r.summary.slice(0, 60))
    const file = r.summary.match(/：(.+?\.html)/)?.[1]
    const html = readFileSync(file, 'utf8')
    assert.ok(html.includes('抖音热点日报'))
    assert.ok(html.includes('category-card'))
    assert.ok(!html.includes('{{DATE}}'))
    check('html 内容可读', true, '')
  }
  {
    const r = await call({ action: 'fetch', keyword: '空关键词' })
    check('空结果如实说明', !r.ok && r.summary.includes('未获取到任何作品'), r.summary.slice(0, 50))
  }
  {
    const r = await call({ action: 'history' })
    check('history 单条（覆盖）', r.ok && r.data.split('\n').length === 1, r.data)
  }
  {
    writeFileSync(join(tmp, 'douyin-ai-feed', 'settings.json'), JSON.stringify({}, null, 2))
    const r = await call({ action: 'fetch', keyword: 'AI' })
    check('无 key 引导', !r.ok && r.summary.includes('RedFox API Key'), r.summary.slice(0, 50))
    writeFileSync(join(tmp, 'douyin-ai-feed', 'settings.json'), JSON.stringify({ api_key: 'ak_bad', api_base: `http://127.0.0.1:${srv.address().port}` }))
    const r2 = await call({ action: 'fetch', keyword: 'AI' })
    check('3106 Key 错误翻译', !r2.ok && r2.summary.includes('3106'), r2.summary.slice(0, 50))
    writeFileSync(join(tmp, 'douyin-ai-feed', 'settings.json'), JSON.stringify({ api_key: 'ak_tool', api_base: `http://127.0.0.1:${srv.address().port}` }))
  }

  await new Promise((r) => srv.close(r))
})

test.after(() => rmSync(tmp, { recursive: true, force: true }))
