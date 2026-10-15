# v3.1 剧情图片展示实施状态（2026-10-10）

## 阶段 0：现状与基线

- 复用 React/Vite、Express/Socket.IO、Prisma/PostgreSQL、既有账号/房间权限、图片处理与 `uploads:/app/uploads` 卷。房间放映状态进入数据库，个人观看偏好留在浏览器。
- 项目目录不是 Git 仓库；原有代码与旧数据保留。基线 `pnpm typecheck`、`pnpm test`（共享 12、API 5、Web 1）、`pnpm build`、`pnpm lint` 均通过。
- 主要新增文件：`apps/api/src/presentation.ts`、两项 Prisma 迁移、`apps/web/src/ui/presentation/`、`apps/web/src/presentation.css`、`apps/api/scripts/presentation-smoke.mjs`、两项剧情联机测试。

## 阶段 A（P0）：可联机放映闭环

- [x] GM 批量/单张上传、私下预览、放映、切图和结束；玩家通过非模态浮窗实时观看，可移动、调整大小、最小化、恢复、缩放与平移。放映不切路由、不重建房间页面。
- [x] 1 GM + 2 玩家浏览器验证上传三张图、同步切图、结束，人物卡未保存草稿及输入焦点保持。实现位于 `presentation.ts`、`DirectorConsole.tsx`、`PresentationViewer.tsx`、`usePresentation.ts`，接入 `App.tsx`、`Windows.tsx`、`store.ts`。
- 验证：阶段 A 初次 `presentation-flow.spec.ts` 通过；最终完整 `pnpm e2e` 再次通过。

## 阶段 B（P0）：持久化与异常恢复

- [x] PostgreSQL 保存素材、章节、Cue 和当前放映状态；原图、适屏图及缩略图写入持久上传目录。上传采用暂存文件并在错误时清理；图片丢失有局部错误/重试。Socket 只发送版本通知，客户端重新读取当前状态并忽略旧版本。
- [x] 刷新、晚加入、连续 A→B→C 切图、黑幕、结束后重新读取、操作 ID 幂等、版本冲突、非法上传与图片缺失由联机测试及 API 冒烟覆盖。登录服务短暂不可用时显示重试入口，不误跳登录页。
- [~] 本机数据库迁移和文件写入后读取已验证；Docker 容器重建、群晖实际挂载卷及双卷恢复尚未运行。对应迁移是 `202610090010_presentation`、`202610090011_presentation_cues`。
- 主要文件：`apps/api/prisma/schema.prisma`、两项迁移、`apps/api/src/presentation.ts`、`apps/web/src/api.ts`、`apps/web/src/pages/App.tsx`、`usePresentation.ts`、`PresentationViewer.tsx`。

## 阶段 C（P1）：GM 导演台

- [x] 章节、Cue、多图上传、搜索、顺序编辑、标题/字幕/GM 备注/标签、任意选图、上/下一张、删除引用确认、允许玩家回看的线索图库已接入真实 API。一个素材可以用于多个 Cue，删除 Cue 不删除素材。玩家看不到未公开素材和 GM 备注。
- 验证：`presentation-flow.spec.ts` 用三张图覆盖章节、Cue、元数据、预览和回看；`smoke:presentation` 覆盖共用素材、删除引用及权限。未单独人工排演五张图，但同一批量上传和任意选择路径已验证。
- 主要文件：`DirectorConsole.tsx`、`ClueGallery.tsx`、`presentation.ts`、Cue 迁移。

## 阶段 D（P2）：大屏与动效

- [x] 沉浸式观看建议、个人退出后保持浮窗、黑幕与恢复、立即/淡入/黑幕揭晓/缓慢推近四种转场、减少动效选项及系统减少动效偏好、独立只读观众页 `/rooms/:roomId/presentation`。窗口在视口改变或拖动时受边界约束。
- 验证：`presentation-flow.spec.ts` 覆盖沉浸模式退出、再次切图、黑幕、只读大屏同步、刷新恢复；完整 E2E 在最终改动后通过。尚未在 1366×768 和 2560×1440 实机屏幕上手动验收视觉细节。
- 主要文件：`PresentationViewer.tsx`、`PresentationStage.tsx`、`presentation.css`、`App.tsx`。

## 阶段 E（P2）：性能与交付

