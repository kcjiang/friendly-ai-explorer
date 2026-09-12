import uuid
from datetime import datetime
from pydantic import BaseModel, EmailStr, field_validator
from app.models.user import UserRole


# ── 登录请求 ─────────────────────────────────────────────────
class LoginRequest(BaseModel):
    email:    EmailStr
    password: str


# ── 修改密码请求 ──────────────────────────────────────────────
class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("密码长度不能少于 6 位")
        return v


# ── 用户公开信息（响应体） ────────────────────────────────────
class UserOut(BaseModel):
    id:         uuid.UUID
    email:      str
    name:       str
    role:       UserRole
    avatar_url: str | None
    is_active:  bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ── 登录成功响应 ──────────────────────────────────────────────
class LoginResponse(BaseModel):
    access_token: str
    token_type:   str = "bearer"
    user:         UserOut


# ── 管理员创建用户请求（Batch 7 Admin 模块使用） ──────────────
class CreateUserRequest(BaseModel):
    email:    EmailStr
    name:     str
    password: str
    role:     UserRole = UserRole.engineer

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 6:
            raise ValueError("密码长度不能少于 6 位")
        return v


# ── 管理员更新用户请求 ────────────────────────────────────────
class UpdateUserRequest(BaseModel):
    name:       str | None = None
    role:       UserRole | None = None
    is_active:  bool | None = None
    avatar_url: str | None = None
