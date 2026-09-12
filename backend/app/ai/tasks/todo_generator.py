from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.ai.gemini_client import gemini
from app.models.ticket import Ticket, TicketStatus
from app.models.user import User, UserRole

TODO_PROMPT = """你是一位 FAE 团队的 AI 助理，请根据工程师当前的工单情况，生成今日的工作 TODO 清单。

工程师：{name}
今日日期：{date}

当前活跃工单：
{ticket_list}

请生成一份简洁的今日 TODO 清单，要求：
1. 按优先级排序（严重 > 高 > 中 > 低）
2. 每条不超过 30 字
3. 最多 8 条
4. 输出格式为 JSON 数组，每个元素包含 "task" 和 "priority" 字段
5. 只输出 JSON，不要其他内容

示例输出：
[
  {{"task": "跟进 KC-2024-001 客户网络问题，等待客户提供日志", "priority": "critical"}},
  {{"task": "更新 KC-2024-003 固件升级方案", "priority": "high"}}
]
"""


async def generate_todos(user: User, db: AsyncSession) -> list[dict]:
    """为工程师生成今日 TODO 列表"""
    from datetime import date

    # 查询该用户的活跃工单（非已关闭/已解决）
    active_statuses = [TicketStatus.open, TicketStatus.in_progress, TicketStatus.pending]
    q = select(Ticket).where(Ticket.status.in_(active_statuses))

    # 非领导/开发者只看自己的工单
    if user.role == UserRole.engineer:
        q = q.where(
            (Ticket.creator_id == user.id) | (Ticket.assignee_id == user.id)
        )

    result = await db.execute(q.order_by(Ticket.priority, Ticket.created_at))
    tickets = result.scalars().all()

    if not tickets:
        return [{"task": "今日暂无活跃工单，可整理知识库或学习新技术", "priority": "low"}]

    ticket_lines = "\n".join(
        f"- [{t.priority.value.upper()}] {t.ticket_no}: {t.title}（状态：{t.status.value}）"
        for t in tickets[:15]  # 最多传 15 条给 AI
    )

    prompt = TODO_PROMPT.format(
        name=user.name,
        date=date.today().strftime("%Y-%m-%d"),
        ticket_list=ticket_lines,
    )

    try:
        raw = await gemini.chat(prompt)
        # 清除可能的 markdown 代码块
        raw = raw.strip().strip("```json").strip("```").strip()
        import json
        todos = json.loads(raw)
        return todos if isinstance(todos, list) else []
    except Exception as e:
        print(f"[TODO] 生成失败: {e}")
        return [{"task": f"共 {len(tickets)} 个活跃工单待处理", "priority": "medium"}]
