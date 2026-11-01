/**
 * End-to-end engine check, no Electron: register -> scan -> connect through a
 * real mihomo child process -> probe the exit IP -> disconnect.
 *
 * Usage:
 *   npx tsx scripts/engine-test.ts            # awg only
 *   npx tsx scripts/engine-test.ts awg wg     # several protocols in a row
 *   XEHN_TEST_HOME=/tmp/xehn-test npx tsx scripts/engine-test.ts masque
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Engine } from '../src/main/engine/engine'
import type { Proto, Status } from '../src/shared/types'

const VALID: Proto[] = ['awg', 'wg', 'masque', 'masque-h2']
const argvProtos = process.argv.slice(2).filter((a): a is Proto => VALID.includes(a as Proto))
const protos: Proto[] = argvProtos.length ? argvProtos : ['awg']

const explicitHome = process.env.XEHN_TEST_HOME
const MIXED_PORT = 17890
const API_PORT = 19090

function marker(ok: boolean, text: string): string {
  return `${ok ? 'PASS' : 'FAIL'}  ${text}`
}

async function waitForExit(engine: Engine, timeoutMs: number): Promise<Status> {
  const until = Date.now() + timeoutMs
  let last: Status = engine.getStatus()
  while (Date.now() < until) {
    last = engine.getStatus()
    if (last.exitIp) return last
    if (last.state === 'error') return last
    await new Promise((r) => setTimeout(r, 500))
  }
  return last
}

async function runProto(engine: Engine, proto: Proto): Promise<'pass' | 'fail' | 'skip'> {
  console.log(`\n=== ${proto.toUpperCase()} ===`)
  await engine.updateSettings({
    proto,
    systemProxy: false,
    tun: false,
    autoScan: false,
    autoConnect: false,
    mode: 'rule',
    mixedPort: MIXED_PORT,
    apiPort: API_PORT,
    ...(process.env.XEHN_TEST_SUB ? { subscriptionUrls: process.env.XEHN_TEST_SUB } : {}),
    ...(process.env.XEHN_TEST_REGIONS ? { preferredRegions: process.env.XEHN_TEST_REGIONS } : {})
  })

  const started = Date.now()
  const scanned = await engine.scan(false)
  const ok = scanned.nodes.filter((n) => n.ok)
  if (!ok.length) {
    // Some networks reset TLS/QUIC to whole endpoint ranges; that is a network
    // property, not an engine failure. Only masque-h2 is exempt - the others
    // have worked from every network tested so far.
    const verdict = proto === 'masque-h2' ? 'SKIP' : 'FAIL'
    console.log(marker(false, `${verdict}: scan 0/${scanned.nodes.length} reachable in ${Date.now() - started}ms`))
    return proto === 'masque-h2' ? 'skip' : 'fail'
  }
  console.log(marker(true, `scan ${ok.length}/${scanned.nodes.length} ok in ${Date.now() - started}ms`))
  const s = scanned.sources
  console.log(
    `       sources builtin=${s.builtin} subscription=${s.subscription} random=${s.random} failed=${s.subscriptionErrors}`
  )
  for (const n of ok.slice(0, 5)) {
    const geo = n.geo
    console.log(
      `       ${n.endpoint}  ${n.delayMs}ms  loss=${n.lossPct ?? 0}%  score=${n.score ?? 0}  ${n.source ?? '-'}${
        geo ? `  ${geo.country}${geo.city ? `/${geo.city}` : ''} AS${geo.asn}` : '  (no geo)'
      }`
    )
  }

  const best = ok[0]
  const connectAt = Date.now()
  await engine.connect(best.endpoint)
  const connected = engine.getStatus()
  console.log(
    marker(connected.state === 'connected', `connect ${best.endpoint} in ${Date.now() - connectAt}ms (core ${connected.coreVersion})`)
  )
  if (connected.state !== 'connected') {
    console.log(`       error: ${connected.error}`)
    return 'fail'
  }

  const probed = await waitForExit(engine, 60000)
  console.log(
    marker(Boolean(probed.exitIp), `exit ${probed.exitIp || '(none)'} ${probed.colo || ''} ${probed.country || ''} latency=${probed.latencyMs}ms`)
  )

  if (process.env.XEHN_TEST_DIAG === '1') {
    const conns = await engine.getConnections()
    console.log(marker(true, `connections ${conns.length}${conns[0] ? ` top=${conns[0].host}` : ''}`))

    try {
      const quality = await engine.qualityTest((p) => {
        if (p.done === p.total) console.log(`  quality ${p.done}/${p.total}`)
      })
      console.log(
        marker(
          quality.received > 0,
          `quality loss=${quality.lossPct}% avg=${quality.avgMs}ms min=${quality.minMs} max=${quality.maxMs}`
        )
      )
    } catch (err) {
      console.log(marker(false, `quality: ${(err as Error).message}`))
    }

    try {
      const speed = await engine.speedTest((p) => {
        if (p.progress >= 1) console.log(`  speed ${p.phase} ${p.mbps} Mbps`)
      })
      console.log(
        marker(
          speed.downMbps > 0,
          `speed down=${speed.downMbps}Mbps up=${speed.upMbps}Mbps bytes=${speed.downBytes}/${speed.upBytes}`
        )
      )
    } catch (err) {
      console.log(marker(false, `speed: ${(err as Error).message}`))
    }

    const report = await engine.exportDiagnostics()
    console.log(marker(true, `export ${report}`))
  }

  await engine.disconnect()
  const off = engine.getStatus()
  console.log(marker(off.state === 'disconnected', `disconnect -> ${off.state}`))
  return probed.exitIp ? 'pass' : 'fail'
}

async function main(): Promise<void> {
  const home = explicitHome ? resolve(explicitHome) : await mkdtemp(join(tmpdir(), 'xehn-desktop-'))
  console.log(`home: ${home}`)
  console.log(`core: ${resolve('resources/core/mihomo.exe')}`)

  const engine = new Engine({
    home,
    coreCandidates: [resolve('resources/core/mihomo.exe')],
    version: 'test',
    hooks: {
      onStatus: () => undefined,
      onLog: (line) => {
        if (line.level === 'error') console.log(`  [${line.level}] ${line.text}`)
        else if (line.level === 'warn') console.log(`  [warn] ${line.text}`)
      },
      onScanProgress: (p) => {
        if (p.done === p.total) console.log(`  scan progress ${p.done}/${p.total}`)
      }
    }
  })

  await engine.init()
  const core = engine.getCoreInfo()
  console.log(marker(core.available, `core ${core.version || '(unknown)'} at ${core.path}`))
  if (!core.available) {
    await engine.shutdown()
    process.exitCode = 1
    return
  }

  const outcomes: { proto: Proto; ok: 'pass' | 'fail' | 'skip' }[] = []
  try {
    for (const proto of protos) {
      try {
        outcomes.push({ proto, ok: await runProto(engine, proto) })
      } catch (err) {
        console.log(marker(false, `${proto}: ${(err as Error).message}`))
        outcomes.push({ proto, ok: 'fail' })
        await engine.disconnect({ silent: true }).catch(() => undefined)
      }
    }
  } finally {
    await engine.shutdown()
    if (!explicitHome) await rm(home, { recursive: true, force: true }).catch(() => undefined)
  }

  console.log('\n=== summary ===')
  for (const o of outcomes) console.log(`${o.ok.toUpperCase()}  ${o.proto}`)
  process.exitCode = outcomes.every((o) => o.ok !== 'fail') ? 0 : 1
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
