// cluster + redfox 单测：两轮聚类（拆分/合并/其他命名）、16 点日期规则、统计、去重
import test from 'node:test'
import assert from 'node:assert/strict'
import { getTags, clusterArticles, computeStats, engagementSum } from '../lib/cluster.js'
import { normalizeArticles, dedupeByKey, normalizeArticle } from '../lib/normalize.js'
import { resolveQueryDate, friendlyApiError, DEFAULT_KEYWORD } from '../lib/redfox.js'
import { formatNumber, generateReport, renderClustersText } from '../lib/report.js'

const mk = (title, type, like = 100) => ({ title, type, topic: type, likeCount: like, shareCount: 10, commentCount: 5, userName: '作者甲', photoId: `p${Math.random().toString(36).slice(2, 8)}`, coverUrl: '' })

test('getTags：逗号拆分与 # 剥离', () => {
  assert.deepEqual(getTags({ type: 'AI视频, 教程', topic: '' }), ['AI视频', '教程'])
  assert.deepEqual(getTags({ type: '', topic: '#AI绘画 ,数字人' }), ['AI绘画', '数字人'])
  assert.deepEqual(getTags({}), [])
})

test('clusterArticles：两轮聚类完整场景', () => {
  // 6 个 AI视频 + 3 个 AI绘画 + 1 个无标签
  const arts = [
    mk('a1', 'AI视频, 教程'), mk('a2', 'AI视频, 教程'), mk('a3', 'AI视频, 工具'), mk('a4', 'AI视频'), mk('a5', 'AI视频'), mk('a6', 'AI视频', 200),
    mk('b1', 'AI绘画'), mk('b2', 'AI绘画'), mk('b3', 'AI绘画'),
    { ...mk('x1', ''), likeCount: 50 }, // 无标签 → 其他
  ]
  // 总量 10：AI视频 6 > 5（50%）→ 按第二标签二次拆分（教程 2、工具 1、无第二标签 3 → "AI视频·其他"）；
  // 二次合并：工具(1) <2 与无标签 x1(1) 都并入「其他」→ 其他=2
  const clusters = clusterArticles(arts)
  const byName = Object.fromEntries(clusters.map((c) => [c.category, c.count]))
  assert.equal(byName['AI绘画'], 3)
  assert.equal(byName['教程'], 2)
  assert.equal(byName['AI视频·其他'], 3)
  assert.equal(byName['其他'], 2) // 工具 1 篇 + 无标签 1 篇
  // 组内按互动降序（a6 200 在 AI视频·其他 组内第一）
  const other = clusters.find((c) => c.category === 'AI视频·其他')
  assert.equal(other.articles[0].likeCount, 200)
  // 分类按条数降序
  const counts = clusters.map((c) => c.count)
  assert.deepEqual([...counts].sort((a, b) => b - a), counts)
})

test('clusterArticles：空输入', () => {
  assert.deepEqual(clusterArticles([]), [])
  assert.deepEqual(clusterArticles(null), [])
})

test('computeStats：统计口径', () => {
  const s = computeStats([mk('a', 't', 100), mk('b', 't', 300), { ...mk('c', 't', 50), userName: '作者乙' }])
  assert.equal(s.total, 3)
  assert.equal(s.avg_likes, 150)
  assert.equal(s.top_author, '作者甲')
  assert.equal(s.total_shares, 30)
  assert.deepEqual(computeStats([]), { total: 0, avg_likes: 0, top_author: '-', total_shares: 0 })
})

