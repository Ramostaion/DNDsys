# Project DND v3.3 架构

## 产品边界

项目是多人 TRPG 辅助工具。服务器处理字段公式、装备与 Buff 被动修正、权限及同步；动作声明关联合法敏捷双方时自动执行 D20 命中对抗，其他裁决、伤害、资源消耗和剧情仍由参与者决定；状态持续时间由 GM 设置，可选回合系统开启后按角色正式回合递减。`combat.attack` 旧自动伤害结算继续停用，历史事件仍可读。

敏捷规则仍由共享 `agility-contest.ts` 和 API `agility-service.ts` 处理：双方独立D20、按有效属性使用原敏捷加值表、总值最低1、相等时防御方闪避。默认敏捷对敏捷，新增actorAttribute允许行动方选择力量/体质/智力/感知/魅力，目标始终使用敏捷；属性名随判定保存，并绑定指纹和保存校验。原 `combat.record` 与 `CombatEvent.data`、保存结果广播/详情继续保留。新界面先通过 `combat-drafts.ts` 生成持久化临时 `CombatDraft`，保存时在原房间锁和操作回执事务中验证所有者、版本、事件、角色、范围、租约及最新输入指纹，直接消费同一结果；失效返回409，不在保存分支补骰。成功后清空临时结果，仅保留结束标记和正式记录ID。没有草稿ID的旧API仍按原动作声明流程在保存时判定，以兼容旧客户端；新界面关联目标后始终提交草稿引用。详见[两阶段说明](docs/combat-drafts-2026-10-17.md)；原规则历史见[实施记录](docs/agility-contest-2026-10-14.md)。

临时结果不写 `CombatEvent`、`DiceRoll`、操作回执或公共活动日志；`CombatDraft` 是独立租约表，迁移只新增表/索引/级联外键。PUT按房间锁与草稿递增版本处理，指纹未变化复用原事件和骰点；DELETE保留终止标记，阻止晚到请求复活。90秒租约由发起窗口每25秒续期，观看端每15秒补拉并按服务器时间独立到期；同版本过期续期不能重新投骰。`combatDraft.changed` 只广播roomId，HTTP每次重算当前输入并检查当前成员/控制/隐藏范围，输出仅含可观看双方的头像、名字、D20、加值和总值。临时内容不进入原快照，通知也不触发全地图快照刷新。

Web `useCombatDraft` 隔离每个窗口的草稿ID、请求序号、保存重试与关闭清理；本地遮蔽绑定预期事件ID，旧请求不能露出旧目标结果。`CombatDraftPerformances` 在主视窗独立渲染，每个草稿单独成卡；数字翻动、两侧入场、装饰线和两枚短暂粒子使用有限CSS动画，结束后静态显示。只在结果/阶段/到期时更新局部状态，不逐帧更新全局或地图；pointer-events:none，旧保存广播层级更高。重连仅静态恢复仍有效草稿，结束的草稿不恢复；减少动效直接显示静态真实值。

临时对抗GET不使用交互事务，房间/成员/角色/装备按批次读取，同一请求内复用相同角色属性计算；仍逐次校验权限和最新指纹。Web同一观看端最多一个请求在途和一个合并后续刷新；棋子移动、画笔和尺子不触发对抗读取。写事务保留原锁、隔离与10秒执行上限，将排队上限设为15秒；P2028/P2024返回可重试503，操作回执继续防止重复保存。

双手武器仅保存一个EquippedItem实例，equipmentAtSlot在主副手返回同一实例，equipmentConflicts处理两手占用和替换；背包数量、交易和数值引擎仍按一个物理实例计算。服务端创建/编辑物品与客户端共用部位分隔解析，明确主手不兼容手部；改类型或部位会重验穿戴、归还不合法装备，满包整体回滚。人物卡将技能、可见状态、特性分层展示。新状态默认公开，旧私密范围保留；状态同名数值词条参与重算，技能词条仅记录。

