/**
 * Host half of the dsh-plugin-manager plugin — runs in the DSH host process.
 *
 * Dual-channel design: on runtimes with the official installer services
 * (DSHCode and the 1.0.4 checkout web), the browser half uses the official
 * `/plugin-installer` and `/plugin-control` RPC channels and this half does
 * nothing. On the npm-published web runtime (rc.6/rc.7), those channels do
 * not exist, so this half mounts a loopback-fenced HTTP gateway: the
 * inventory reads the profile files, installs and removals spawn the
 * official CLI (the single writer), and enablement writes bare `disabled`
 * override rows into the profile patch.
 * @module @linxin666/dsh-client-ui-plugin-manager
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { mountOnce } from './mount-once.ts'
import { findDshBinary, CliGateway } from './host/gateway.ts'
import { profileExists, resolveProfile, type LaunchedProfile } from './host/profile.ts'
import { makeGatewayRoutes } from './host/routes.ts'

/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
export const name = 'ui-plugin-manager'

/** Services the gateway needs — the web server seam. */
export const inject = ['webServer']

/** Apply the host half (once per process). */
export const apply = mountOnce('@linxin666/dsh-client-ui-plugin-manager', applyImpl)

/**
 * The launched profile the official runtime publishes on the host context
 * (`profileContext`, `{ name, dir, patchPath, ... }`). The packaged Desktop
 * launcher boots "desktop" through `runProfile()` with neither a `--profile`
 * flag nor a DSH_PROFILE variable, so this service is the only launcher fact
 * that names the running profile there; a CLI-booted host keeps resolving from
 * argv and the environment exactly as before. It is an OPTIONAL read, not an
 * injected dependency: hosts without the service simply fall through.
 * @param ctx - host plugin context.
 * @returns the published facts, or undefined when the host publishes none.
 */
function launchedProfile(ctx: Context): LaunchedProfile | undefined {
  const facts = ctx.get('profileContext') as LaunchedProfile | undefined
  return facts === undefined || facts === null ? undefined : facts
}

function applyImpl(ctx: Context): void {
  // Gateway mode needs the boot profile; the launched profile the Host
  // publishes is authoritative when the launcher passed no flag and no
  // environment override (the packaged Desktop client). Without either fact
  // the official installer channels serve the browser half instead.
  let facts
  try {
    facts = resolveProfile(process.argv, process.env, launchedProfile(ctx))
  } catch (error) {
    console.error('[plugin-manager]', error instanceof Error ? error.message : String(error))
    return
  }
  if (!profileExists(facts.profileDir)) return

  const gateway = new CliGateway(facts)
  const cliAvailable = (): boolean => findDshBinary() !== null

  ctx.effect(() => {
    const disposers = makeGatewayRoutes({ facts, gateway, cliAvailable })
      .map(route => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'plugin-manager: gateway routes')
}
