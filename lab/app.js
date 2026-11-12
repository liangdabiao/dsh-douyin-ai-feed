// AI 抖音日报 · 面板逻辑：概览（关键词查询+历史）/ 日报页（分类卡片）/ 设置。
// 话题总结走 agent 对话；面板直连 API 查询/看日报/生成 HTML。
(() => {
  const $app = document.getElementById('app')
  const $toast = document.getElementById('toast')
  const EMBEDDED = (() => { try { return window.parent !== window } catch { return false } })()

  const state = { catalog: null }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const fmt = (n) => {
    if (n === null || n === undefined) return '0'
    if (n >= 10000) return `${(n / 10000).toFixed(1)}w`
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
    return String(n)
  }

  async function api(path) {
    const res = await fetch(`/douyin-ai-feed${path}`)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      const err = new Error(body.error || `HTTP ${res.status}`)
      err.status = res.status
      throw err
    }
    return body
  }
  async function apiPost(path, payload) {
    const res = await fetch(`/douyin-ai-feed${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload || {}),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    return body
  }
  async function apiDelete(path) {
    const res = await fetch(`/douyin-ai-feed${path}`, { method: 'DELETE' })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    return body
  }

  let toastTimer = null
  function toast(msg, isErr) {
    $toast.textContent = msg
    $toast.className = `toast show${isErr ? ' err' : ''}`
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { $toast.className = 'toast' }, 2600)
  }
  function copyFallback(prompt, reason) {
    navigator.clipboard?.writeText(prompt).then(
      () => toast(`${reason}，草稿已复制到剪贴板——请粘贴到 dsh 对话`, true),
      () => toast(`${reason}，复制也失败了`, true))
  }

  const ICONS = {
    home: '<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    trash: '<path d="M5 7h14"/><path d="M9 7V5h6v2"/><path d="M7 7l1 13h8l1-13"/>',
    spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
    ext: '<path d="M14 5h5v5"/><path d="M19 5l-8 8"/><path d="M18 14v5H5V6h5"/>',
    back: '<path d="M14 6l-6 6 6 6"/>',
    play: '<path d="M8 5l11 7-11 7V5z"/>',
  }
  const ic = (name, cls = 'ic') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`

  async function loadCatalog() {
    state.catalog = await api('/api/catalog')
    renderRailFoot()
    return state.catalog
  }
  function renderRailFoot() {
    const c = state.catalog
    if (!c) return
    const latest = (c.reports || [])[0]
    document.getElementById('rail-foot').innerHTML =
      `<div class="v-head">DOUYIN AI v${esc(c.version)}</div>` +
      `<div class="v-row"><span>API Key</span><span>${c.has_key ? '已配置' : '未配置'}</span></div>` +
      `<div class="v-row"><span>日报数</span><span>${(c.reports || []).length}</span></div>` +
      `<div class="v-row"><span>最近关键词</span><span>${esc(latest ? `「${latest.keyword}」` : '—')}</span></div>`
  }

  function sendAgentPrompt(prompt, okMsg = '已在宿主开新对话——agent 处理中') {
    if (!EMBEDDED) {
      navigator.clipboard?.writeText(prompt).then(
        () => toast('草稿已复制——粘贴到 dsh 对话即可开始'),
        () => copyFallback(prompt, '复制失败'))
      return
    }
    let done = false
    const cleanup = () => { done = true; clearTimeout(timer); removeEventListener('message', onMsg) }
    const onMsg = (e) => {
      if (e.origin !== location.origin) return
      if (e.data?.type === 'douyin-ai-feed:start-ok') { if (!done) { cleanup(); toast(okMsg) } }
      else if (e.data?.type === 'douyin-ai-feed:start-failed') { if (!done) { cleanup(); toast(`没能开新对话：${e.data.message || ''}`, true) } }
    }
    const timer = setTimeout(() => { if (!done) { cleanup(); copyFallback(prompt, '未收到宿主确认') } }, 1500)
    addEventListener('message', onMsg)
    parent.postMessage({ type: 'douyin-ai-feed:refresh', prompt }, location.origin)
  }

  // ---------- 视图：概览 ----------
  function viewHome() {
    const c = state.catalog
    const reports = c.reports || []
    return `
      <header class="head">
        <span class="eyebrow">DOUYIN AI DAILY</span>
        <div class="head-row">
          <h1>AI 抖音<strong>日报</strong></h1>
        </div>
        <p>每日扫描抖音热门作品，按互动量排序、type/topic 两轮自动聚类，生成深色青风 HTML 日报。数据每日 16 点更新前一天。RedFox API Key ${c.has_key ? '已配置' : '未配置——去「设置」页填写'}。</p>
      </header>
      ${!c.has_key ? `<div class="empty" style="margin-bottom:var(--sp-6);padding:var(--sp-4) var(--sp-5);text-align:left"><div class="e-title">🔑 还没有配置 RedFox API Key</div><p>到<a href="#/settings">「设置」</a>页填写（ak_ 开头，<a href="https://www.redfox.hk/settings/api-keys?source=github" target="_blank" rel="noreferrer">红狐 hub 获取 ↗</a>）。</p></div>` : ''}
      <section class="sec" style="margin-top:0">
        <div class="sec-head"><span class="num">01</span><h2>生成日报</h2></div>
        <div class="form" style="max-width:760px">
          <div class="form-row">
            <div class="field"><label>KEYWORD · 搜索关键词（默认 AI）</label>
              <input id="f-kw" placeholder="${esc(c.default_keyword || 'AI')}（如 ChatGPT、AI视频）"></div>
            <div class="field"><label>PAGE SIZE · 查询条数</label>
              <select id="f-size"><option value="100">100</option><option value="200" selected>200</option></select></div>
          </div>
          <div style="display:flex;gap:var(--sp-3);flex-wrap:wrap">
            <button class="btn accent" id="f-fetch">${ic('play')}生成今日日报</button>
            <button class="btn ghost" data-newflow>${ic('spark')}去对话总结今日热点</button>
          </div>
          <div class="hint">同步秒回。分类完全由当天内容的 type/topic 标签聚类决定，每天的热点方向不同。</div>
        </div>
      </section>
      <section class="sec">
        <div class="sec-head"><span class="num">02</span><h2>日报历史</h2></div>
        ${reports.length ? `<div class="cards">${reports.map((r) => `
          <a class="card" href="#/r/${encodeURIComponent(r.report_id)}">
            <div class="c-top">
              <div class="c-title">「${esc(r.keyword)}」</div>
              <span class="chip done">${r.total} 篇</span>
            </div>
            <div class="c-sub">${r.topic_count} 个分类 · 数据日期 ${esc(r.date)}</div>
            <div class="c-foot"><span>${esc(String(r.created_at).slice(0, 16).replace('T', ' '))}</span></div>
          </a>`).join('')}</div>`
        : `<div class="empty"><div class="e-title">还没有日报</div><p>点「生成今日日报」；或「去对话总结今日热点」让 agent 抓取并解读 AI 圈动态。</p></div>`}
      </section>`
  }

  // ---------- 视图：日报 ----------
  function clusterCard(cluster, i) {
    const items = cluster.articles.slice(0, 10).map((a) => {
      const url = a.photoId ? `https://www.iesdouyin.com/share/video/${a.photoId}` : ''
      const cover = a.coverUrl
        ? `<img class="d-cover" src="${esc(a.coverUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
        : '<div class="d-cover-ph">无封面</div>'
      return `
        <div class="ditem">
          ${cover}
          <div class="d-info">
            <div class="d-title">${url ? `<a href="${esc(url)}" target="_blank" rel="noreferrer">${esc(a.title || '无标题')}</a>` : esc(a.title || '无标题')}</div>
            <div class="d-meta">
              <span>${esc(a.userName || '-')}</span>
              <span class="d-metrics"><span>👍 ${fmt(a.likeCount)}</span><span>🔄 ${fmt(a.shareCount)}</span><span>💬 ${fmt(a.commentCount)}</span></span>
            </div>
          </div>
        </div>`
    }).join('')
    return `
      <div class="dcard">
        <div class="d-head"><span class="d-num">${String(i + 1).padStart(2, '0')}</span><span class="d-cat">${esc(cluster.category)}</span><span class="d-count">${cluster.count} 篇</span></div>
        <div class="d-body">${items}</div>
      </div>`
  }

  function viewReport(id) {
    return `<div id="r-view" data-rid="${esc(id)}"><div class="loading">LOADING…</div></div>`
  }

  async function renderReport(id) {
    const holder = document.getElementById('r-view')
    let data
    try {
      data = await api(`/api/reports/${encodeURIComponent(id)}`)
    } catch (e) {
      const netDown = !e.status
      holder.innerHTML = `<a class="back" href="#/">${ic('back')} 概览</a><div class="empty"><div class="e-title">${netDown ? '面板服务连接失败' : '日报不存在'}</div><p>${netDown ? '开发预览：DSH_HOME=<数据目录> node scripts/devserver.mjs 5183' : esc(e.message)}</p></div>`
      return
    }
    const meta = data.report
    const clusters = data.clusters || []
    holder.innerHTML = `
      <a class="back" href="#/">${ic('back')} 概览</a>
      <div class="detail-head">
        <div>
          <h1>「${esc(meta.keyword)}」</h1>
          <div class="c-sub" style="margin-top:4px">${meta.total} 篇作品 · ${meta.topic_count} 个分类 · 数据日期 ${esc(meta.date)} · 平均点赞 ${fmt(meta.avg_likes)} · 总分享 ${fmt(meta.total_shares)} · 头号作者 ${esc(meta.top_author)}</div>
        </div>
        <div class="actions">
          <button class="btn accent" id="r-html">${ic('ext')}生成 HTML 日报</button>
          <button class="btn ghost" data-analyze="${esc(id)}">${ic('spark')}去对话总结热点</button>
          <button class="btn ghost" data-del-report="${esc(id)}" title="删除日报">${ic('trash')}</button>
        </div>
      </div>
      ${clusters.length ? `<div class="dcards">${clusters.map((c, i) => clusterCard(c, i)).join('')}</div>`
        : '<div class="empty"><div class="e-title">该日报没有作品</div><p>换关键词或日期重新生成。</p></div>'}`
    bindReport(id, meta)
  }

  function bindReport(id, meta) {
    const htmlBtn = document.getElementById('r-html')
    if (htmlBtn) htmlBtn.onclick = async () => {
      htmlBtn.disabled = true
      try {
        await apiPost(`/api/reports/${encodeURIComponent(id)}/report`)
        toast('HTML 日报已生成')
        window.open(`/douyin-ai-feed/api/reports/${encodeURIComponent(id)}/report`, '_blank')
      } catch (e) { toast(e.message, true) }
      htmlBtn.disabled = false
    }
    const del = document.querySelector('[data-del-report]')
    if (del) del.onclick = async () => {
      if (!confirm('删除这份日报？')) return
      try { await apiDelete(`/api/reports/${encodeURIComponent(id)}`); toast('已删除'); location.hash = '#/' } catch (e) { toast(e.message, true) }
    }
    const analyze = document.querySelector('[data-analyze]')
    if (analyze) analyze.onclick = () => {
      sendAgentPrompt([
        `请总结抖音 AI 圈今日热点（日报 ${meta.report_id}，关键词「${meta.keyword}」，数据日期 ${meta.date}）：`,
        `1. douyin_ai(action="clusters", reportId="${meta.report_id}") 读全部分类作品`,
        '2. 按 douyin-ai-feed 技能总结：各分类的作品亮点、头部作品特征、今日 AI 内容风向（分类由当天内容聚类决定，不要预设分类名）',
        `3. douyin_ai(action="html", reportId="${meta.report_id}") 生成深色青风 HTML 日报并给我文件路径。`,
      ].join('\n'), '已在宿主开新对话——agent 总结完回来看')
    }
  }

  // ---------- 视图：设置 ----------
  function viewSettings() {
    return `
      <a class="back" href="#/">${ic('back')} 概览</a>
      <header class="head">
        <span class="eyebrow">SETTINGS</span>
        <h1>设<strong>置</strong></h1>
        <p>RedFox API Key 是日报抓取的唯一凭证。这里保存的 Key 优先于环境变量，低于插件配置。</p>
      </header>
      <div class="form">
        <div class="field"><label>API KEY · RedFox API Key（ak_ 开头）</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input id="s-key" placeholder="ak_…" style="flex:1;min-width:220px;font-family:var(--font-mono);font-size:12px">
            <button class="btn" id="s-key-save">保存 Key</button>
          </div>
          <div class="hint" id="s-key-hint">…</div>
          <div class="hint">获取：<a href="https://www.redfox.hk/settings/api-keys?source=github" target="_blank" rel="noreferrer">redfox.hk/settings/api-keys ↗</a>。保存在本机 dsh 数据目录，不上传。</div>
        </div>
        <div class="field"><label>DEFAULT KEYWORD · 默认关键词（默认 AI）</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input id="s-kw" placeholder="AI" style="flex:1;min-width:220px">
            <button class="btn" id="s-kw-save">保存关键词</button>
          </div>
        </div>
        <div class="field"><label>PROXY · HTTP(S) 代理（清空 = 直连）</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input id="s-proxy" placeholder="http://127.0.0.1:7890" style="flex:1;min-width:220px;font-family:var(--font-mono);font-size:12px">
            <button class="btn" id="s-proxy-save">保存代理</button>
          </div>
        </div>
        <div class="field"><label>API BASE · 接口地址（测试用，默认 https://redfox.hk）</label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input id="s-base" placeholder="https://redfox.hk" style="flex:1;min-width:220px;font-family:var(--font-mono);font-size:12px">
            <button class="btn" id="s-base-save">保存地址</button>
          </div>
        </div>
      </div>`
  }

  async function bindSettings() {
    try {
      const { settings } = await api('/api/settings')
      const keyHint = document.getElementById('s-key-hint')
      if (keyHint) keyHint.textContent = settings.has_key
        ? `已配置（…${settings.key_tail || '******'}${settings.from_env ? '，其中环境变量可用' : ''}）。重新输入会覆盖。`
        : '未配置。'
      const inp = document.getElementById('s-key')
      if (inp && document.activeElement !== inp) inp.placeholder = settings.has_key ? `已配置（…${settings.key_tail}），输入新值覆盖` : 'ak_…'
      const kw = document.getElementById('s-kw')
      if (kw && document.activeElement !== kw) kw.value = settings.default_keyword || 'AI'
      const proxy = document.getElementById('s-proxy')
      if (proxy && document.activeElement !== proxy) proxy.value = settings.proxy_url || ''
      const base = document.getElementById('s-base')
      if (base && document.activeElement !== base) base.value = settings.api_base || ''
    } catch { /* 宿主未就绪 */ }
    const bind = (id, payload) => {
      const btn = document.getElementById(id)
      if (!btn) return
      btn.onclick = async () => {
        try {
          const input = btn.parentElement.querySelector('input')
          await apiPost('/api/settings', payload(input.value.trim()))
          toast('设置已保存')
          loadCatalog().catch(() => {})
        } catch (e) { toast(e.message, true) }
      }
    }
    bind('s-key-save', (v) => ({ api_key: v }))
    bind('s-kw-save', (v) => ({ default_keyword: v }))
    bind('s-proxy-save', (v) => ({ proxy_url: v }))
    bind('s-base-save', (v) => ({ api_base: v }))
  }

  // ---------- 渲染辅助 ----------
  function bindCommon() {
    document.querySelectorAll('[data-newflow]').forEach((b) => {
      b.onclick = () => sendAgentPrompt([
        '请总结今天抖音 AI 圈的热点（AI 抖音日报）：',
        `1. douyin_ai(action="fetch", keyword="${esc(state.catalog?.default_keyword || 'AI')}") 生成今日日报（同步秒回，16 点规则自动判断日期）`,
        '2. 按 douyin-ai-feed 技能把分类作品一览完整输出（分类由当天内容聚类决定），并解读头部作品特征与今日 AI 内容风向',
        '3. douyin_ai(action="html") 生成深色青风 HTML 日报给我文件路径；我要每日推送时用 dsh 定时任务（每天 16 点，先跟我确认）。',
      ].join('\n'), '已在宿主开新对话——agent 会抓取并解读今日热点')
    })
    const fetchBtn = document.getElementById('f-fetch')
    if (fetchBtn) fetchBtn.onclick = async () => {
      fetchBtn.disabled = true; fetchBtn.textContent = '抓取中…'
      try {
        const r = await apiPost('/api/reports', {
          keyword: document.getElementById('f-kw').value.trim(),
          pageSize: Number(document.getElementById('f-size')?.value) || 200,
        })
        toast(`日报已生成：${r.report.total} 篇 / ${r.report.topic_count} 分类`)
        location.hash = `#/r/${encodeURIComponent(r.report.report_id)}`
      } catch (e) { toast(e.message, true) }
      fetchBtn.disabled = false; fetchBtn.innerHTML = `${ic('play')}生成今日日报`
    }
  }

  // ---------- 路由 ----------
  async function render() {
    try { await loadCatalog() } catch {}
    const hash = location.hash || '#/'
    const mr = hash.match(/^#\/r\/(.+)$/)
    const rid = mr ? decodeURIComponent(mr[1]) : null
    document.querySelectorAll('.nav a').forEach((a) => {
      const cur = rid ? '' : hash === '#/' ? 'home' : hash.startsWith('#/settings') ? 'settings' : 'home'
      a.classList.toggle('on', a.dataset.view === cur)
    })
    if (rid && /^[\p{L}\p{N}_-]+$/u.test(rid)) {
      $app.innerHTML = viewReport(rid)
      bindCommon()
      renderReport(rid)
      return
    }
    if (hash.startsWith('#/settings')) { $app.innerHTML = viewSettings(); bindCommon(); bindSettings(); return }
    $app.innerHTML = viewHome()
    bindCommon()
  }

  async function boot() {
    try { await loadCatalog() } catch {
      state.catalog = { version: '-', has_key: false, key_source: 'none', default_keyword: 'AI', reports: [], settings: {} }
    }
    render().catch(() => {})
  }
  addEventListener('hashchange', render)
  boot()
  setTimeout(() => { if (!state.catalog?.version || state.catalog.version === '-') boot() }, 2500)
})()