背包的只读详情和悬停/右键菜单由`InventoryItemDetails.tsx`维护，只读取过滤快照，Portal避免浮窗裁剪且不请求数据库。`TradePanel`统一放入Inventory，显式角色和玩家默认入口共用原确认交易；转移下拉默认当前角色。Inventory接收格子及整面板卸装拖放，图片使用父物品拖放，满格同堆叠可合并。新增`inventory.delete`按版本、当前背包/穿戴数量删除未装备部分并取消待处理交易，确认请求固定操作ID以复用原回执；玩家旧实例/数量编辑API拒绝，GM维护API兼容。见[背包交互说明](docs/inventory-interactions-2026-10-17.md)。

## 应用层

- `apps/web`：React/Vite、Zustand 浮窗状态、Konva 地图。页面通过 HTTP 写操作，Socket.IO 收到变更通知后重新读取当前账号有权查看的快照。字段管理、人物卡、物品实例、模板、手工战斗和骰子均调用真实 API。
- `apps/api`：Express/Socket.IO、Prisma/PostgreSQL。业务写操作保留房间成员/角色权限、操作 ID 幂等、事务与版本检查。`character-values.ts` 负责重算，`snapshot.ts` 负责按查看者过滤快照；`combat.ts` 负责人工战斗记录与服务器骰子；`upload.ts` 校验图片内容。
- `packages/shared`：旧房间 DND 规则、骰式解析，以及新房间安全字段公式和 Modifier 计算。前后端共享公式语义，最终计算结果以服务器保存的值为准。
- `apps/api/src/presentation.ts`：剧情素材上传与读取、章节/Cue 管理、放映控制和图片权限。原图、屏幕图和缩略图存在上传卷，元数据和当前放映状态存在 PostgreSQL。`apps/web/src/ui/presentation` 提供 GM 导演台、玩家观看窗、线索回看和独立只读大屏。
- `apps/api/src/character-tags.ts`：独立状态定义/角色实例操作与可见读取，接入既有 operations 和 snapshot；Web `ui/character-tags` 提供状态库、实例备注编辑/阅读、头像徽章和 GM 总览。共享包定义 DTO、可见范围及稳定排序；角色状态的数值词条参与 character-values 重算，技能模板词条保持纯记录。

## 模块边界与维护入口

公开骰的计算与记录由 `apps/api/src/dice-service.ts` 负责，`operations.ts` 复用房间行锁、操作回执和提交后 Socket 通知。骰子、正式战斗记录、画笔历史以及回合/先手/角色状态写入使用READ COMMITTED；回合和状态使用房间NO KEY UPDATE短锁与会话版本/回执，其他写事务保持原设置。数据库保存房间公开截止时间及当时的掷骰者名称/身份。Web `ui/dice/useRoomDice.ts` 维护实时演出及单调时钟，`PublicDiceBanner` 独立显示顶部浮层；快照仅恢复历史与冷却，不重播。见[具体接口与验证](docs/public-dice-2026-10-13.md)。

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
- `operations/context.ts` 定义处理器上下文，`helpers.ts` 共享查询、权限和版本检查。独立剧情、状态、私密线索模块保留原接口及自己的投递逻辑。
- `data.ts` 提供数据结构兼容工具；`character-values.ts` 只负责数值；`snapshot.ts` 只负责读取与可见过滤。`domain.ts` 保留旧导入兼容出口，旧脚本无需改写。
- `useRoomConnection` 集中连接、加入确认、在线状态和重连恢复；回调更新不会重建 Socket。`useRoomSession` 管理房间快照、提交和错误。私密收件仍由自己的 hook 保存，避免混入公共快照。
- `ui/room` 保存侧栏、同行者、绘图工具和房间设置；`ui/windows` 保存窗口内容路由与名称，`Windows.tsx` 专注窗口交互。角色、地图等功能组件仍独立维护。
- 第一批交互反馈由 `ui/ResourceMeter.tsx`、`ui/ActionFeedback.tsx` 和 `ui/ui-feedback.css` 维护：数值只比较同一资源的已确认快照，房间初次连接/重连先建立静默基线；浮窗操作状态按房间和账号隔离，原 mutate 成功后才提示完成，直接 HTTP 的房间内名称另行接入。`store.ts` 的短暂退场保留原草稿保护，恢复可取消旧计时器。背包/装备的本地拖放预览使用既有权限和部位规则，实际提交继续由原 API 校验，成功后才显示落位反馈。
- 第二批地图反馈由 `Board.tsx`、`RulerPreview.tsx`、`map-feedback.css` 维护：棋子选择仅存本地；量尺预览复用实际放置的尺寸与吸附规则，以 Konva 引用更新位置，不逐帧写 React 状态或数据库，预览层不参与命中。`RoomBroadcasts.tsx` 与 `broadcast-layout.ts` 只组织现有骰子/战斗广播，保留原权限、事件去重和时钟；近期摘要最多两条，沿用原到期时间，不延长历史演出。房间/账号切换重新挂载广播容器，系统减少动效关闭进退场与符文动画。私密线索模块本批不改。
- 源码和联机测试使用 `pnpm format` / `pnpm format:check`。新增功能先定位所属模块，再运行其相关回归；改事务、权限或同步边界时执行完整联机套件。

