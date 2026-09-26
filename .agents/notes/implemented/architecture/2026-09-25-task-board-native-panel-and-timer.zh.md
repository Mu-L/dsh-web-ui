# Agent Note：任务看板改用原生布局面板并接入原生定时器

Status: implemented

## Problem

任务看板是家族里最后一个仍以 DOM 接管实现的功能面。`board-mount.tsx` 往中栏（`[class*='centerCol']`，回退 `[data-pane='conversation']`）里塞一个容器，用 `html[data-dsh-taskboard-active]` 规则把对话子树藏起来，再靠 `document.body` 的 MutationObserver 自愈；另有一份 `sidebar-entry-core.ts` 副本注入侧栏行并手绘它的盒子。shell 的每一处外壳细节都要自己复刻——行几何、56px 折叠栏、选中态、标签、语言切换刷新——每次 shell 重构都可能打断接管。桌面版自带的【插件】页完全不需要这些：它是一个官方面板。

另一方面，调度器按固定 30 秒心跳唤醒，因此 cron 分钟最多可能晚 30 秒触发，且每次唤醒无论是否有到期目标都要跑一遍。

## Decision

- **看板贡献 shell 自己的面板座位。** `src/client/native-panel.tsx` 注册一个 `sidebar.panellist` 行（list 座位：`id`/`order`/`label`）和一个 keyed `main` 页面（`key: TASK_BOARD_PANEL_ID`），两者都走 `ctx.slots.inject`——它只在宿主 shell 插件声明该座位之后才触发，因此看板、ui-layout 与 ui-sidebar 的加载顺序无关紧要，而无法提供该座位的 shell 只会让看板缺席，不会让启动失败。行只提供一个字形组件，并通过 `size` 采用 shell 要求的尺寸；按钮、标签、tooltip、选中态与折叠栏都归 shell。
- **面板选择归布局，控制器跟随它。** `BoardController` 新增可选的 `panel` 面；`openBoard()`/`closeBoard()` 先翻转快照再调 `ctx.layout.selectPanel`（`TASK_BOARD_PANEL_ID` / `null`），`syncPanelSelection` 把控制器之外产生的选择（点了别的行，或布局丢弃该面板 id）回灌进 `boardOpen`。该面可选，使控制器无需 shell 也可测；`selectPanel` 抛错（布局挂载前的既定行为）在状态翻转后被吞掉。
- **本包的 DOM 接管整体退役。** `board-mount.tsx`、`sidebar-entry.ts`、包内的 `panel-mount-core.ts`/`sidebar-entry-core.ts`/`body-mutations.ts` 副本，以及接管 CSS（`html[data-dsh-taskboard-active]` 可见性契约、`.entry` 行几何与折叠栏规则）全部移除。`[data-dsh-taskboard-view]` 保留在页面根上作为 L2 语义锚点，并改为声明 container query 上下文，因此看板的响应式规则仍然量测它所在的面板而不是视口。`sidebar-entry-core.ts`/`panel-mount-core.ts` 继续与 dsh-ssh（前者还有 skill-explorer）共享，各少一个消费方。
- **跨插件互斥被显式保留。** dsh-ssh 仍以 DOM 接管中栏，只要 `html[data-dsh-ssh-active]` 在，它的样式就会隐藏中栏里其它所有子节点——包括看板页面。因此看板参与共享的 `dsh-panel-activate` 协议：打开看板时广播 `taskboard`（让 ssh 交出中栏），收到 `ssh` 广播时关闭看板。事件与 detail 取值是 `shared/client/panel-mount-core.ts` 拥有的契约。
- **定时任务改走原生定时器服务。** 宿主经 `ctx.get('timer')` 解析框架的 `timer` 行（`resolveHostTimers`，容忍没有该服务的宿主），并作为 `HostTimerFace` 注入。30 秒调度心跳被替换为一次性定时器，按账本最近目标重新武装：`HostLedger.nextArmedRunAt(now)` 给出触发时刻，`armSchedule()` 收紧延时并在每次触发后重新武装。启动、恢复以及每个会写调度的动作（`set-schedule`/`delete`/`archive`）都会刷新武装；若某次触发的目标已过去超过 `RECOVERY_TOLERANCE_MS`（60 秒），走恢复路径（`skipMissed` 后重新武装），而不是重放错过的出现。5 秒的会话名册轮询是仅存的周期定时器。

