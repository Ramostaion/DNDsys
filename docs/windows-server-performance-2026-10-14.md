# Windows Server 正式运行与 5600G / 32GB 参数调整

> 后续用户澄清：右侧骰子投掷者信息现仅显示账号名称，不显示唯一 ID。详见修改总记录 CHG-378；以下保留本轮部署调整与测试原记录。

日期：2026-10-14。替代现有 Docker/群晖部署方式，保留原数据库、游戏数据、操作协议与 Socket.IO。

## 实际改动

1. 右侧最近掷骰提示的投掷者信息仅显示账号唯一 ID，原因/表达式与结果保留；较长 ID 悬停可查看完整内容。
2. 删除 compose.yaml、compose.nas.yaml、compose.env.example、.dockerignore、API/Web Dockerfile、docker-entrypoint.sh、nginx.conf、NAS 部署说明及 .launcher 下三个旧部署准备文件；从 API 发布清单移除容器入口。更新当前 README、架构、启动/玩法和功能使用说明。历史任务书及原实施证据保留，并注明被替代。
3. BAT 默认正式运行：先准备环境、原数据库及迁移，构建编译后的前后端，然后一个 Node 进程在 WEB_PORT（默认 5242）提供网页、API、Socket.IO。当前 .env 的数据库地址、JWT 与 WEB_ORIGIN 不改写。-Development 保留原 API 3001 + Vite 5242。
4. 启动器对源码/配置/运行环境和构建文件做检查，源码未变化且构建完整时不重复构建；复制路径变化、源文件新增/修改、输出缺失或改变时重建。依赖检查只把依赖/锁文件/环境变化作为修复依据，修改普通包脚本不会要求重装全部依赖。
5. 正式应用使用默认 4096MB 堆上限、8 个异步线程；图片每任务 2 线程、128MB缓存，均可配置。没有将所有 32GB 预分配，也没有引入多进程房间调度或额外基础设施。构建/依赖准备阶段使用开发依赖，正式子进程切换 production。
6. 构建时为网页资源生成 Brotli/gzip；正式服务按浏览器支持选择压缩文件。哈希资源一年缓存，HTML 必须重新校验，API/私密附件保持原路由与权限。HTTP 保活 65 秒，并在实际停止时等待请求完成、释放空闲连接。
7. 正式运行测试改名为 windows-server-runtime；联机用例共享可设置的 API 地址，可对单端口正式服务运行，不需要启动另一套业务服务器。

## 维护入口和文件

| 模块 | 文件 |
| --- | --- |
| 骰子提示 | apps/web/src/ui/room/PartyPanel.tsx、style.css、原定向联机用例 |
| 静态网页与缓存 | apps/api/src/web-static.ts / web-static.test.ts、app.ts |
| 图片参数与启动 | config.ts / config.test.ts、bootstrap.ts、storage.ts |
| 一键启动及构建缓存 | scripts/start-dnd.ps1、launcher-config.mjs、launcher-dependencies.mjs、launcher-build.mjs / launcher-build.test.mjs、launcher-portability.test.mjs |
| 网页预压缩 | scripts/prepare-web-assets.mjs、根 package.json |
| 环境与发布 | apps/api/.env.example、apps/api/package.json |
| 测试服务器选择 | playwright.config.ts、apps/api/e2e/server-address.ts、原使用固定 API 地址的联机用例 |
| 正式运行验证 | apps/api/e2e/windows-server-runtime.spec.ts（由原 nas-runtime 重命名） |
| 部署/玩法/架构 | README、ARCHITECTURE、启动顺序与玩法说明、Windows Server 与功能使用文档、修改总记录 |

当前测试数据库仍为项目 .local-database，图片仍为 apps/api/uploads，没有迁移至其他数据库或清空数据。

## 实际验证

- **122/122 单元**：共享 48、API 31、前端 43。新静态服务真实 HTTP 验证 Brotli/gzip、拒绝编码时回退、缓存、深层 SPA 路由、HTML 更新与 API/私密上传路由不被兜底覆盖。停止时先完成已收到请求再断库。
- **20/20 启动器测试**：默认正式/开发端口、硬件参数验证、原数据库/复制兼容及构建缓存的源码新增、修改、缺失输出失效。
- 全项目类型、生产构建及 Brotli/gzip 生成、代码/格式检查通过；Windows PowerShell 启动脚本语法解析无错误。在 NODE_ENV=production 的外部环境下执行 BAT 检查模式通过。
- 实际运行更新后的启动器：首次构建后，5242 网页与 API 就绪，准备原 25 个角色；停止测试启动器后 5242/数据库端口释放，再次启动自动恢复同一本地库，日志确认“源码未变化，直接复用正式构建”。
- 停止/重新启动前后 **30 张表计数一致**，原角色 25。计数相同不等于逐字段比对全部数据；没有运行 seed/reset 或改写原 .env。只停止本轮自己创建的测试进程，测试结束端口已释放。
- 独立编译后的正式进程 **1/1（4.2 秒）**：无 Vite，正式登录页/压缩缓存资源、真实页面/Socket 登录连接、角色/特性/图片、API 进程重启后原 Cookie 与数据读取通过。
- 右侧 ID/布局回归 **1/1（7.7 秒）**：三账号 ID 同步、GM/玩家位置、点击骰窗、私密隔离、窄视窗与刷新恢复。
- 运行中的单端口正式服务上，八账号、v3.0 字段/公式/装备/状态/人工战斗/骰子、剧情放映、标签 A–E、私密线索 A–E/离线/恢复 **12/12（2.0 分钟）**。这是另一个独立轮次，不与上面两项合称一次 14/14。
- 本机八账号场景：8 份快照共 430ms，响应 5663–8113 字节；1920×1080 图片八端加载 402ms，屏幕图片 1,225,762 字节。没有同硬件/同数据前后对照，不能据此声称目标服务器加速比例。
- 构建出的 7 份 JS/CSS 共 1,046,332 字节，Brotli 301,198 字节、gzip 320,632 字节；Brotli 文件体积减少约 71%。这是文件体积对比，不是公网延迟或帧率测试。
- 本轮开始时本地数据库失联且旧服务已退出，首次正式浏览器尝试等待服务超时；重新启动本轮测试服务后验证成功，数据库失联根因未确认。保活调整首次造成停止测试超时，初次修复又使停止健康请求连接被重置；改为仅实际关闭监听后释放空闲连接，最终 122 项通过。失败轮次未计为通过。

## 未验证

实际远程 Windows Server / 5600G 的 CPU、峰值内存、公网延迟、多日稳定性、新机器离线安装和完整项目复制未实测。没有跑全部浏览器套件；操作系统重启、断电恢复、其他浏览器和 Windows 服务/开机自启未实现。当前仍使用原 PGlite/Prisma Dev 保存测试数据；该数据库本轮仅验证正常启动、关窗重启及已有数据恢复，不把它描述为新部署的独立 PostgreSQL。

## 如何使用

更新服务器项目源码，保留服务器的 apps/api/.env、完整 .local-database 和图片目录；停止旧启动窗口，再双击启动跑团.bat。对外转发继续指向内部 5242，WEB_ORIGIN 使用朋友实际访问的地址。当前完整步骤见 [Windows Server 部署说明](windows-server-deployment.md)。
