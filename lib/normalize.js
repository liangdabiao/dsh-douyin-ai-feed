// 条目归一化（抖音 AI 信息源）：字段对齐上游 fetch_douyin_ai.py 使用的原始形态（likeCount/photoId/type/topic 等），去重。
export function normalizeArticle(art, idx) {
  const photoId = String(art?.photoId || '')
  return {
    id: `DY${idx + 1}`,
    title: String(art?.title || '无标题') || '无标题',
    userName: String(art?.userName || ''),
    photoId,
    url: photoId ? `https://www.iesdouyin.com/share/video/${photoId}` : '#',
    coverUrl: String(art?.coverUrl || ''),
    likeCount: Number(art?.likeCount) || 0,
    shareCount: Number(art?.shareCount) || 0,
    commentCount: Number(art?.commentCount) || 0,
    type: String(art?.type || ''),
    topic: String(art?.topic || ''),
  }
}

export function normalizeArticles(articles) {
  return (articles || []).map((a, i) => normalizeArticle(a, i))
}

// 去重：photoId 主键（无 photoId 的作品不去重——不同视频可能同名）
export function dedupeByKey(articles) {
  const seen = new Set()
  const out = []
  for (const a of articles || []) {
    const key = String(a?.photoId || '')
    if (key) {
      if (seen.has(key)) continue
      seen.add(key)
    }
    out.push(a)
  }
  return out
}