## Testing

- `packages/dsh-task-board`：49 个文件 / 562 个测试（561 通过、1 跳过），与改动前基线同形。
- 原生面板：`board-view.spec.tsx` 改为渲染页面并断言 `data-dsh-taskboard-view`/`data-dsh-plugin` 锚点与 container query 上下文；`sidebar-entry-layout.spec.ts` 钉住座位名、字形契约、shell 拥有的标签，以及接管 CSS 已不存在；`client-apply-teardown.spec.ts` 断言两个注册都落在官方座位并随 fiber 释放（原地替换 bundle 后不留僵尸行）。
- 面板导航：`controller.spec.ts` 覆盖开/关的选择序列、重复打开的 no-op、布局面抛错，以及跟随外部切换且不回写。
- 互斥：`panel-coexistence.spec.ts` 覆盖 ssh 协议的两个方向、忽略外来/自身广播，以及已销毁 fiber 退出协议。
- 原生定时器：`host-service.spec.ts` 与 `handover-confirm.spec.ts` 驱动可控的 `HostTimerFace`，断言武装时刻、归档跳过、错过出现时的恢复路径、唯一周期定时器，以及 `start()` 幂等。
- 门禁：`pnpm typecheck`（全仓）、包测试、`sync-shared --check`、`inject-contract`、`aggregate --check` 通过；`@deepseek-ai/dsh-client-ui-layout` 进入 `APPROVED_INJECT_MODULES`（它是 ui-layout 行，拥有 `main` 座位与 `ctx.layout`），sync-shared 副本计数变为 98 总 / 38 client。

## Alternatives considered

- 保留 DOM 接管、只把它改得像官方面板：拒绝——接管正是逼出行几何、观察器与隐藏对话规则的根源；外观对齐了，机制及其失效模式仍在。
- 只注册 `main`、继续手注入侧栏行：拒绝——重复的 shell 外壳大多在行上（`.entry` 几何、折叠栏、选中属性），而手绘行放在官方 `sidebar.panellist` 行旁边会与之漂移。
- 让看板继续维护自己的 `html[data-dsh-taskboard-active]` 属性以兼容 ssh 既有判断：拒绝——那恰好保留了本次要移除的拦截，而且看板仍需那套驱动迁移的隐藏对话 CSS。
- 让看板一并迁到原生 `schedule` 服务/界面：拒绝——那个服务调度的是宿主侧 agent run，而不是绑定看板自身账本、权限确认门与 run group 的任务执行；看板采用需求点名的原生 **timer** 原语，同时保留自己的调度语义。
- 用更短的轮询间隔代替武装一次性定时器：拒绝——那是用「一直在唤醒」换「唤醒得不那么晚」，依然无法在目标时刻准确触发。

## Consequences

- 看板的行与页面都是 shell 自己的；未来 shell 改样式无需本包同步改动，折叠栏与选中态也免费获得。
- `[data-dsh-taskboard-entry]` 不再存在，`html[data-dsh-taskboard-active]` 不再控制可见性。dsh-skins 仓的语义属性契约与 wallpaper-exclusive 皮肤补丁引用了 `[data-dsh-taskboard-view]`（仍在）与 `[data-dsh-taskboard-entry]`／该选中属性（已消失）；那些文件归该仓所有，更新它们是跨仓后续项。dsh-ssh 的同步副本 `panel-mount-core.ts` 仍把 `data-dsh-taskboard-active` 作为 `siblingActiveAttribute`，现已失效——无害（该属性永不被设置），可在 ssh 自身迁到原生座位时一并清理。
- 看板需要布局在场才能渲染页面：没有 `ui-layout` 行的部署仍保留看板宿主/agent 能力，但没有可渲染它的面板。
- 计划任务在武装时刻触发，而不是最多晚 30 秒；睡过或恢复的宿主跳过错过的出现而非重放（语义未变，现由容忍窗口落实）。
