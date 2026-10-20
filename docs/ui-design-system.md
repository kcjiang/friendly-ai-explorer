# shadcn/ui 视觉与组件约定

项目采用 shadcn/ui **Base UI / Nova / Neutral**。数据维护页是首个完整迁移页面。

## 共享基础

- `frontend/components.json` 是 CLI 配置，`ui` 别名指向 `@/components/ui/base`。
- `frontend/src/components/ui/base/` 保存官方组件源码。文件头保留 registry 来源；不再将源码改写成旧版 Tailwind 语法，也不在业务目录复制组件。
- Tailwind CSS 4 使用 `@tailwindcss/postcss`；`src/style/globals.css` 统一主题变量、Geist 字体、圆角。`shadcn/tailwind.css` 提供官方 Base UI 状态变体，`tw-animate-css` 提供动画。
- 官方颜色通过 `bg-background`、`text-foreground`、`border-border` 等语义 token 使用；业务组件不定义另一套主题变量。
- `tailwind.config.ts` 仅保留旧页面依赖的断点名称和图表色适配。旧 `@/components/ui/*` 的 Radix 接口暂留以支持逐页迁移，新的界面使用 `@/components/ui/base/*`。
- 页头主题菜单和版本说明已使用 Base UI 的 `render` 组合接口。切换主题仍遵循用户的 Light / Dark / System 设置。

## 新页面

```tsx
import { Button } from "@/components/ui/base/button"
import { Field, FieldLabel, FieldError } from "@/components/ui/base/field"
import { Input } from "@/components/ui/base/input"

<Field data-invalid={Boolean(error)}>
  <FieldLabel htmlFor="name">姓名</FieldLabel>
  <Input id="name" aria-invalid={Boolean(error)} aria-describedby={error ? "name-error" : undefined} />
  {error && <FieldError id="name-error">{error}</FieldError>}
</Field>
```

新增组件在 `frontend` 目录执行 `pnpm exec shadcn add <component>`，先检查 CLI diff。Base UI 的 Trigger 用 `render={<Button />}`，不能直接复制旧页面的 `asChild`。保留必要的业务约束，不把官方示例中的演示文案或演示数据带入产品。

表格参考 `components/catalog/data-table-features.ts` 和 `catalog-table.tsx`：使用 TanStack Table v9，列定义与渲染由官方 API 管理；后端模式负责全部结果的排序、检索和分页，不能再对单页数据进行客户端二次排序。每页 30 条、固定首列、行点击预览和只点叉关闭均是已确认的业务约束。

## 验证

```powershell
docker compose exec -T frontend pnpm exec tsc --noEmit
docker compose exec -T frontend pnpm exec eslint 'src/app/(app)/catalog/page.tsx' src/components/catalog src/components/ui/base
docker compose exec -T -e NEXT_DIST_DIR=.next-verify frontend pnpm build
```

独立构建目录避免干扰开发服务。视觉检查需覆盖浅色、深色、表格排序与选择、表单字段错误、弹层焦点，以及小屏横向滚动。旧页面应检查路由、布局和主要控件，不应将工具链升级等同于已完成所有页面的设计迁移。
