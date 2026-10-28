import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class UploadedLogOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    device_type: str
    filename: str
    file_size: int
    line_count: int
    description: Optional[str]
    created_at: datetime
    uploader_name: Optional[str] = None
    model_config = {"from_attributes": True}
