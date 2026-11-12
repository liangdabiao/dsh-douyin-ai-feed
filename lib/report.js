// HTML 日报生成：复用上游 assets/report_template.html（深色青风），占位符填充 + 分区卡片渲染。
// 移植自 fetch_douyin_ai.py 的 generate_report / generate_category_cards / format_number。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const TEMPLATE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'report_template.html')

const esc = (t) => String(t ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// 1234 -> 1.2k / 12345 -> 1.2w（上游 format_number）
export function formatNumber(n) {
  if (n === null || n === undefined) return '0'
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

// 每个分类一张大卡片，内含 TOP10 作品（封面图+标题+作者+互动）
function generateCategoryCards(clusters) {
  let cardsHtml = ''
  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i]
    let articlesHtml = ''
    for (const article of cluster.articles.slice(0, 10)) {
      const title = esc(article.title || '无标题')
      const url = article.photoId ? `https://www.iesdouyin.com/share/video/${article.photoId}` : '#'
      const author = esc(article.userName || '')
      const cover = article.coverUrl || ''
      const likes = formatNumber(article.likeCount)
      const shares = formatNumber(article.shareCount)
      const comments = formatNumber(article.commentCount)
      const coverHtml = cover
        ? `<img class="article-cover" src="${esc(cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
        : ''
      articlesHtml += `
                <div class="article-item">
                    ${coverHtml}
                    <div class="article-info">
                        <a href="${esc(url)}" target="_blank" rel="noreferrer" class="article-title">${title}</a>
                        <div class="article-meta">
                            <span class="author">${author}</span>
                            <span class="metrics">
                                <span class="metric">&#x1f44d; ${likes}</span>
                                <span class="metric">&#x1f501; ${shares}</span>
                                <span class="metric">&#x1f4ac; ${comments}</span>
                            </span>
                        </div>
                    </div>
                </div>`
    }
    cardsHtml += `
        <div class="category-card reveal">
            <div class="card-header">
                <span class="card-number">${String(i + 1).padStart(2, '0')}</span>
                <h3 class="card-category">${esc(cluster.category)}</h3>
                <span class="card-count">${cluster.count} 篇</span>
            </div>
            <div class="card-body">${articlesHtml}
            </div>
        </div>`
  }
  return cardsHtml
}

// 日期中文（2026-06-09 → 2026年6月9日 星期二）
function dateCn(dateStr) {
  try {
    const dt = new Date(`${dateStr}T00:00:00`)
    if (Number.isNaN(dt.getTime())) return dateStr
    const weekdays = ['日', '一', '二', '三', '四', '五', '六']
    return `${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日 星期${weekdays[dt.getDay()]}`
  } catch {
    return dateStr
  }
}

/**
 * 生成完整 HTML 日报。
 * @param clusters clusterArticles() 输出
 * @param articles 全部作品（统计口径 = 全量）
 * @param dateStr 数据日期 YYYY-MM-DD
 * @param templateHtml 可选：自定义模板（测试注入）；缺省读 assets/report_template.html
 */
export function generateReport(clusters, articles, dateStr, templateHtml = null) {
  const stats = { total: (articles || []).length }
  const likes = (articles || []).map((a) => a.likeCount || 0)
  stats.avg_likes = stats.total ? Math.floor(likes.reduce((a, b) => a + b, 0) / stats.total) : 0
  const authorCounter = new Map()
  for (const a of articles || []) {
    const name = a.userName || '未知'
    authorCounter.set(name, (authorCounter.get(name) || 0) + 1)
  }
  stats.top_author = [...authorCounter.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '-'
  stats.total_shares = (articles || []).reduce((n, a) => n + (a.shareCount || 0), 0)

  const topicCount = clusters.length
  const categoryCards = generateCategoryCards(clusters)
  const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ')

  let template = templateHtml
  if (!template) {
    try {
      template = readFileSync(TEMPLATE_PATH, 'utf8')
    } catch {
      template = FALLBACK_TEMPLATE
    }
  }

  return template
    .replace(/\{\{DATE\}\}/g, esc(dateStr))
    .replace(/\{\{DATE_CN\}\}/g, esc(dateCn(dateStr)))
    .replace(/\{\{TOTAL_COUNT\}\}/g, String(stats.total))
    .replace(/\{\{TOPIC_COUNT\}\}/g, String(topicCount))
    .replace(/\{\{TOP_AUTHOR\}\}/g, esc(stats.top_author))
    .replace(/\{\{AVG_LIKES\}\}/g, formatNumber(stats.avg_likes))
    .replace(/\{\{TOTAL_SHARES\}\}/g, formatNumber(stats.total_shares))
    .replace(/\{\{CATEGORY_CARDS\}\}/g, categoryCards)
    .replace(/\{\{TIMESTAMP\}\}/g, esc(timestamp))
}

// 终端/对话用分类作品表格
export function renderClustersText(clusters, { perCluster = 10 } = {}) {
  const lines = ['AI抖音信息源 · 分类作品一览', '']
  clusters.forEach((cluster, i) => {
    lines.push(`【${cluster.category}】${cluster.count} 篇`)
    cluster.articles.slice(0, perCluster).forEach((a, j) => {
      lines.push(`  ${j + 1}. ${a.title} ｜ ${a.userName || '-'} ｜ 👍${formatNumber(a.likeCount)} 🔄${formatNumber(a.shareCount)} 💬${formatNumber(a.commentCount)} ｜ ${a.photoId ? `https://www.iesdouyin.com/share/video/${a.photoId}` : '无链接'}`)
    })
    lines.push('')
  })
  return lines.join('\n')
}

// 内置最小模板（assets 缺失时兜底，对齐上游 get_fallback_template）
const FALLBACK_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI抖音信息源 - {{DATE}}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, sans-serif; background: #1a1a1a; color: #e8e4df; padding: 2rem; }
.header { text-align: center; padding: 2rem 0; }
.header h1 { font-size: 2rem; color: #25F4EE; }
.header p { color: #9a9590; margin-top: 0.5rem; }
.stats { display: flex; justify-content: center; gap: 2rem; padding: 1rem; margin: 1rem 0; }
.stat-item { text-align: center; }
.stat-value { font-size: 1.5rem; font-weight: bold; color: #25F4EE; }
.stat-label { font-size: 0.8rem; color: #9a9590; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 1.5rem; max-width: 1200px; margin: 2rem auto; }
.category-card { background: #2d2d2d; border-radius: 12px; overflow: hidden; }
.card-header { display: flex; align-items: center; gap: 0.8rem; padding: 1rem 1.2rem; background: linear-gradient(135deg, #25F4EE, #5CF7F2); }
.card-number { font-size: 1.5rem; font-weight: bold; color: rgba(0,0,0,0.3); }
.card-category { flex: 1; font-size: 1.1rem; font-weight: 700; color: #fff; }
.card-count { font-size: 0.8rem; color: rgba(255,255,255,0.8); background: rgba(0,0,0,0.2); padding: 0.2rem 0.6rem; border-radius: 10px; }
.card-body { padding: 0.8rem 1.2rem; max-height: 520px; overflow-y: auto; }
.article-item { padding: 0.6rem 0; border-bottom: 1px solid #3d3d3d; display: flex; gap: 0.8rem; }
.article-item:last-child { border-bottom: none; }
.article-cover { width: 72px; height: 72px; border-radius: 8px; object-fit: cover; flex-shrink: 0; background: #1a1a1a; }
.article-info { flex: 1; min-width: 0; }
.article-title { color: #e8e4df; text-decoration: none; font-size: 0.9rem; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.article-title:hover { color: #25F4EE; }
.article-meta { display: flex; justify-content: space-between; margin-top: 0.3rem; font-size: 0.75rem; color: #9a9590; }
.metrics { display: flex; gap: 0.8rem; }
.footer { text-align: center; padding: 2rem; color: #666; font-size: 0.8rem; }
</style>
</head>
<body>
<div class="header">
    <h1>AI抖音信息源</h1>
    <p>{{DATE_CN}} | 共 {{TOTAL_COUNT}} 篇热门作品</p>
</div>
<div class="stats">
    <div class="stat-item"><div class="stat-value">{{TOPIC_COUNT}}</div><div class="stat-label">分类</div></div>
    <div class="stat-item"><div class="stat-value">{{TOTAL_COUNT}}</div><div class="stat-label">作品</div></div>
    <div class="stat-item"><div class="stat-value">{{AVG_LIKES}}</div><div class="stat-label">平均点赞</div></div>
    <div class="stat-item"><div class="stat-value">{{TOTAL_SHARES}}</div><div class="stat-label">总分享</div></div>
</div>
<div class="cards">{{CATEGORY_CARDS}}</div>
<div class="footer">Generated at {{TIMESTAMP}} by AI抖音信息源 Skill</div>
</body>
</html>`
