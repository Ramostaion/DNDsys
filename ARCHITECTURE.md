# Project DND v3.3 架构

## 产品边界

项目是多人 TRPG 辅助工具。服务器处理字段公式、装备与 Buff 被动修正、权限及同步；动作声明关联合法敏捷双方时自动执行 D20 命中对抗，其他裁决、伤害、资源消耗、状态持续时间和剧情仍由参与者决定。`combat.attack` 旧自动伤害结算继续停用，历史事件仍可读。

敏捷扩展复用 `combat.record`：共享 `agility-contest.ts` 定义规则和快照，API `agility-service.ts` 在原事务内重新读取角色/装备/效果并使用原骰子解析器生成两颗 D20，完整快照存入原 `CombatEvent.data`。原 Socket.IO `change` 消息携带结果摘要，前端窗口/历史详情与主视窗广播分开，保存重试沿用操作编号。没有新增表、迁移或基础设施；广播状态表示已调用发送，不等同于所有成员收讫。详见 [实施记录](docs/agility-contest-2026-10-14.md)。

## 应用层

- `apps/web`：React/Vite、Zustand 浮窗状态、Konva 地图。页面通过 HTTP 写操作，Socket.IO 收到变更通知后重新读取当前账号有权查看的快照。字段管理、人物卡、物品实例、模板、手工战斗和骰子均调用真实 API。
- `apps/api`：Express/Socket.IO、Prisma/PostgreSQL。业务写操作保留房间成员/角色权限、操作 ID 幂等、事务与版本检查。`character-values.ts` 负责重算，`snapshot.ts` 负责按查看者过滤快照；`combat.ts` 负责人工战斗记录与服务器骰子；`upload.ts` 校验图片内容。
- `packages/shared`：旧房间 DND 规则、骰式解析，以及新房间安全字段公式和 Modifier 计算。前后端共享公式语义，最终计算结果以服务器保存的值为准。
- `apps/api/src/presentation.ts`：剧情素材上传与读取、章节/Cue 管理、放映控制和图片权限。原图、屏幕图和缩略图存在上传卷，元数据和当前放映状态存在 PostgreSQL。`apps/web/src/ui/presentation` 提供 GM 导演台、玩家观看窗、线索回看和独立只读大屏。
- `apps/api/src/character-tags.ts`：独立标签定义/角色实例操作与可见读取，接入既有 operations 和 snapshot；Web `ui/character-tags` 提供标签库、实例备注编辑/阅读、头像徽章和 GM 总览。共享包定义 DTO、可见范围及稳定排序，不接入数值重算。

## 模块边界与维护入口

公开骰的计算与记录由 `apps/api/src/dice-service.ts` 负责，`operations.ts` 复用房间行锁、操作回执和提交后 Socket 通知。只有骰子事务使用 READ COMMITTED；其他事务保持原设置。数据库保存房间公开截止时间及当时的掷骰者名称/身份。Web `ui/dice/useRoomDice.ts` 维护实时演出及单调时钟，`PublicDiceBanner` 独立显示顶部浮层；快照仅恢复历史与冷却，不重播。见[具体接口与验证](docs/public-dice-2026-10-13.md)。

正式运行将编译后的 Web、API 和 Socket.IO 放在同一个 Node 进程及 HTTP 端口，数据库仍独立持久化。开发模式继续使用 Vite 和 API，业务模块及同步协议共用。没有增加队列或缓存服务。

```text
API index.ts → config.ts + bootstrap.ts
                    ↓
                  app.ts（应用组装）
                    ├─ auth.ts / access.ts（账号、成员权限）
                    ├─ routes/（房间、上传 HTTP 接口）
                    ├─ realtime.ts（联机、在线状态、定向通知）
                    └─ operations.ts（事务、去重、日志、提交后通知）
                            ↓
                       operations/dispatch.ts
                            ↓
                       按角色、地图、物品、背包、交易、模板等拆分的处理器
                            ↓
                       character-values.ts / snapshot.ts / data.ts

Web App.tsx（账号门禁、路由）→ AuthPage / Lobby / Room
Room → useRoomSession / useRoomConnection / room/ 公共界面
Windows.tsx（移动、缩放、关闭）→ windows/WindowContent.tsx（功能路由）
```

