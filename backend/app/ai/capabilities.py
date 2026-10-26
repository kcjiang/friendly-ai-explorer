"""Business requirements are independent of provider brands and wire protocols."""

LABELS = {
    "text": "Text generation",
    "conversation": "Multi-turn conversation",
    "json": "Structured JSON",
    "stream": "Streaming",
}
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
    return [
        LABELS[key]
        + (
            " (unsupported)"
            if checks.get(key, {}).get("status") == "unsupported"
            else " (unverified)"
        )
        for key in REQUIRED.get(task, ())
        if checks.get(key, {}).get("status") != "verified"
    ]
