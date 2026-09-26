// @vitest-environment jsdom
/**
 * Board/ssh center-column coexistence.
 *
 * The board contributes its page through the layout's keyed main seat, but
 * dsh-ssh still takes the center column over at the DOM level: while its
 * html[data-dsh-ssh-active] attribute is set, its stylesheet hides every other
 * child of the column, this board's page included. The two plugins share one
 * column, so the board participates in the family's activation protocol
 * (dsh-panel-activate, owned by shared/client/panel-mount-core.ts and
 * dispatched by ssh's synced copy):
 *
 * - the board opening tells ssh to let go of the column;
 * - ssh opening tells the board to hand the column back to the conversation.
 *
 * A regression here is silent and severe: the sidebar row looks active while
 * ssh's opaque overlay keeps the board painted underneath it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { coordinateWithSshPanel } from '../src/client/native-panel.tsx'
import type { BoardController, ControllerSnapshot } from '../src/core/controller.ts'

/** The family protocol event and detail values ssh's copy uses. */
const ACTIVATE_EVENT = 'dsh-panel-activate'
const BOARD_PANEL_NAME = 'taskboard'
const SSH_PANEL_NAME = 'ssh'

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

describe('board and ssh panel coexistence', () => {
  it('operator opening the board sees ssh release the column', () => {
    // Given a board and an ssh panel sharing the column
    const { controller, setOpen } = fakeController(false)
    const dispose = coordinateWithSshPanel(controller)
    document.addEventListener(ACTIVATE_EVENT, record)

    // When the board opens
    setOpen(true)
    controller.openBoard()

    // Then ssh is told to let go of the column, so its takeover stylesheet
    // stops covering the board's page
    expect(announcements).toEqual([BOARD_PANEL_NAME])

    dispose()
  })

  it('operator opening ssh sees the board hand the column back', () => {
    // Given an open board
    const { controller, closes } = fakeController(true)
    const dispose = coordinateWithSshPanel(controller)

    // When ssh announces that it took the column
    document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: SSH_PANEL_NAME }))

    // Then the board closes, returning the column to the conversation
    expect(closes).toHaveLength(1)

    dispose()
  })

  it('operator stays on the board when other panels announce', () => {
    // Given an open board
    const { controller, closes } = fakeController(true)
    const dispose = coordinateWithSshPanel(controller)

    // When a foreign panel announces, or the board's own announcement echoes
    document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: 'plugins' }))
    document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: BOARD_PANEL_NAME }))

    // Then the board stays open
    expect(closes).toHaveLength(0)

    dispose()
  })

  it('operator sees a disposed board leave the activation protocol', () => {
    // Given a board whose fiber was unloaded
    const { controller, closes } = fakeController(true)
    const dispose = coordinateWithSshPanel(controller)
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