test('normalize/dedupe：photoId 去重、链接拼接', () => {
  const arts = [
    { photoId: 'p1', title: '视频一', likeCount: '100', type: 'AI视频' },
    { photoId: 'p1', title: '重复', likeCount: 1 },
    { photoId: '', title: '无ID但保留', likeCount: 2 },
    { photoId: '', title: '无ID但保留', likeCount: 3 },
  ]
  const items = normalizeArticles(arts)
  const deduped = normalizeArticles(dedupeByKey(arts))
  assert.equal(items.length, 4)
  assert.equal(deduped.length, 3) // p1 重复去 1；无 photoId 不做标题去重（不同视频可能同名）
  assert.equal(deduped[0].url, 'https://www.iesdouyin.com/share/video/p1')
  assert.equal(deduped[0].likeCount, 100) // 字符串转数字
  assert.equal(normalizeArticle({ photoId: 'p2', title: 't' }, 1).id, 'DY2')
})

test('resolveQueryDate：16 点规则', () => {
  const evening = new Date('2026-11-12T17:00:00')
  const r1 = resolveQueryDate({ now: evening })
  assert.equal(r1.date, '2026-11-11')
  assert.equal(r1.startTime, '2026-11-11')
  assert.equal(r1.endTime, '2026-11-12')
  const morning = new Date('2026-11-12T09:00:00')
  const r2 = resolveQueryDate({ now: morning })
  assert.equal(r2.date, '2026-11-10')
  // 指定日期直用
  const r3 = resolveQueryDate({ date: '2026-06-09', now: morning })
  assert.equal(r3.date, '2026-06-09')
  // 自定义范围直用
  const r4 = resolveQueryDate({ startTime: '2026-06-09', endTime: '2026-06-10', now: morning })
  assert.equal(r4.startTime, '2026-06-09')
  assert.equal(r4.endTime, '2026-06-10')
})

test('friendlyApiError：3106/3107 Key 错误', () => {
  assert.match(friendlyApiError({ code: 3106, msg: 'bad' }).message, /Key 错误.*3106/)
  assert.match(friendlyApiError({ code: 3107 }).message, /Key 错误.*3107/)
  assert.match(friendlyApiError({ code: 3201 }).message, /积分不足/)
})

test('formatNumber / renderClustersText / DEFAULT_KEYWORD', () => {
  assert.equal(formatNumber(1234), '1.2k')
  assert.equal(formatNumber(12345), '1.2w')
  assert.equal(formatNumber(500), '500')
  assert.equal(DEFAULT_KEYWORD, 'AI')
  const text = renderClustersText([{ category: 'AI视频', count: 2, articles: [mk('标题A', 't'), mk('标题B', 't')] }])
  assert.ok(text.includes('【AI视频】2 篇'))
  assert.ok(text.includes('标题A') && text.includes('iesdouyin.com/share/video/'))
})

test('generateReport：上游模板占位符全部填充 + 卡片渲染', () => {
  const clusters = [
    { category: 'AI视频', count: 2, articles: [{ ...mk('视频标题一', 'AI视频', 5000), photoId: 'p1', coverUrl: 'https://img.example/c.jpg' }, mk('视频标题二', 'AI视频', 300)] },
    { category: '其他', count: 1, articles: [mk('杂项', '', 100)] },
  ]
  const articles = clusters.flatMap((c) => c.articles)
  const html = generateReport(clusters, articles, '2026-11-11')
  assert.ok(html.includes('AI抖音信息源 - 2026-11-11'))
  assert.ok(html.includes('2026年11月11日'))
  assert.ok(html.includes('AI视频') && html.includes('其他'))
  assert.ok(html.includes('视频标题一'))
  assert.ok(html.includes('https://www.iesdouyin.com/share/video/p1'))
  assert.ok(html.includes('cover.example') || html.includes('img.example'))
  assert.ok(!html.includes('{{DATE}}') && !html.includes('{{CATEGORY_CARDS}}') && !html.includes('{{TOTAL_COUNT}}'))
  assert.ok(!html.includes('undefined') && !html.includes('[object Object]'))
  // 自定义模板注入
  const mini = generateReport(clusters, articles, '2026-11-11', '<html>{{DATE}}|{{TOTAL_COUNT}}|{{CATEGORY_CARDS}}</html>')
  assert.ok(mini.startsWith('<html>2026-11-11|3|'))
})
