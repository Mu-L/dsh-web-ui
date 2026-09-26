/**
 * Native panel registration for the skill center.
 *
 * The panel is an official-style center-column page, not a DOM takeover: it
 * contributes a row into the sidebar shell's own global panel list
 * (`sidebar.panellist`) and its page into the layout's keyed `main` slot. The
 * shell then owns the row box, the label, the active highlight, the collapsed
 * rail and the panel switch, exactly as it does for the shipped Plugins and
 * Schedule pages and for the task board.
 *
 * Both registrations go through `ctx.slots.inject`, which fires only once the
 * owning shell entry has declared the seat: load order between this plugin and
 * ui-layout / ui-sidebar therefore does not matter, and neither does a shell
 * that cannot serve the seats (the callback simply never runs).
 *
 * @module @linxin666/dsh-skill-explorer/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { SkillApi } from './api.ts'
import { SKILL_EXPLORER_PANEL_ID, type PanelController } from './panel/controller.ts'
import { SkillPanel } from './panel/SkillPanel.tsx'
import { tt } from './panel-helpers.ts'
import css from './panel/panel.module.css'

/** The panel id shared by the sidebar row and the main-slot occupant. */
export { SKILL_EXPLORER_PANEL_ID }

/** Row order among the shell's global panel rows (Plugins 0, Schedule 10, board 20). */
const PANEL_ORDER = 30

/**
 * The sidebar row glyph the shell asks for at its own size and active state.
 * The shell owns the button, label, tooltip and rail geometry; this component
 * draws only the glyph, like every other panel row.
 * @param props - the shell's icon share: square edge and selection state.
 * @returns the decorative skill-center glyph.
 */
export function SkillExplorerPanelIcon({ size }: { size: number; active: boolean }): React.ReactElement {
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
      <path d="M8 3.2C6.6 2 4.5 2 3 2v10.5c1.5 0 3.6 0 5 1.3 1.4-1.3 3.5-1.3 5-1.3V2c-1.5 0-3.6 0-5 1.2z" />
      <path d="M8 3.2v10.6" />
    </svg>
  )
}

/**
 * The main-slot page. The layout mounts it only while this panel is selected,
 * so the conversation keeps the center column untouched the rest of the time;
 * the wrapper carries the pinned `data-dsh-skill-explorer-view` semantic
 * anchor (L2 contract, skins) the takeover container used to own.
 * @param props - the framework main-slot share plus this entry's injected face.
 * @returns the skill center page.
 */
export function SkillExplorerPanelPage({ controller, api }: { controller: PanelController; api: SkillApi }): React.ReactElement {
  return (
    <div className={css.view} data-dsh-skill-explorer-view="" data-dsh-plugin="skill-explorer">
      <SkillPanel controller={controller} api={api} />
    </div>
  )
}

/** The injected face both registrations receive. */
interface PanelFace {
  controller: PanelController
  api: SkillApi
}

/**
 * The family's single-occupant center-column protocol.
 *
 * dsh-ssh still takes the column over at the DOM level: while its
 * `html[data-dsh-ssh-active]` attribute is set, its stylesheet hides every
 * other child of the center column, this page included, and the layout cannot
 * deselect our panel for it (ssh is not a layout panel). Until ssh moves to
 * the native seats as well, the two have to hand the column to each other
 * explicitly. The event and the detail values are the shared contract owned by
 * `shared/client/panel-mount-core.ts`.
 */
const PANEL_ACTIVATE_EVENT = 'dsh-panel-activate'

/** This panel's name in the family protocol. */
const PANEL_NAME = 'skill-explorer'

/**
 * The family panels whose activation closes this panel: exactly the rows that
 * still mount through the DOM takeover. Empty once every family panel is
 * native, at which point this whole protocol goes away (the layout alone
 * decides which main page renders).
 */
const TAKEOVER_PANEL_NAMES: readonly string[] = ['ssh']

/**
 * Keep this panel mutually exclusive with the DOM-takeover family panels.
 * @param controller - the controller whose open state drives the protocol.
 * @returns disposer removing the listener and the subscription.
 */
export function coordinateWithTakeoverPanels(controller: PanelController): () => void {
  let open = controller.getSnapshot().panelOpen
  const onActivate = (event: Event): void => {
    if (!TAKEOVER_PANEL_NAMES.includes((event as CustomEvent).detail as string)) return
    if (controller.getSnapshot().panelOpen) controller.close()
  }
  const unsubscribe = controller.subscribe(() => {
    const next = controller.getSnapshot().panelOpen
    if (next === open) return
    open = next
    // Only the open transition evicts a takeover panel; closing already returns
    // the column to the conversation, which needs no announcement.
    if (next) document.dispatchEvent(new CustomEvent(PANEL_ACTIVATE_EVENT, { detail: PANEL_NAME }))
  })
  document.addEventListener(PANEL_ACTIVATE_EVENT, onActivate)
  return () => {
    document.removeEventListener(PANEL_ACTIVATE_EVENT, onActivate)
    unsubscribe()
  }
}

/**
 * Register the skill center's sidebar row and center-column page.
 *
 * Both seats are declared by shell plugins this package does not depend on at
 * runtime, so each registration is wrapped in `ctx.slots.inject`: the callback
 * runs only after the owning entry declares the seat, and a shell that never
 * declares it leaves the panel simply absent instead of failing boot.
 * @param ctx - client root context (services: slots).
 * @param controller - the controller the page and the row drive.
 * @param api - the skill center API client the page operates through.
 * @returns disposer releasing both registrations.
 */
export function registerSkillExplorerPanel(ctx: ClientContext, controller: PanelController, api: SkillApi): () => void {
  const releaseCoordination = coordinateWithTakeoverPanels(controller)
  const slots = ctx.slots as {
    inject(key: string, callback: () => () => void): () => void
    register(options: Record<string, unknown>, component: unknown): () => void
  }
  const disposers: Array<() => void> = []

  disposers.push(slots.inject('sidebar.panellist', () => slots.register({
    name: 'sidebar.panellist',
    id: SKILL_EXPLORER_PANEL_ID,
    order: PANEL_ORDER,
    // The shell resolves this through resolveSlotLabel on every locale change,
    // so the module-level translate reads the active language at call time.
    label: () => tt('entry.label'),
  }, SkillExplorerPanelIcon)))

  disposers.push(slots.inject('main', () => slots.register({
    name: 'main',
    key: SKILL_EXPLORER_PANEL_ID,
    inject: (): PanelFace => ({ controller, api }),
  }, SkillExplorerPanelPage as never)))

  return () => {
    releaseCoordination()
    for (const dispose of disposers.splice(0)) dispose()
  }
}
