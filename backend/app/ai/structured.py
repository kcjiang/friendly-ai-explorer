"""Schemas and conservative extraction for small / reasoning models."""
import json
import re

from app.ai.provider_client import AIError

TODO_SCHEMA = {"type": "object", "properties": {"todos": {"type": "array", "minItems": 1, "maxItems": 8,
    "items": {"type": "object", "properties": {"task": {"type": "string"}, "priority": {"type": "string", "enum": ["critical", "major", "trivial"]}},
              "required": ["task", "priority"], "additionalProperties": False}}}, "required": ["todos"], "additionalProperties": False}
EMAIL_SCHEMA = {"type": "object", "properties": {
    "is_customer_email": {"type": "boolean"}, "is_defect_report": {"type": "boolean"}, "summary": {"type": "string"},
    "ticket": {"anyOf": [{"type": "null"}, {"type": "object", "properties": {
        **{k: {"type": ["string", "null"]} for k in ("description", "customer_name", "customer_contact", "product_name", "firmware_version")},
        "title": {"type": "string"}, "priority": {"type": "string", "enum": ["critical", "high", "medium", "low"]}},
        "required": ["title", "description", "customer_name", "customer_contact", "product_name", "firmware_version", "priority"], "additionalProperties": False}]}},
    "required": ["is_customer_email", "is_defect_report", "summary", "ticket"], "additionalProperties": False}
TEST_SCHEMA = {"type": "object", "properties": {"ok": {"type": "boolean", "enum": [True]}}, "required": ["ok"], "additionalProperties": False}


def schema_for(task):
    return {"todo": TODO_SCHEMA, "email_analysis": EMAIL_SCHEMA, "test_json": TEST_SCHEMA}.get(task)


def strip_thinking(raw):
    # Remove only complete explicit blocks. An unterminated block is not a final answer.
    raw = raw.strip()
    while re.match(r"<think\b", raw, re.IGNORECASE):
        block = re.match(r"<think\b[^>]*>.*?</think\s*>\s*", raw, re.DOTALL | re.IGNORECASE)
        if not block:
            raise AIError("模型仍在思考，未生成最终答案", retryable=True, kind="reasoning_only")
        raw = raw[block.end():]
    # Some chat templates omit the opening tag in generated text.
    if "</think>" in raw and not raw.startswith(("{", "[", "```")):
        raw = raw.rsplit("</think>", 1)[1]
    return raw.strip()


def parse_json(raw):
    raw = strip_thinking(raw)
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*\n?", "", raw, count=1, flags=re.IGNORECASE)
        raw = re.sub(r"\s*```$", "", raw, count=1)
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        pass
    # Accept exactly one complete JSON object/array surrounded by prose. Don't select
    # nested objects from a broken array, invent closing brackets, or evaluate Python.
    decoder, candidates, position = json.JSONDecoder(), [], 0
    while position < len(raw):
        match = re.search(r"[\[{]", raw[position:])
        if not match:
            break
        position += match.start()
        try:
            data, end = decoder.raw_decode(raw, position)
        except ValueError:
            raise AIError("模型未返回完整 JSON", retryable=True, kind="invalid_json") from None
        candidates.append(data)
        position = end
    if len(candidates) == 1:
        return candidates[0]
    raise AIError("模型未返回唯一有效 JSON", retryable=True, kind="invalid_json")