- `config.ts` 统一检查端口、访问源和会话配置；`storage.ts` 解析上传目录并在启动时检查写权限。已有图片模块沿用同一进程的上传目录，不增加存储适配层。
- `bootstrap.ts` 管理数据库连接、原有背包兼容整理、角色重算、监听和停止。`createApplication` 只组装应用，便于测试时注入数据库，不在导入时启动服务。
- `operations.ts` 是业务写入的事务边界。新操作在对应处理器实现，并在 `dispatch.ts` 注册；不要把事务、操作回执或提交后通知复制到各处理器。
- `operations/context.ts` 定义处理器上下文，`helpers.ts` 共享查询、权限和版本检查。独立剧情、标签、私密线索模块保留原接口及自己的投递逻辑。
- `data.ts` 提供数据结构兼容工具；`character-values.ts` 只负责数值；`snapshot.ts` 只负责读取与可见过滤。`domain.ts` 保留旧导入兼容出口，旧脚本无需改写。
- `useRoomConnection` 集中连接、加入确认、在线状态和重连恢复；回调更新不会重建 Socket。`useRoomSession` 管理房间快照、提交和错误。私密收件仍由自己的 hook 保存，避免混入公共快照。
- `ui/room` 保存侧栏、同行者、绘图工具和房间设置；`ui/windows` 保存窗口内容路由与名称，`Windows.tsx` 专注窗口交互。角色、地图等功能组件仍独立维护。
- 源码和联机测试使用 `pnpm format` / `pnpm format:check`。新增功能先定位所属模块，再运行其相关回归；改事务、权限或同步边界时执行完整联机套件。

运行配置与静态网页分属 config.ts / web-static.ts；构建缓存由 scripts/launcher-build.mjs 管理，网页预压缩由 scripts/prepare-web-assets.mjs 管理。数据库表、操作名称与 Socket 事件继续兼容。早期解耦证据见 [历史架构调整](docs/architecture-nas-2026-10-11.md)，当前部署见 Windows Server 说明。

## 数据和兼容

Windows 启动保持 BAT → `scripts/start-dnd.ps1` → 子服务的结构。`launcher-runtime.ps1` 管理项目内 Node/pnpm，`launcher-dependencies.mjs` 检查依赖及复制链接，`launcher-config.mjs` 读取端口/性能参数和数据库登记，`launcher-database.mjs` 备份并修正搬家日志路径。正式模式自动构建或复用原构建，用一个编译后的 API 进程在 5242 提供网页/接口/实时连接，预压缩静态资源和哈希文件长期缓存，HTML 每次校验。开发模式后台仍为 3001，Vite 网页为 5242。原数据库和迁移复用；运行中的子服务及安装程序由 `LauncherJob.cs` 管理，关窗清理。部署及验证范围见 [Windows Server 说明](docs/windows-server-deployment.md)。

旧房间 `sheetMode=false` 沿用 `attributes/currentHp/formulas` 等字段。新房间 `sheetMode=true` 使用 `Room.sheetSchema` 定义字段，`Character.fieldValues` 存原始值，`Character.derived` 存计算结果、来源与错误。字段 ID 稳定，显示名可变。数据库迁移只添加列或表，旧值不清空。

公共 `ItemDefinition` 与 `Template` 可复用；`InventoryEntry.data` 存实例差异，`EquippedItem` 表示装备关系。独立物品实例修正优先于公共定义；模板安装可选择共享引用或独立副本。交易请求在同一数据库事务中确认和转移。

地图、角色、Token 可设为公开或仅 GM 可见。快照按成员身份过滤私密字段、场景、骰子、战斗事件和审计日志；上传图片按房间和公开/私密路径鉴权。房间权限模式有自由、混合和受控三档，可按能力覆写，也可设置成员例外。地图、角色与 Token 暂无任意指定玩家的可见范围，详见 [实施状态](docs/implementation-status.md)。角色标签的 OWNER 范围见下文。

