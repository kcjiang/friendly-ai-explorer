import json
from app.ai.gemini_client import gemini

ANALYZE_PROMPT = """你是一名 FAE（技术支持工程师）的 AI 助理，请分析以下邮件。

邮件信息：
发件人：{sender}
主题：{subject}
正文：{body}

请判断并提取信息，只返回 JSON，不要其他内容：
{{
  "is_customer_email": true或false,
  "is_defect_report": true或false,
  "summary": "一句话摘要",
  "ticket": {{
    "title": "工单标题（简洁描述问题）",
    "description": "详细问题描述",
    "customer_name": "客户/公司名称，无则null",
    "customer_contact": "联系方式，优先用发件人邮箱",
    "product_name": "产品型号，无则null",
    "firmware_version": "固件版本，无则null",
    "priority": "critical/high/medium/low"
  }}
}}

注意：
- is_customer_email：来自外部客户的业务邮件才为 true，内部邮件、垃圾邮件为 false
- is_defect_report：邮件中描述了产品问题/故障/缺陷才为 true
- ticket 字段：仅当 is_defect_report 为 true 时填写，否则 ticket 为 null
"""


async def analyze_email(sender: str, subject: str, body: str) -> dict:
    """
    调用 Gemini 分析邮件，返回结构化 JSON。
    body 超长时截断到 3000 字符避免超出 token 限制。
    """
    body_truncated = body[:3000] + ("..." if len(body) > 3000 else "")

    prompt = ANALYZE_PROMPT.format(
        sender=sender or "未知",
        subject=subject or "无主题",
        body=body_truncated or "（正文为空）",
    )

    try:
        raw = await gemini.chat(prompt)
        raw = raw.strip().strip("```json").strip("```").strip()
        result = json.loads(raw)
        return result
    except Exception as e:
        print(f"[EmailAnalyzer] AI 分析失败: {e}")
        return {
            "is_customer_email": False,
            "is_defect_report":  False,
            "summary":           "AI 分析失败",
            "ticket":            None,
        }