运行配置与静态网页分属 config.ts / web-static.ts；构建缓存由 scripts/launcher-build.mjs 管理，网页预压缩由 scripts/prepare-web-assets.mjs 管理。数据库表、操作名称与 Socket 事件继续兼容。早期解耦证据见 [历史架构调整](docs/architecture-nas-2026-10-11.md)，当前部署见 Windows Server 说明。

## 数据和兼容

`RoomMember.displayName` 保存每个账号在单个房间的可选显示名，空值回退到 `User.username`；`packages/shared/src/room-member-name.ts` 统一回退规则。`POST /api/rooms/:roomId/members/me/profile` 只允许当前成员修改自己，严格校验 30 字符上限及控制字符，提交后通过原 `change/member.profile` 通知刷新快照和私密线索回执。登录、角色归属及权限继续以账号 ID 判断。新骰子、量尺和线索使用房间内名称保存署名快照，旧署名不追溯重写；迁移只增加可空列，不回填或清空旧数据。

Windows 启动保持 BAT → `scripts/start-dnd.ps1` → 子服务的结构。`launcher-runtime.ps1` 管理项目内 Node/pnpm，`launcher-dependencies.mjs` 检查依赖及复制链接，`launcher-config.mjs` 读取端口/性能参数和数据库登记，`launcher-database.mjs` 备份并修正搬家日志路径。正式模式自动构建或复用原构建，用一个编译后的 API 进程在 5242 提供网页/接口/实时连接，预压缩静态资源和哈希文件长期缓存，HTML 每次校验。开发模式后台仍为 3001，Vite 网页为 5242。原数据库和迁移复用；运行中的子服务及安装程序由 `LauncherJob.cs` 管理，关窗清理。部署及验证范围见 [Windows Server 说明](docs/windows-server-deployment.md)。

旧房间 `sheetMode=false` 沿用 `attributes/currentHp/formulas` 等字段。新房间 `sheetMode=true` 使用 `Room.sheetSchema` 定义字段，`Character.fieldValues` 存原始值，`Character.derived` 存计算结果、来源与错误。字段 ID 稳定，显示名可变。数据库迁移只添加列或表，旧值不清空。

公共 `ItemDefinition` 与 `Template` 可复用；`InventoryEntry.data` 存实例差异，`EquippedItem` 表示装备关系。独立物品实例修正优先于公共定义；模板安装可选择共享引用或独立副本。交易请求在同一数据库事务中确认和转移。

背包容量由共享 `inventoryCapacity` 按服务端有效力量计算：15点对应24格、每点增减2格，结果向下取整并限制为0至数据库Int上限。自定义卡识别唯一数值型“力量”名称或稳定力量ID，旧卡要求实际存在数值型 `attributes.力量`；缺失/无效时沿用数据库 `inventorySlots`（默认24）。数据库容量字段不追写，允许查看背包的快照才返回计算容量。加入、整理、转移、拾取、交易确认及卸装布局复用此规则；装备效果先重算再处理卸装布局，满格卸装事务回滚。缩容不删除、重建或搬动正位置物品，超出范围仍可选择、拖放与转移。`firstInventorySpace` 按已占位置查找，计入溢出占用、排除负位置穿戴实例，避免按容量分配大数组；批量卸装时同步更新内存位置。界面每页最多96格，超出位置另列“待整理”，不自动扩容。无新迁移或独立容量缓存。