- [x] 本机 Edge 八个独立账号测试 1920×1080 图片：八客户端房间快照总耗时 1337 ms，每份 4460 字节；适屏图 1,225,966 字节，八人全部加载完成用时 851 ms。该数字仅代表本机测试环境，不代表 NAS 或广域网性能。
- [x] README、架构、群晖部署及双卷备份/恢复说明已更新。没有增加新的认证、Redis、S3、CDN 或自动战斗逻辑。
- [x] 最终回归：`pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test`（18 项）、`pnpm build`、`pnpm lint`、`pnpm e2e`（3 个流程，45.6 秒）、`pnpm --filter @dnd/api smoke:presentation`（50 项）、`pnpm --filter @dnd/api smoke:v3`（163 项）全部通过。构建仍提示 Web 主包约 833 kB，尚未做分包优化。

## 尚未验证与已知边界

- 原轮次没有验证容器/群晖恢复。该部署方式现已移除，当前运行与备份说明见 `docs/windows-server-deployment.md`；早期测试证据保留。
- 已在本机 Edge 的多个独立浏览器上下文验收；其他浏览器、真实异地网络、8 人长时间运行的内存增长及三档屏幕的手动视觉验收尚未进行。
- 自动化验证了人物卡草稿与焦点，尚未逐项人工检验放映瞬间正在拖地图、写笔记或操作背包的手势连续性。
- 已公开图片无法收回玩家已经保存或截图的副本，符合熟人房间的产品边界。

## 2026-10-10 熟人局精简

- 移除登录、注册和普通图片上传的进程内计数限流及其长期驻留的 Map。上传仍受 10 MB、图片格式和尺寸限制；放映素材仍由 GM 管理，公开范围不变。
- 保留操作 ID、版本检查与数据库事务。它们用于避免重复扣点、交易重复确认和两个 GM 同时切图时状态倒退，属于多人游戏的数据正确性要求。未引入 Redis、WAF 或额外安全服务。
- 修正 Socket 断开时把 GM 专用通知房间误算为游戏房间的在线状态问题。
- 本次验证：`pnpm typecheck`、`pnpm test`（18 项）、`pnpm lint`、`pnpm build`、`pnpm e2e`（3 个流程）、`smoke:presentation`（50 项）、`smoke:v3`（163 项）通过。直接请求验证连续 12 次无效注册均为 400、22 次无效登录均为 401、31 次缺少文件的普通上传均为 400，未出现旧的 429。尚未在群晖环境验证，在线状态修正也未做独立多窗口断线专项测试。

## 2026-10-10 代码精简与加载优化

- 后端复用统一的 HTTP 错误与异步路由辅助函数，删除没有调用方的角色编辑与日志辅助函数；业务事务、版本和权限行为不变。
- 地图、浮窗内容、独立观众页改为按需加载；浮窗内容到首次打开窗口时才下载。加载失败会显示刷新重试入口。构建的入口 JS 从约 833 KB 降为约 368 KB；地图约 343 KB、浮窗内容约 118 KB 为独立文件。数字是压缩前构建产物，不代表网络实测耗时。
- 房间在线状态更新不再重复读取全量快照；房间业务变更及重连仍刷新。Socket 监听拆为可读结构，卸载时清除手动重连计时器。
- 验证：`pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm e2e`（4 项）在最终代码上通过；同一轮 `pnpm test`（18 项）、剧情 API 50 项、v3 API 163 项通过。新增 E2E 模拟地图模块请求失败，确认房间仍显示并提供重试按钮。按需加载暴露了旧 E2E 的模糊按钮定位，已改为等待角色列表并针对它点击。群晖与其他浏览器的加载效果仍未实测。

## 2026-10-10 UI 动效

- 增加大厅卡片、房间标题/成员区/快捷栏、浮窗、提示消息的一次性入场动效；按钮、骰子预设、背包与装备格有短暂交互反馈；掷骰等待时徽记转动，资源条数值变化平滑过渡。地图画布没有持续动画，剧情图片原有转场保持不变。
- 系统启用“减少动效”时全站禁用动画与过渡；剧情观看窗自身的“关闭动效”仍单独生效。
- 验证：`pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm test`（18 项）、`pnpm e2e`（5 项）通过。新增浏览器测试确认普通模式浮窗有入场动画、系统减少动效模式下动画关闭。尚未在所有屏幕尺寸和其他浏览器做人工动效观感验收。
