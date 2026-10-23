"""Business requirements are independent of provider brands and wire protocols."""
LABELS = {"text": "文本生成", "conversation": "多轮对话", "json": "结构化 JSON", "stream": "流式输出"}
REQUIRED = {
    "default": ("text",),
    "todo": ("text", "json"),
    "ticket_analysis": ("text",),
    "rag_chat": ("text", "conversation", "stream"),
}


def requirements(task):
    return [{"id": key, "label": LABELS[key]} for key in REQUIRED.get(task, ())]


def missing_capabilities(provider, task):
    checks = provider.capability_checks or {}
    return [LABELS[key] + ("（不支持）" if checks.get(key, {}).get("status") == "unsupported" else "（未验证）")
            for key in REQUIRED.get(task, ()) if checks.get(key, {}).get("status") != "verified"]