地图、角色、Token 可设为公开或仅 GM 可见。快照按成员身份过滤私密字段、场景、骰子、战斗事件和审计日志；上传图片按房间和公开/私密路径鉴权。房间权限模式有自由、混合和受控三档，可按能力覆写，也可设置成员例外。地图、角色与 Token 暂无任意指定玩家的可见范围，详见 [实施状态](docs/implementation-status.md)。角色状态的 OWNER 范围见下文。

剧情图片的 `PresentationAsset`、`PresentationGroup`、`PresentationCue` 和 `PresentationSession` 均按房间关联。一个素材可被多个 Cue 引用；删除引用中或正在放映的素材需要明确确认。图片文件使用与现有上传同一个持久卷，数据库迁移只新增表和关联字段，旧房间及旧上传文件继续保留。

`TagDefinition` 保存外观、默认范围与备注初稿；`CharacterTag` 保存角色独立详情、范围、优先级、自定义词条和版本。组合外键防止跨房间引用，角色/定义组合唯一；归档定义保留实例。OWNER 使用现有 ownerId/editAllCharacters 控制权限，且所有状态先遵守角色基础可见性。玩家快照不包含状态库默认备注或关联计数；只能取得被授权实例的名称/图标/颜色。状态实例的添加、编辑、移除调用 refreshCharacter，同名数值词条参与公式引擎；模板词条仅作为新分配初稿。私密状态来源在快照和正式对抗响应中隐藏名称/实例ID，仅保留数值；临时对抗输入也读取状态关系并重新验证指纹。

## 数据流

1. 客户端带操作 ID 和实体版本发起写入。
2. API 验证身份、房间成员及业务权限，在事务内写入原始数据和操作回执。
3. 影响角色数值的操作调用共享公式引擎重算，保存派生值及来源。
4. 事务提交后 Socket 发出变更通知；私密骰通知掷骰者与 GM。状态通知仅携带房间 ID，客户端重新读取过滤后的快照，Socket 不发送备注正文。
5. 客户端重新读取权限过滤后的快照。断线重新连接后仍读取数据库权威状态。

放映控制也使用操作 ID 与版本检查。事务提交后 Socket 仅广播房间 ID 和放映版本；各客户端通过 HTTP 获取当前状态，忽略晚到的旧版本。刷新、重连和晚加入都以数据库状态为准。图片加载失败时观看窗保留错误与重试入口；本地窗口位置和动效偏好不写入房间公共状态。

状态草稿留在编辑组件中，普通快照更新不重新挂载浮窗。版本冲突不会覆盖草稿；远端移除时 GM 可继续复制草稿，玩家详情直接从当前权限快照读取并立即清除撤回内容。浏览器离线事件断开 Socket，上线后重新加入房间并取快照；取消旧快照请求，避免晚到旧请求覆盖新权限内容。

部署结构、数据目录和备份操作见 [Windows Server 部署说明](docs/windows-server-deployment.md)。

## v3.3 私密线索数据流

`PrivateClue` 是固定内容原件，`ClueDelivery` 按玩家账号保存独立 readAt / savedAt；`ClueAttachment` 与关联表保存不可变附件及顺序。关联角色只保存名称说明，不把投递生命周期绑定到 Character。房间删除按外键级联清理；角色删除不删除私人收件。

独立模块 `private-clues.ts` 复用登录、房间成员、GM 与 OperationReceipt。发送在同一个事务内认领操作 ID、校验本房间全部账号与落盘附件、创建原件及所有投递，提交后向对应已验证账号的 Socket 连接发送最小变更通知。私人正文、接收名单与图片地址不进入公共房间快照或日志。接收人列表及详情只返回当前账号的投递，GM 发件箱只返回自己发送的原件；玩家返回对象不含 GM 备注或他人回执。

图片存于现有 UPLOAD_DIR 下的房间 private-clues 子目录，认证路由校验成员及有效投递。公开剧情素材导入复制独立文件，不改当前放映，也不依赖原素材删除行为。附件已有引用时禁止删除；撤回保留文件，避免误删另行投递仍引用的素材。

