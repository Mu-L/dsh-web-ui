/**
 * Native panel registration for the task board.
 *
 * The board is an official-style center-column panel, not a DOM takeover: it
 * contributes a row into the sidebar shell's own global panel list
 * (`sidebar.panellist`) and its page into the layout's keyed `main` slot. The
 * shell then owns the row box, the label, the active highlight, the collapsed
 * rail, the panel switch and the window-chrome interplay exactly as it does for
 * the shipped Plugins and Schedule pages, so the board renders through the same
 * container the desktop application's Plugins page uses.
 *
 * Both registrations go through `ctx.slots.inject`, which fires only once the
 * owning shell entry has declared the seat: load order between this plugin and
 * ui-layout / ui-sidebar therefore does not matter, and neither does a shell
 * that cannot serve the seats (the callback simply never runs).
 *
 * @module @linxin666/dsh-client-ui-task-board/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { TASK_BOARD_PANEL_ID, type BoardController } from '../core/controller.ts'
import { TaskBoard } from './board/TaskBoard.tsx'
import { t } from './locales.ts'
import css from './board.module.css'

/** The panel id shared by the sidebar row and the main-slot occupant. */
export { TASK_BOARD_PANEL_ID }

/** Row order among the shell's global panel rows (Plugins is 0, Schedule 10). */
const PANEL_ORDER = 20

/**
 * The sidebar row glyph the shell asks for at its own size and active state.
 * The shell owns the button, label, tooltip and rail geometry; this component
 * draws only the glyph, like every other panel row.
 * @param props - the shell's icon share: square edge and selection state.
 * @returns the decorative board glyph.
 */
export function TaskBoardPanelIcon({ size }: { size: number; active: boolean }): React.ReactElement {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <path d="M2 6.5h12M6.5 6.5v7" />
    </svg>
  )
}

/**
 * The main-slot page. The layout mounts it only while the board is the selected
 * panel, so the conversation keeps the center column untouched the rest of the
 * time; the wrapper carries the pinned `data-dsh-taskboard-view` semantic
 * anchor (L2 contract, skins) and the container query context the board's
 * responsive rules read.
 * @param props - the framework main-slot share plus this entry's injected face.
 * @returns the board page.
 */
export function TaskBoardPanel({ controller }: { controller: BoardController }): React.ReactElement {
  return (
    <div className={css.panel} data-dsh-taskboard-view="" data-dsh-plugin="task-board">
      <TaskBoard controller={controller} />
    </div>
  )
}

/** The injected face both registrations receive. */
interface PanelFace {
  controller: BoardController
}

/**
 * The family's single-occupant center-column protocol.
 *
 * The board is the one family member that no longer takes the column over at
 * the DOM level, but dsh-ssh and the skill center still do: while either
 * panel's `html[data-dsh-*-active]` attribute is set, its stylesheet hides
 * every other child of the center column, including this board's page. The
 * layout knows nothing about those two (they are not layout panels), so it
 * cannot deselect the board for us; the board has to hand the column back
 * explicitly. The event and the detail values are the shared contract owned by
 * `shared/client/panel-mount-core.ts`, so the board participates in it rather
 * than inventing a second mechanism.
 */
const PANEL_ACTIVATE_EVENT = 'dsh-panel-activate'

/** This panel's name in the family protocol. */
const PANEL_NAME = 'taskboard'

/**
 * The family panels whose activation closes the board, because each one takes
 * the column over at the DOM level and would otherwise hide this board's page
 * while its sidebar row still looks selected. These are exactly the
 * DOM-takeover rows of `PANEL_FAMILY` in `shared/client/panel-mount-core.ts`;
 * that table is the single source of occupancy truth for panels that mount
 * through the core, and the board cannot import it (browser bundles may not
 * value-import across plugins, and the board ships no copy of the core since
 * it left the takeover). Keep this list in step when a family panel joins or
 * leaves the DOM takeover.
 */
const TAKEOVER_PANEL_NAMES: readonly string[] = ['ssh', 'skill-explorer']

/**
 * Keep the board mutually exclusive with the DOM-takeover family panels.
 *
 * The board contributes the column through the layout, so selecting it makes
 * the shell render its page; a takeover panel needs to be told to let go, or
 * its stylesheet keeps covering the page. The reverse direction is the same:
 * ssh or the skill center taking the column asks the board to hand it back to
 * the conversation, which is what the layout renders underneath them.
 * @param controller - the board controller whose open state drives the protocol.
 * @returns disposer removing the listener and the subscription.
 */
export function coordinateWithFamilyPanels(controller: BoardController): () => void {
  let open = controller.getSnapshot().boardOpen
  const onActivate = (event: Event): void => {
    if (!TAKEOVER_PANEL_NAMES.includes((event as CustomEvent).detail as string)) return
    if (controller.getSnapshot().boardOpen) controller.closeBoard()
  }
  const unsubscribe = controller.subscribe(() => {
    const next = controller.getSnapshot().boardOpen
    if (next === open) return
    open = next
    // Only the open transition evicts the family; closing already means the
    // column returns to the conversation, which needs no announcement.
    if (next) document.dispatchEvent(new CustomEvent(PANEL_ACTIVATE_EVENT, { detail: PANEL_NAME }))
  })
  document.addEventListener(PANEL_ACTIVATE_EVENT, onActivate)
  return () => {
    document.removeEventListener(PANEL_ACTIVATE_EVENT, onActivate)
    unsubscribe()
  }
}

/**
 * Register the board's sidebar row and center-column page.
 *
 * Both seats are declared by shell plugins this package does not depend on at
 * runtime, so each registration is wrapped in `ctx.slots.inject`: the callback
 * runs only after the owning entry declares the seat, and a shell that never
 * declares it leaves the board simply absent instead of failing boot.
 * @param ctx - client root context (services: slots).
 * @param controller - the board controller the page and the row drive.
 * @returns disposer releasing both registrations.
 */
export function registerTaskBoardPanel(ctx: ClientContext, controller: BoardController): () => void {
  // The DOM-takeover family panels and this layout panel share one column;
  // the protocol keeps them mutually exclusive in both directions.
  const releaseCoordination = coordinateWithFamilyPanels(controller)
  const slots = ctx.slots as {
    inject(key: string, callback: () => () => void): () => void
    register(options: Record<string, unknown>, component: unknown): () => void
  }
  const disposers: Array<() => void> = []

  disposers.push(slots.inject('sidebar.panellist', () => slots.register({
    name: 'sidebar.panellist',
    id: TASK_BOARD_PANEL_ID,
    order: PANEL_ORDER,
    // The shell resolves this through resolveSlotLabel on every locale change,
    // so the module-level translate reads the active language at call time.
    label: () => t('entry.label'),
  }, TaskBoardPanelIcon)))

  disposers.push(slots.inject('main', () => slots.register({
    name: 'main',
    key: TASK_BOARD_PANEL_ID,
    inject: (): PanelFace => ({ controller }),
  }, TaskBoardPanel as never)))

  return () => {
    releaseCoordination()
    for (const dispose of disposers.splice(0)) dispose()
  }
}
