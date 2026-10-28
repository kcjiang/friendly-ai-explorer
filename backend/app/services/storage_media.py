"""Validate raster images without trusting filenames, create bounded thumbnails."""

import warnings
from pathlib import Path

from PIL import Image, ImageOps

from app.config import settings

IMAGE_FORMATS = {
    ".png": "PNG",
    ".jpg": "JPEG",
    ".jpeg": "JPEG",
    ".gif": "GIF",
    ".webp": "WEBP",
}
MAX_PIXELS = 40_000_000
MAX_DIMENSION = 16384


def thumbnail_path(entry_id):
    return Path(settings.storage_dir).resolve() / "thumbnails" / f"{entry_id}.webp"


def validate_image(path, filename, thumbnail=None):
    from app.services.storage_service import fail

    expected = IMAGE_FORMATS.get(Path(filename).suffix.lower())
    if not expected:
        return None
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(path) as image:
                width, height = image.size
                if (
                    image.format != expected
                    or width * height > MAX_PIXELS
                    or max(width, height) > MAX_DIMENSION
                    or width * height * getattr(image, "n_frames", 1) > MAX_PIXELS * 4
                ):
                    raise ValueError("invalid image")
                image.verify()
            if thumbnail:
                with Image.open(path) as image:
                    image.seek(0)
                    image = ImageOps.exif_transpose(image)
                    image.thumbnail((480, 480))
                    image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
                    thumbnail.parent.mkdir(parents=True, exist_ok=True)
                    image.save(thumbnail, "WEBP", quality=78)
        return "image/" + ("jpeg" if expected == "JPEG" else expected.lower())
    except (
        OSError,
        ValueError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ):
        if thumbnail:
            thumbnail.unlink(missing_ok=True)
        fail(400, "图片格式无效或像素尺寸超出限制")


def prepare_entry(entry):
    from app.services.storage_service import disk_path, mime_type

    path = disk_path(entry.space, entry.path)
    thumb = thumbnail_path(entry.id)
    entry.media_type = validate_image(path, Path(entry.path).name, thumb) or mime_type(
        entry.path
    )
    entry.thumbnail_size = thumb.stat().st_size if thumb.exists() else 0
