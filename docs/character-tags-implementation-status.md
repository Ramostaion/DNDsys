# v3.2 角色标记与 GM 备忘实施状态

## 核查与基线（2026-10-10）

- 当前目录无 `.git`，不能生成 Git 状态或提交；未重置现有文件和数据。
- User 通过 RoomMember 加入房间；Character.ownerId 是当前单一所属账号，成员 `editAllCharacters` 是现有额外控制权限；MapToken.characterId 指向角色。本期标签绑定 Character。
- 头像位于旧/自定义人物卡、角色目录、房间快捷角色条与 Konva Token；无统一头像组件。新增可复用的头像徽章，保留已有头像操作。
- 复用 operations 操作 ID、Prisma 事务、版本冲突、服务端 snapshot 过滤、Socket.IO 轻量通知与重连重新取快照、Zustand 非模态浮窗。
- v3.1 剧情导演台、观看窗与大屏已存在；不修改其窗口状态。
- 标签使用独立表，与 skills/statuses/traits、装备及公式隔离。
- 基线实际运行：`pnpm typecheck`、`pnpm build`、`pnpm lint` 通过；`pnpm test` 18 项通过。

## 阶段

- [x] A：模型/迁移、定义与实例读写、独立详情、人物卡与目录头像入口/徽章已实现。增量迁移 `202610100001_character_tags` 在现有数据库应用成功；`pnpm typecheck` 通过；`pnpm --filter @dnd/api smoke:tags A` 实测 35 项断言通过（A/B 独立、超过 2,000 字、外观联动不覆盖详情、重复分配、无角色数值副作用、改名/单角色移除）。此阶段界面联机尚未验证，随 B 验证。
- [x] B：三种范围服务端过滤（含角色可见性和现有 editAllCharacters 控制权限）、仅房间 ID 的标签 Socket 通知、玩家已打开详情撤回、版本冲突、草稿保护、网络恢复已实现。`smoke:tags B` 70 项通过；Playwright A/B 场景通过（4 个隔离上下文：GM 两窗口、玩家 A/B），覆盖真实 UI 创建/分配、长文预览、隐私与 Socket 正文、撤回、失败重试、关闭保护、GM 草稿冲突、刷新及离线恢复。首次界面测试发现浏览器模拟离线时旧 WebSocket 未立即断开，已增加浏览器离线/上线事件处理，修复后通过。
- [x] C：标签库创建/编辑、搜索、关联数、归档/恢复；总览角色/标签/范围/优先级过滤与备注全文检索；实例详情直接编辑/移除；头像最多 3 图标及 +N、窄屏适配。`smoke:tags C` 77 项通过；Playwright C/D 场景通过，覆盖库搜索、归档恢复、总览定位、Markdown、小屏和减少动效。首次测试有归档文字匹配歧义，收窄测试定位后通过。
- [x] D：Lucide 分类图标/emoji、颜色预设与实时预览，160ms 单次淡入与减少动效，批量独立分配（已有实例跳过，不覆盖备注）。`smoke:tags D` 84 项通过；C/D 界面场景已实测批量分配、独立详情、小屏徽章和减少动效。
- [x] E：完整回归、API 重启恢复、使用说明、迁移与 NAS 恢复步骤已交付。实际 NAS/容器重建与长时间运行观察仍未验证，见下方。

## 集成文件

新增/修改文件：

- 数据：`apps/api/prisma/schema.prisma`、`migrations/202610100001_character_tags/migration.sql`。
- API：`apps/api/src/character-tags.ts`、`domain.ts`、`operations.ts`；新增 `smoke:tags` 脚本。
- 共享：`packages/shared/src/character-tags.ts`、对应测试及 index 导出。
- Web：`ui/character-tags/` 内定义编辑、实例编辑/阅读、分配、管理器、徽章、受控 Markdown、草稿保护、标签库和总览；`CharacterSheet`、`ConfigurableSheet`、`CharacterDirectory`、`Board`、`Windows`、`api`、`store`、`App`、`main`、`character-tags.css`。
- 测试：`character-tags-smoke.mjs`、`character-tags-restart.mjs`、`e2e/character-tags.spec.ts`，八账号和剧情放映回归增加标签检查；共享及 Web 单元测试。
- 文档：本文件、`character-tags-usage.md`、README、ARCHITECTURE、nas-deployment。