Web 在 Room 中持有独立收件箱状态，通过序号与取消旧请求处理迟到响应；Socket 重连、上线、焦点恢复和在线 30 秒补拉均读取权威数据。浮窗内容按房间／账号隔离挂载，普通快照更新不重挂载草稿。通知不会打开浮窗或获取输入焦点。已读在详情显示后提交，失败保留待同步提示；玩家收藏和未读、GM 回执通过定向通知刷新。受控分享建立新原件和投递，不复制 GM 备注，根原件的分享权限及撤回控制已有副本。

私密收件通知的装饰由 `SealedClueMark.tsx` / `sealed-clue.css` 实现，0.56秒仅作用于固定44px图标。`usePrivateClues` 只在既有新投递识别分支增加本地通知序号；`Room` 仅按序号重新挂载图标，正文/浮窗不使用该键。相同条数的连续投递仍各触发一次并重置原6秒通知期限，普通刷新/回执不改序号。正文移除原阅读器自身入场动画，读取与已读请求流程不变；图标辅助阅读隐藏且不参与指针，减少动效使用静态开启状态。

程序化替换私密投递草稿时，`store.close(id, { immediate: true })` 在通过原关闭保护后立即卸载旧投递台，使再次投递读取新草稿；普通关闭仍播放原120ms退场。即时关闭也清理旧motionId与关闭保护，旧定时回调不能删除随后新开的窗口。

窗口控制统一为关闭：普通浮窗移除minimized字段、minimize操作与对应退场动画，侧栏和私密图片Esc判断只处理未退场窗口；原关闭保护、120ms关闭退场和再次投递的即时替换保留。剧情观看窗沿用hidden与原重开入口，加载旧偏好时将minimized转换为hidden并删除旧字段，防止旧配置产生不可恢复的隐藏状态。

视觉基础由 `ui/visual-foundation.css`、`ui/character-sheet.css` 在main入口加载，分别管理中性内层边线/主要操作强调及人物卡档案式布局。人物卡局部样式限定character-sheet祖先，保留既有状态色与反馈动画；资源卡仅增加展示class/data属性及上限small状态，不复制资源状态或修改权限。CharacterAvatar仅增加原生CSS金属框，状态徽章仍由原组件定位。资源当前/上限卡在宽容器并列、窄容器纵排，GM/玩家及新旧人物卡继续使用同一服务端数据和既有编辑逻辑。

胸部背包使用独立的“背包”装备槽与物品种类，equipmentFitsSlot 区分护甲和背包。characterDerived 只从已穿戴的背包物品读取非负整数格数，写入 inventoryBonus；inventoryCapacity 在原力量容量上加此项，快照、整理、交易及跨角色穿脱沿用同一函数。迁移26只为已有胸部的房间增加此槽，不删除原装备。详见[状态和背包说明](docs/states-backpacks-2026-10-17.md)。

Windows本地数据库启动由launcher-database-runtime.mjs校验并准备固定版本的项目运行环境，launcher-local-database.mjs显式stateful打开已登记原库；不再通过临时prisma dev CLI选择每日缓存。检查PGlite原生核心和Prisma资源清单，失败日志持久保存，ELOCKED在60秒期限内等待恢复。游戏进程/数据库仍由原LauncherJob持有，不增加常驻服务或改数据目录。

人物卡与背包共用HoverCard.tsx的延迟、Portal定位及清理逻辑；CharacterAbilityDetails.tsx只展示当前快照中的说明、词条、状态备注与特性启停，不单独读取服务器。CharacterSkills按最新权限过滤数组解析悬停ID，撤回状态权限后立即卸载内容，鼠标仍在徽章内时子按钮失焦不关闭悬停。状态库将isArchived以可恢复删除呈现，确认提示、显示已删除筛选、恢复及人物卡来源提示一致，现有实例和数值保持原语义。

