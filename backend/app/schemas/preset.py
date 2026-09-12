import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class PresetCommandOut(BaseModel):
    id:          uuid.UUID
    name:        str
    command:     str
    group_name:  str
    device_type: str
    is_public:   bool
    is_danger:   bool
    owner_id:    Optional[uuid.UUID]
    created_at:  datetime
    model_config = {"from_attributes": True}


class CreatePresetRequest(BaseModel):
    name:        str
    command:     str
    group_name:  str  = "通用"
    device_type: str  # adb | serial
    is_public:   bool = False
    is_danger:   bool = False


class UpdatePresetRequest(BaseModel):
    name:       Optional[str]  = None
    command:    Optional[str]  = None
    group_name: Optional[str]  = None
    is_danger:  Optional[bool] = None


class UploadedLogOut(BaseModel):
    id:          uuid.UUID
    user_id:     uuid.UUID
    device_type: str
    filename:    str
    file_size:   int
    line_count:  int
    description: Optional[str]
    created_at:  datetime
    uploader_name: Optional[str] = None
    model_config = {"from_attributes": True}
