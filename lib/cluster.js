// 两轮自动聚类：首标签聚类 → 小组(<2)并入"其他" → 大类(>50%)按第二标签二次拆分 → 再合并。
// 移植自 fetch_douyin_ai.py 的 cluster_articles，逐行对齐（拆分后的"其他"命名 {big}·其他）。
import { dedupeByKey } from './normalize.js'

export function getTags(article) {
  const atype = String(article?.type || '').trim()
  const topic = String(article?.topic || '').trim()
  const raw = atype || topic || ''
  return raw.split(',').map((t) => t.trim().replace(/^#/, '').trim()).filter(Boolean)
}

export function clusterArticles(articles) {
  const total = (articles || []).length

  // 第一轮：按首标签聚类
  const topicGroups = new Map()
  for (const article of articles || []) {
    const tags = getTags(article)
    const category = tags[0] || '其他'
    if (!topicGroups.has(category)) topicGroups.set(category, [])
    topicGroups.get(category).push(article)
  }

  // 合并小组（< 2 篇归入"其他"）
  const finalGroups = new Map()
  let smallArticles = []
  for (const [topic, arts] of topicGroups) {
    if (arts.length >= 2) finalGroups.set(topic, arts)
    else smallArticles.push(...arts)
  }
  if (smallArticles.length) {
    if (!finalGroups.has('其他')) finalGroups.set('其他', [])
    finalGroups.get('其他').push(...smallArticles)
  }

  // 二次拆分：超过总量 50% 的分类按第二标签再拆
  const toSplit = [...finalGroups.entries()].filter(([k, v]) => v.length > total * 0.5 && k !== '其他')
  for (const [bigCat, bigArts] of toSplit) {
    finalGroups.delete(bigCat)
    const subGroups = new Map()
    for (const art of bigArts) {
      const tags = getTags(art)
      if (tags.length >= 2) {
        if (!subGroups.has(tags[1])) subGroups.set(tags[1], [])
        subGroups.get(tags[1]).push(art)
      } else {
        if (!subGroups.has('其他')) subGroups.set('其他', [])
        subGroups.get('其他').push(art)
      }
    }
    for (const [subName, subArts] of subGroups) {
      finalGroups.set(subName === '其他' ? `${bigCat}·其他` : subName, subArts)
    }
  }

  // 二次合并（拆分后的小组 < 2 篇归入"其他"）
  const merged = new Map()
  let small2 = []
  for (const [topic, arts] of finalGroups) {
    if (arts.length >= 2) merged.set(topic, arts)
    else small2.push(...arts)
  }
  if (small2.length) {
    if (!merged.has('其他')) merged.set('其他', [])
    merged.get('其他').push(...small2)
  }

  // 按条数降序输出；组内按点赞+分享+评论降序
  const clusters = [...merged.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([category, arts]) => {
      const sorted = [...arts].sort((a, b) => engagementSum(b) - engagementSum(a))
      return { category, count: sorted.length, articles: sorted }
    })
  return clusters
}

export const engagementSum = (a) =>
  (a?.likeCount || 0) + (a?.shareCount || 0) + (a?.commentCount || 0)

// ── 统计 ────────────────────────────────────────────────────────────────
export function computeStats(articles) {
  const total = (articles || []).length
  if (!total) return { total: 0, avg_likes: 0, top_author: '-', total_shares: 0 }
  const likes = articles.map((a) => a.likeCount || 0)
  const avgLikes = Math.floor(likes.reduce((a, b) => a + b, 0) / total)
  const authorCounter = new Map()
  for (const a of articles) {
    const name = a.userName || '未知'
    authorCounter.set(name, (authorCounter.get(name) || 0) + 1)
  }
  const topAuthor = [...authorCounter.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '-'
  const totalShares = articles.reduce((n, a) => n + (a.shareCount || 0), 0)
  return { total, avg_likes: avgLikes, top_author: topAuthor, total_shares: totalShares }
}

export { dedupeByKey }