状态名称的罗马数字由 `TagDefinition.romanNumeral` 保存分配默认值、`CharacterTag.romanNumeral` 保存独立实例值，迁移28给旧数据默认空字符串。共享 I–X 枚举、服务端校验和数据库约束共同限制输入；旧更新省略字段保留原值，人物复制保留实例值。`StateName.tsx` 统一名称与金色衬线后缀，复用原权限快照/Socket，不参与数值或计时计算。见[实施说明](docs/state-roman-2026-10-18.md)。

`StateDetailsContent`统一状态浮窗和悬停的只读内容。头像徽章与回合HUD复用HoverCard事件，地图状态使用鼠标位置的虚拟锚点接入同一定位器；useHoverPreview泛型默认HTMLElement以保留背包兼容。预览始终按ID从当前权限快照解析，不持有旧状态正文；移除/撤权直接卸载。没有新增读取接口或悬停写操作。见[状态详情说明](docs/state-details-2026-10-18.md)。

## 可选回合与时序

`initiative.ts` 发现人物卡合法数值属性，将每项按 GM 明确的 min/max 映射到0–100，按权重合计100%加上个体修正。支持多套 `InitiativePreset`、全局选择与 `Character.initiativeConfig` 覆盖，缺失默认阻止，另可贡献0或指定原值，不重分配权重。数值公式与状态/装备有效值复用原引擎；不掷D20。

`TurnSession` 与原 `CombatEncounter` 独立，每房间最多一条未结束会话。参与者JSON记录人物/代表Token、本轮得分、计算依据、首次参与和最后完成轮次。原地图切换不变更绑定；同一卡多个Token仅入队一次，独立人物副本分别管理。结束/跳过只递减当前人物有限状态，归零和手动移除共用 `removeCharacterStates` + `refreshCharacter`；达到轮数上限进入LIMIT等待GM延长或结束。所有状态、顺序、回执和审计原子提交，Socket在事务后仅通知重读。

调度纯函数拆为 `findNextUnactedActor` / `nextTurn`（只结算旧轮）、`sortInitiativeOrder`（同分保留历史）、`rebuildNextRound`（新轮清标记并选新首位）、`recalculateTurn`（中途保留当前人物和已行动）。轮末 `rebuildRound` 在状态效果撤销后批量读取真实人物/装备/状态并重新计算，不使用旧derived缓存。空队列暂停；LIMIT延长也走重建。Web完整快照拒绝同会话低版本，等版本继续接受权限/属性变化；HUD按稳定人物ID以局部260ms transform动画重排，减少动效或重连时不回放。见[动态排序说明](docs/turn-round-rebuild-2026-10-18.md)。

行动顺序HUD的视觉采用深蓝黑玻璃渐变和CSS微纹理，序号/头像/两行名称固定节奏；当前人物仅在伪元素上播放opacity/transform呼吸，已行动勾选降亮。底部进度仅从当前权限过滤的参与者资格与已行动标记派生，不写入会话。701–760px避让原队伍面板，其余宽度内部滚动；原状态悬停、重排和退场独立保留。见[视觉方案与实测](docs/turn-hud-visual-2026-10-18.md)。

紧凑布局上移HUD并压缩头像、节点及留白，保留姓名字号。局部 `TurnRoundProgress` 通过会话ID/版本识别已确认的轮末变化，进度条用420ms补满再归零，不延迟新轮队列、当前人物或计数器；重复版本不回放，重连/减少动效跳过，卸载或新操作清理旧效果。完成展示继续检查当前可见人物资格；LIMIT保持满格直到原延长/结束操作。见[紧凑布局与轮末进度](docs/turn-hud-compact-progress-2026-10-18.md)。

权限快照隐藏玩家无权查看的地图、人物、Token、状态和GM计算依据；普通人物操作响应及大厅列表也不返回新增GM配置。快照首尾核对回合版本，有限重读避免推进与状态快照混合，不新增长读事务。客户端通过预期版本、固定重试ID、请求防重及服务端400ms推进间隔处理竞争；断线恢复只读状态，不计时。Web的独立CSS/局部HUD不逐帧更新地图，支持紧凑滚动和减少动效。原战斗记录、成功弹窗、生命及坐标逻辑不变。详见[回合系统实施说明](docs/turn-system-2026-10-18.md)。
