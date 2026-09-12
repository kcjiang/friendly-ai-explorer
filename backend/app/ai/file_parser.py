"""
文件解析器：将 PDF / DOCX / PNG 转为纯文本
"""
import io
from pathlib import Path


def parse_pdf(file_bytes: bytes) -> str:
    import fitz  # PyMuPDF
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    return "\n".join(page.get_text() for page in doc)


def parse_docx(file_bytes: bytes) -> str:
    from docx import Document
    doc = Document(io.BytesIO(file_bytes))
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())


def parse_image(file_bytes: bytes) -> str:
    """
    图片暂时返回占位文本；
    Batch 6 接入 Gemini Vision 后可替换为真实 OCR。
    """
    return "[图片内容，待 AI 视觉模块解析]"


def parse_file(file_bytes: bytes, filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext == ".pdf":
        return parse_pdf(file_bytes)
    elif ext in (".docx", ".doc"):
        return parse_docx(file_bytes)
    elif ext in (".png", ".jpg", ".jpeg", ".webp"):
        return parse_image(file_bytes)
    else:
        # 尝试直接当文本
        return file_bytes.decode("utf-8", errors="ignore")
