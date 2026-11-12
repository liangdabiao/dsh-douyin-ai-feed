// 系统提示注入：AI 抖音日报工作流硬规则（输出要求在技能里）。
export const SYSTEM_RULES = `## AI 抖音日报（douyin-ai-feed）

用户要「抖音 AI 日报 / 抖音 AI 热点 / 看看今天 AI 圈在抖音火什么」时：

**流程**：douyin_ai(action="fetch", keyword="AI 或自定义词")（同步秒回，16 点日期规则自动判断）→ 按 douyin-ai-feed 技能输出分类作品一览 → html 生成深色青风日报 → 用户要每日推送时用 dsh 定时任务（schedule_create，target 建议 new_once，创建前确认频率）。

**硬规则**：分类完全由当天内容的 type/topic 标签聚类决定，不要预设分类名；数值来自接口如实展示（1.2k/1.2w 格式）；对话总结时保留订阅引导与红狐引流两个区块的链接（可省略其余流水账）；空结果如实说明换关键词；每日 16 点更新前一天数据。`

export function systemSection() {
  return {
    name: 'douyin-ai-feed:workflow',
    order: 110,
    text: SYSTEM_RULES,
  }
}