## 最终实际验证（2026-10-10）

| 检查 | 结果 |
|---|---|
| `pnpm typecheck` / `pnpm build` / `pnpm lint` | 全部通过 |
| `pnpm test` | 24 项通过（共享 15、API 5、Web 4） |
| `pnpm --filter @dnd/api smoke:tags E` | 107 项通过；覆盖装备/Buff/公式/资源实际生效后标签仍无数值副作用、OWNER 转移与额外控制权限 |
| `pnpm --filter @dnd/api smoke:v3` | 167 项通过 |
| `pnpm --filter @dnd/api smoke:presentation` | 50 项通过 |
| `pnpm e2e` | 最后一轮 8/8 通过，约 2.2 分钟 |
| 地图 Tooltip 后续定向检查 | 补充标签更新/移除时清理 Canvas 旧 Tooltip，地图界面场景通过；类型检查、lint 与构建再次通过 |
| 重启 API 后读取标签 | 两份不同且超过 2,000 字的备注完整恢复，OWNER/GM 可见范围正确，测试前房间 ID 均保留，临时数据已清理 |
| 增量迁移再次执行 | 成功，提示无待应用迁移；未 reset/清库 |
| 标签测试数据清理核对 | QA tags / E2E tags 临时房间剩余 0 |

完整界面测试覆盖：三账号（另加 GM 第二窗口）创建/分配与独立详情、Socket 不含秘密正文、公开撤回、草稿焦点、冲突、网络失败重试、误关闭保护、远端移除保留 GM 草稿、刷新/断线恢复；标签库搜索/归档/恢复/批量独立分配/总览筛选；受控 Markdown；3 图标 +N、小屏与减少动效；地图徽章打开详情且不移动 Token、Token 拖动与换图；八账号公开与 OWNER 标签同步、手动数值及高清图片；剧情放映最小化保持、标签更新不清空人物卡草稿；原 v3.0 装备/Buff/公式、人工记录和自由骰。

最终八账号实测：并行读取快照合计约 1,700ms，响应 4,984–7,247 字节；1920×1080 剧情图约 988ms 全部加载。这是本机测量，不作为生产环境性能保证。

首次完整回归 7/8 通过，八账号测试使用旧 `.grid-card button` 定位，角色目录为避免徽章嵌套按钮已改用可访问角色入口。更新该测试并加入八账号标签验证后，单独测试与最终完整套件均通过。新增资源回归夹具最初使用旧版「胸部」槽，调整为新房间「护甲」槽后 107 项通过。重启验证脚本首次误用 Fetch 的 `ok()`，已改为 `ok` 属性，重新准备夹具、真正重启 API 并验证通过。

## 迁移与运行

标签全部持久化在现有 PostgreSQL。Compose 不变，无新增服务/卷/依赖。迁移及运行命令见 [使用说明](character-tags-usage.md)。

重启验证可复现（本地 API/数据库与 demo 账号就绪，工作目录 `apps/api`）：

```powershell
node scripts/character-tags-restart.mjs prepare
# 停止并重新启动 API，然后执行：
node scripts/character-tags-restart.mjs verify
```

脚本只创建并核对自身临时房间，验证后删除该夹具。数据库新增表保留旧角色、装备、状态、任务、地图与剧情素材。

## 尚未验证

- 当前机器无 Docker 命令；群晖 Docker 镜像构建、容器重建、生产数据库升级/备份恢复未实测，按使用说明和 NAS 文档在副本验证。
- 未进行数小时/数天连续运行观察、真实公网波动和所有历史数据逐条核对；本轮实测为本机浏览器/本地 PostgreSQL。
- 地图徽章使用同类字符符号而非 Lucide SVG；人物卡/角色列表使用所选 Lucide/emoji。鼠标操作已实测，触摸屏地图操作未验证。
- 不提供永久删除整个定义或复杂富文本协作；归档与单角色移除已实现。无标签自动提醒、战斗或数值自动化。
