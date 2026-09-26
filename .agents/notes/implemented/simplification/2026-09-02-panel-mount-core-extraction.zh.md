# Agent Note: ssh 与 task-board 共用一个中栏面板挂载核心

Status: implemented

## Problem

dsh-ssh 的 `src/client/mount.tsx` 与 dsh-task-board 的 `src/client/board-mount.tsx` 各自维护一整套中栏单占接管生命周期——向会话中栏注入容器、互斥驱逐、重挂载韧性、侧边栏点击退出——两份拷贝约 130 行中有约 100 行仅差七个参数（面板树、视图 dataset 键、语义插件名、CSS 类、两个 html 激活属性、事件 detail 名、控制器开/关方法）。重复不是假设成本：同一行为修复落地过两次，还是以独立 issue 与提交的形式——rc.6 centerCol 回退分为 #243（ssh，61153871f）与 #107（task-board，2ea4f965a）；互斥与侧边栏点击退出为 c0a98c715（双文件）；SDK locale 路由为 170b3df31（双文件）；L2 语义属性为 d73bffc2a（双文件）。侧边栏入口一对文件早已把共享逻辑收进 `shared/client/sidebar-entry-core.ts`（synced copy），挂载这一对却始终没做同样处理。

## Decision

接管生命周期现在只存在于 `shared/client/panel-mount-core.ts` 一处：`mountCenterPanel(options)` 拥有中栏选择器、MutationObserver 重挂载、驱逐加激活序列、侧边栏点击退出监听与 disposer 清理顺序；`CenterPanelMountOptions` 契约承载七个按插件变化的参数，外加控制器 subscribe 与可选 locale 源。该文件加入 sync-shared 清单，生成一份同步副本（`packages/dsh-ssh/src/client/panel-mount-core.ts`）——任务看板迁到原生布局座位后（见下）唯一的消费方；sync-shared 测试的副本计数桶为总数 98、client 38。dsh-ssh 的包装层只剩参数接线，公开导出不变（`mountPanel` + `PANEL_VIEW_SELECTOR`）。重建的聚合客户端 bundle（`packages/dsh-web-all/lib/client.js`）按源内联，行为一致。

容器属性名保持为包装层传入的参数：它们被该包 CSS（`panel.module.css` 互相引用兄弟面板的 html 属性）、wallpaper-exclusive 皮肤补丁与语义属性契约钉死，本次提取刻意一个都不改。

## 后续变更：任务看板离开接管，改用原生布局座位

任务看板不再消费本核心。它经官方 slots 系统贡献一个 `sidebar.panellist` 行与一个 keyed `main` 页面，并驱动 `ctx.layout.selectPanel`，因此中栏归 shell 所有，看板渲染在桌面版【插件】页所用的同一容器里；DOM 接管、自愈观察器与 `html[data-dsh-taskboard-active]` 可见性契约已从该包移除。见[任务看板原生面板接入](../../architecture/2026-09-25-task-board-native-panel-and-timer.zh.md)。

跨插件互斥**没有**随之消失：dsh-ssh 仍以 DOM 接管中栏，只要 `html[data-dsh-ssh-active]` 在，它的样式就隐藏中栏中其它所有子节点——包括看板页面。因此看板继续参与本文件定义的共享 `dsh-panel-activate` 协议（`PANEL_ACTIVATE_EVENT`，detail 为 `taskboard`/`ssh`），位置在 `packages/dsh-task-board/src/client/native-panel.tsx`：打开看板广播 `taskboard` 让 ssh 交出中栏，收到 `ssh` 广播则关闭看板。这是本核心与看板之间仅存的共享行为，也是事件名与 detail 取值仍属契约、而非 ssh 副本私有细节的原因。

## Testing

隔离 worktree 中两个包的测试套件零改动通过：dsh-ssh 20 文件 / 150 测试，dsh-task-board 33 文件 / 314 测试（+1 skip），其中 `mountPanel`（panel-shell，#506）与 `mountBoard`（board-view，#506/#1233）生命周期用例经提取后的核心驱动驱逐、重挂载与点击退出。工作区门禁全绿：`pnpm -r typecheck`（22 个工程）、全量 `pnpm -r test`、`node --test scripts/*.test.mjs` 238/238、`node scripts/sync-shared.mjs --check`、`node scripts/aggregate.mjs --check`、`verify-docs`、`i18n-audit --check`。

## Alternatives considered

- 保留重复，靠 review 保持两份同步：拒绝——上文四轮双落地历史说明 review 拦不住，下一个修复要么改两遍要么让两份漂移。
- 抽成被两个插件引用的运行时 npm 包：拒绝——按浏览器 bundle 纯度规则，客户端必须自包含；sync-shared 提交副本模式是仓库既有机制（settings 三件套与 sidebar-entry-core 同款）。
- 只参数化属性名、保留两份 `ensure`/observer 实现：拒绝——重挂载与互斥恰恰是被成对修复的那部分；半提取会让高风险的一半继续重复。

## Consequences

今后接管生命周期的行为修复只改 `shared/client/panel-mount-core.ts` 一处并跑一次 `node scripts/sync-shared.mjs`。第三个采用接管模式的面板新增一份生成副本加一个包装层即可，不再复制 100 行。原始提交行数略升（一份共享源加两份生成副本）——这是 sync-shared 模式的既定取舍：单一可编辑源，包自包含。行为、CSS 选择器、html 属性、事件名与语义属性契约全部不变；[重挂载韧性修复](../../bug-fix/2026-08-27-task-board-return-button-and-remount-resilience.zh.md) 现在由这一个核心承载。