剧情图片的 `PresentationAsset`、`PresentationGroup`、`PresentationCue` 和 `PresentationSession` 均按房间关联。一个素材可被多个 Cue 引用；删除引用中或正在放映的素材需要明确确认。图片文件使用与现有上传同一个持久卷，数据库迁移只新增表和关联字段，旧房间及旧上传文件继续保留。

`TagDefinition` 保存外观、默认范围与备注初稿；`CharacterTag` 保存角色独立详情、范围、优先级和版本。组合外键防止跨房间引用，角色/定义组合唯一；归档定义保留实例。OWNER 使用现有 ownerId/editAllCharacters 控制权限，且所有标签先遵守角色基础可见性。玩家快照不包含标签库默认备注或关联计数；只能取得被授权实例的名称/图标/颜色。标签写入不调用 refreshCharacter，不改变角色版本、资源、装备或 Buff。

## 数据流

1. 客户端带操作 ID 和实体版本发起写入。
2. API 验证身份、房间成员及业务权限，在事务内写入原始数据和操作回执。
3. 影响角色数值的操作调用共享公式引擎重算，保存派生值及来源。
4. 事务提交后 Socket 发出变更通知；私密骰通知掷骰者与 GM。标签通知仅携带房间 ID，客户端重新读取过滤后的快照，Socket 不发送备注正文。
5. 客户端重新读取权限过滤后的快照。断线重新连接后仍读取数据库权威状态。

放映控制也使用操作 ID 与版本检查。事务提交后 Socket 仅广播房间 ID 和放映版本；各客户端通过 HTTP 获取当前状态，忽略晚到的旧版本。刷新、重连和晚加入都以数据库状态为准。图片加载失败时观看窗保留错误与重试入口；本地窗口位置和动效偏好不写入房间公共状态。

标签草稿留在编辑组件中，普通快照更新不重新挂载浮窗。版本冲突不会覆盖草稿；远端移除时 GM 可继续复制草稿，玩家详情直接从当前权限快照读取并立即清除撤回内容。浏览器离线事件断开 Socket，上线后重新加入房间并取快照；取消旧快照请求，避免晚到旧请求覆盖新权限内容。

部署结构、数据目录和备份操作见 [Windows Server 部署说明](docs/windows-server-deployment.md)。

## v3.3 私密线索数据流

`PrivateClue` 是固定内容原件，`ClueDelivery` 按玩家账号保存独立 readAt / savedAt；`ClueAttachment` 与关联表保存不可变附件及顺序。关联角色只保存名称说明，不把投递生命周期绑定到 Character。房间删除按外键级联清理；角色删除不删除私人收件。

独立模块 `private-clues.ts` 复用登录、房间成员、GM 与 OperationReceipt。发送在同一个事务内认领操作 ID、校验本房间全部账号与落盘附件、创建原件及所有投递，提交后向对应已验证账号的 Socket 连接发送最小变更通知。私人正文、接收名单与图片地址不进入公共房间快照或日志。接收人列表及详情只返回当前账号的投递，GM 发件箱只返回自己发送的原件；玩家返回对象不含 GM 备注或他人回执。

图片存于现有 UPLOAD_DIR 下的房间 private-clues 子目录，认证路由校验成员及有效投递。公开剧情素材导入复制独立文件，不改当前放映，也不依赖原素材删除行为。附件已有引用时禁止删除；撤回保留文件，避免误删另行投递仍引用的素材。

Web 在 Room 中持有独立收件箱状态，通过序号与取消旧请求处理迟到响应；Socket 重连、上线、焦点恢复和在线 30 秒补拉均读取权威数据。浮窗内容按房间／账号隔离挂载，普通快照更新不重挂载草稿。通知不会打开浮窗或获取输入焦点。已读在详情显示后提交，失败保留待同步提示；玩家收藏和未读、GM 回执通过定向通知刷新。受控分享建立新原件和投递，不复制 GM 备注，根原件的分享权限及撤回控制已有副本。
