from typing import Annotated
from fastapi import Depends, HTTPException, status
from app.middleware.auth import get_current_user
from app.models.user import User, UserRole


def require_roles(*roles: UserRole):
    """
    工厂函数：生成一个 FastAPI 依赖，要求当前用户具有指定角色之一。

    用法：
        @router.get("/admin-only")
        async def admin_view(user: Annotated[User, Depends(require_roles(UserRole.developer))]):
            ...
    """
    async def _check(user: Annotated[User, Depends(get_current_user)]) -> User:
        if user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"权限不足，需要角色：{[r.value for r in roles]}",
            )
        return user
    return _check


# ── 预定义常用权限依赖（直接在路由中 Depends 使用）────────────

# 任意已登录用户
AnyUser = Annotated[User, Depends(get_current_user)]

# 仅开发者
DevOnly = Annotated[User, Depends(require_roles(UserRole.developer))]

# 领导或开发者
LeaderOrDev = Annotated[User, Depends(require_roles(UserRole.leader, UserRole.developer))]

# 工程师以上（即全部角色）
AllRoles = Annotated[User, Depends(require_roles(UserRole.engineer, UserRole.leader, UserRole.developer))]
