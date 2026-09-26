// @vitest-environment jsdom
/**
 * Board / DOM-takeover family coexistence.
 *
 * The board contributes its page through the layout's keyed main seat, but the
 * DOM-takeover family panels (dsh-ssh and the skill center) still take the
 * center column over at the DOM level: while either one's
 * html[data-dsh-*-active] attribute is set, its stylesheet hides every other
 * child of the column, this board's page included. Those panels are not layout
 * panels, so the layout cannot deselect the board for us; the board has to
 * hand the column back itself. It therefore participates in the family's
 * activation protocol (dsh-panel-activate, owned by
 * shared/client/panel-mount-core.ts and dispatched by each takeover panel):
 *
 * - the board opening tells a takeover panel to let go of the column;
 * - a takeover panel opening tells the board to hand the column back.
 *
 * A regression here is silent and severe: the sidebar row looks active while
 * the other panel's opaque overlay keeps the board painted underneath it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { coordinateWithFamilyPanels } from '../src/client/native-panel.tsx'
import type { BoardController, ControllerSnapshot } from '../src/core/controller.ts'

/** The family protocol event and detail values the takeover copies use. */
const ACTIVATE_EVENT = 'dsh-panel-activate'
const BOARD_PANEL_NAME = 'taskboard'
const SSH_PANEL_NAME = 'ssh'
const SKILL_EXPLORER_PANEL_NAME = 'skill-explorer'

/** A controller with observable open state, recording every close request. */
function fakeController(open: boolean) {
  let boardOpen = open
  const listeners = new Set<() => void>()
  const closes: number[] = []
  const controller = {
    getSnapshot: (): Partial<ControllerSnapshot> => ({ boardOpen }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    closeBoard: () => {
      closes.push(1)
      boardOpen = false
      for (const listener of [...listeners]) listener()
    },
    openBoard: () => {
      boardOpen = true
      for (const listener of [...listeners]) listener()
    },
  }
  return { controller: controller as unknown as BoardController, closes, setOpen: (next: boolean) => { boardOpen = next } }
}

/** Every activation announcement dispatched during one case. */
let announcements: string[] = []
const record = (event: Event): void => { announcements.push((event as CustomEvent).detail as string) }

beforeEach(() => { announcements = [] })
afterEach(() => { document.removeEventListener(ACTIVATE_EVENT, record) })

describe('board and DOM-takeover family coexistence', () => {
  it('operator opening the board sees the takeover panels release the column', () => {
    // Given a board and the DOM-takeover family panels sharing the column
    const { controller, setOpen } = fakeController(false)
    const dispose = coordinateWithFamilyPanels(controller)
    document.addEventListener(ACTIVATE_EVENT, record)

    // When the board opens
    setOpen(true)
    controller.openBoard()

    // Then the takeover panels are told to let go of the column, so their
    // takeover stylesheets stop covering the board's page
    expect(announcements).toEqual([BOARD_PANEL_NAME])

    dispose()
  })

  it('operator opening ssh sees the board hand the column back', () => {
    // Given an open board
    const { controller, closes } = fakeController(true)
    const dispose = coordinateWithFamilyPanels(controller)

    // When ssh announces that it took the column
    document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: SSH_PANEL_NAME }))

    // Then the board closes, returning the column to the conversation
    expect(closes).toHaveLength(1)

    dispose()
  })

  it('operator opening the skill center sees the board hand the column back', () => {
    // Given an open board and the skill center, the third family panel: it too
    // takes the column over, and the layout cannot deselect the board for it
    const { controller, closes } = fakeController(true)
    const dispose = coordinateWithFamilyPanels(controller)

    // When the skill center announces that it took the column
    document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: SKILL_EXPLORER_PANEL_NAME }))

    // Then the board closes, so the two never paint over each other
    expect(closes).toHaveLength(1)

    dispose()
  })

  it('operator stays on the board when non-takeover panels announce', () => {
    // Given an open board
    const { controller, closes } = fakeController(true)
    const dispose = coordinateWithFamilyPanels(controller)

    // When a panel that does not take the column over announces (the layout
    // renders it beside the board, so the board must stay open), or the
    // board's own announcement echoes
    document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: 'plugins' }))
    document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: BOARD_PANEL_NAME }))

    // Then the board stays open
    expect(closes).toHaveLength(0)

    dispose()
  })

  it('operator sees a disposed board leave the activation protocol', () => {
    // Given a board whose fiber was unloaded
    const { controller, closes } = fakeController(true)
    const dispose = coordinateWithFamilyPanels(controller)
    dispose()

    // When ssh opens afterwards
    document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: SSH_PANEL_NAME }))

    // Then the dead instance does not react, and it announces nothing either
    expect(closes).toHaveLength(0)
    document.addEventListener(ACTIVATE_EVENT, record)
    controller.openBoard()
    expect(announcements).toEqual([])
  })
})
