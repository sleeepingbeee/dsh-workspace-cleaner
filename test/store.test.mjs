/**
 * Sandbox tests for the pure store layer.
 *
 * Every test runs against a throwaway directory created with `mkdtemp`; the
 * real DSH home is never read or written here.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import * as store from '../lib/store.js'

const LOG = 'session.v4.jsonl.zstd'

/** Create one sandboxed DSH home with two workspaces, four conversations. */
async function createSandbox() {
  const home = await mkdtemp(join(tmpdir(), 'wscl-store-'))
  const projectA = join(home, 'sessions', '--D-sandbox-A--')
  const projectB = join(home, 'sessions', '--D-sandbox-B--')
  await mkdir(join(projectA, 'session-aaa'), { recursive: true })
  await mkdir(join(projectA, 'session-bbb'), { recursive: true })
  await mkdir(join(projectB, 'ccc'), { recursive: true })
  await mkdir(join(projectB, 'ddd'), { recursive: true })
  await writeFile(join(projectA, 'session-aaa', LOG), 'a'.repeat(100))
  await writeFile(join(projectA, 'session-bbb', LOG), 'b'.repeat(200))
  await writeFile(join(projectB, 'ccc', LOG), 'c'.repeat(50))
  await writeFile(join(projectB, 'ddd', LOG), 'd'.repeat(70))

  const cacheDir = join(home, 'storages', 'session_projcache', 'sessions')
  await mkdir(cacheDir, { recursive: true })
  await writeFile(join(cacheDir, 'session-aaa.json'), 'x'.repeat(10))
  await writeFile(join(cacheDir, 'session-aaa.json.bak.20250101'), 'y'.repeat(5))
  await writeFile(join(cacheDir, 'ccc.json'), 'z'.repeat(7))

  const state = {
    unit: { name: 'workspace', version: 2 },
    global: {
      initialized: true,
      defaultWorkspaceId: 'ws-a',
      workspaceIds: ['ws-a', 'ws-b'],
      archivedSessionIds: ['session-bbb'],
      pinnedSessionIds: ['ccc'],
    },
    tables: {
      workspaces: {
        'ws-a': { path: 'D:\\sandbox\\A', title: 'A', sessionIds: ['session-aaa', 'session-bbb'] },
        'ws-b': { path: 'D:\\sandbox\\B', title: 'B', sessionIds: ['ccc'] },
      },
    },
  }
  await writeFile(store.workspaceStatePath(home), JSON.stringify(state, null, 2))
  return { home, state }
}

test('resolveDshHome follows configured → $DSH_HOME → ~/.dsh', () => {
  // The literals must be absolute on the platform that runs the suite; CI runs
  // on Linux, so a Windows-only path would be resolved against the cwd there.
  const explicit = process.platform === 'win32' ? 'D:\\explicit' : '/srv/explicit'
  const envHome = process.platform === 'win32' ? 'D:\\from-env' : '/srv/from-env'
  const configured = store.resolveDshHome(explicit, { DSH_HOME: envHome })
  assert.equal(configured, resolve(explicit))
  const fromEnvironment = store.resolveDshHome('   ', { DSH_HOME: envHome })
  assert.equal(fromEnvironment, resolve(envHome))
  const fallback = store.resolveDshHome(undefined, {})
  assert.match(fallback, /[\\/]\.dsh$/u)
})

test('encodeSegment/decodeSegment round-trip and projectKey match DSH naming', () => {
  assert.equal(store.encodeSegment('session-201d89db-53ee'), 'session-201d89db-53ee')
  assert.equal(store.encodeSegment('.'), '~002E')
  assert.equal(store.encodeSegment('..'), '~002E~002E')
  assert.equal(store.encodeSegment('a b:c'), 'a~0020b~003Ac')
  assert.equal(store.decodeSegment('a~0020b~003Ac'), 'a b:c')
  assert.equal(store.projectKey('D:\\workspace\\dsh workspace'), '--D-workspace-dsh~0020workspace--')
})

test('readWorkspaceState summarizes registrations without mutating them', async () => {
  const { home } = await createSandbox()
  const state = await store.readWorkspaceState(home)
  assert.equal(state.exists, true)
  assert.equal(state.defaultWorkspaceId, 'ws-a')
  assert.deepEqual(state.workspaces.map((workspace) => workspace.id), ['ws-a', 'ws-b'])
  assert.deepEqual(state.workspaces[0].sessionIds, ['session-aaa', 'session-bbb'])
  assert.equal(state.workspaces[1].title, 'B')
  assert.equal(state.workspaces[0].isDefault, true)
  assert.deepEqual(state.archivedSessionIds, ['session-bbb'])
  assert.deepEqual(state.pinnedSessionIds, ['ccc'])
})

test('missing workspace.json is reported, not thrown', async () => {
  const home = await mkdtemp(join(tmpdir(), 'wscl-empty-'))
  const state = await store.readWorkspaceState(home)
  assert.equal(state.exists, false)
  assert.deepEqual(state.workspaces, [])
  assert.equal(state.error, undefined)
})

test('scans session directories and projection caches', async () => {
  const { home } = await createSandbox()
  const dirs = await store.scanSessionDirs(home)
  assert.deepEqual([...dirs.keys()].sort(), ['ccc', 'ddd', 'session-aaa', 'session-bbb'])
  const caches = await store.scanProjectionFiles(home)
  assert.deepEqual([...caches.keys()].sort(), ['ccc', 'session-aaa'])
  assert.equal(caches.get('session-aaa').length, 2)
})

test('buildInventory groups conversations, sizes and orphans', async () => {
  const { home } = await createSandbox()
  const state = await store.readWorkspaceState(home)
  const titles = new Map([
    ['session-aaa', '第一个对话'],
    ['ccc', 'B 的对话'],
  ])
  const inventory = await store.buildInventory({
    home,
    workspaces: state.workspaces,
    defaultWorkspaceId: state.defaultWorkspaceId,
    titles,
    archivedIds: new Set(state.archivedSessionIds),
    pinnedIds: new Set(state.pinnedSessionIds),
  })
  assert.equal(inventory.workspaces.length, 2)
  assert.equal(inventory.workspaces[0].sessions.length, 2)
  assert.equal(inventory.workspaces[0].sessions[0].title, '第一个对话')
  assert.equal(inventory.workspaces[0].sessions[1].archived, true)
  assert.equal(inventory.workspaces[1].sessions[0].pinned, true)
  assert.equal(inventory.workspaces[0].sessions[0].bytes, 115) // 100 log + 10 json + 5 bak
  assert.deepEqual(inventory.orphans.map((session) => session.id), ['ddd'])
  assert.equal(inventory.totals.sessions, 4)
  assert.equal(inventory.totals.orphanSessions, 1)
})

test('deleting one conversation removes its log, cache and backups only', async () => {
  const { home } = await createSandbox()
  const dirs = await store.scanSessionDirs(home)
  const caches = await store.scanProjectionFiles(home)
  const plan = await store.planSessionRemoval({ home, sessionId: 'session-aaa', dirs, projections: caches })
  assert.equal(plan.entries.length, 3)
  const outcome = await store.deleteSessionArtifacts(home, plan)
  assert.deepEqual(outcome.errors, [])
  assert.equal(outcome.bytes, 115)
  await assert.rejects(stat(join(home, 'sessions', '--D-sandbox-A--', 'session-aaa')))
  await assert.rejects(stat(join(home, 'storages', 'session_projcache', 'sessions', 'session-aaa.json')))
  await assert.rejects(stat(join(home, 'storages', 'session_projcache', 'sessions', 'session-aaa.json.bak.20250101')))
  // sibling conversation untouched
  assert.equal((await stat(join(home, 'sessions', '--D-sandbox-A--', 'session-bbb', LOG))).size, 200)
})

test('deleting the last conversation in a project prunes the empty project directory', async () => {
  const { home } = await createSandbox()
  const dirs = await store.scanSessionDirs(home)
  const first = await store.deleteSessionArtifacts(home, await store.planSessionRemoval({ home, sessionId: 'ccc', dirs, projections: new Map() }))
  assert.deepEqual(first.errors, [])
  assert.equal(first.pruned.length, 0, 'a project directory shared with another conversation stays')
  const rescan = await store.scanSessionDirs(home)
  const second = await store.deleteSessionArtifacts(home, await store.planSessionRemoval({ home, sessionId: 'ddd', dirs: rescan, projections: new Map() }))
  assert.deepEqual(second.errors, [])
  assert.equal(second.pruned.length, 1)
  await assert.rejects(stat(join(home, 'sessions', '--D-sandbox-B--')))
})

test('deleting a workspace detaches sessions instead of moving them to the default workspace', async () => {
  const { home, state } = await createSandbox()
  const next = store.removeWorkspacesFromState(store.removeSessionsFromState(state, ['ccc']), ['ws-b'])
  await store.writeWorkspaceState(home, next)
  const reread = await store.readWorkspaceState(home)
  assert.deepEqual(reread.raw.global.workspaceIds, ['ws-a'])
  assert.equal(reread.raw.tables.workspaces['ws-b'], undefined)
  assert.deepEqual(reread.raw.tables.workspaces['ws-a'].sessionIds, ['session-aaa', 'session-bbb'])
  assert.deepEqual(reread.raw.global.pinnedSessionIds, [])
  assert.deepEqual(reread.raw.global.archivedSessionIds, ['session-bbb'])
  const onDisk = JSON.parse(await readFile(store.workspaceStatePath(home), 'utf8'))
  assert.equal(onDisk.global.defaultWorkspaceId, 'ws-a')
})

test('deleting the default workspace drops the default pointer', async () => {
  const { home, state } = await createSandbox()
  const next = store.removeWorkspacesFromState(store.removeSessionsFromState(state, ['session-aaa', 'session-bbb']), ['ws-a'])
  await store.writeWorkspaceState(home, next)
  const reread = await store.readWorkspaceState(home)
  assert.equal(reread.raw.global.defaultWorkspaceId, undefined)
  assert.deepEqual(reread.raw.global.workspaceIds, ['ws-b'])
  assert.deepEqual(reread.raw.tables.workspaces['ws-a'], undefined)
})

test('assertInside refuses paths outside the DSH home', async () => {
  const { home } = await createSandbox()
  const outside = join(home, '..', 'elsewhere')
  assert.throws(() => store.assertInside(home, outside), /outside the DSH home/u)
  assert.throws(() => store.assertInside(home, home), /outside the DSH home/u)
  assert.equal(store.assertInside(home, join(home, 'sessions')), join(home, 'sessions'))
})

/** One ref shaped like the inventory builder produces. */
function ref(id, { workspaceIds = [], parentSessionId, origin, delegationDepth, exists = true } = {}) {
  return { id, workspaceIds, parentSessionId, origin, delegationDepth, exists, bytes: 1, children: [] }
}

test('resolveSessionOwnership nests sub-agents under their parent and inherits its workspace', () => {
  const refs = new Map([
    ['main', ref('main', { workspaceIds: ['ws-a'] })],
    ['child', ref('child', { parentSessionId: 'main', origin: 'subagent', delegationDepth: 1 })],
    ['grandchild', ref('grandchild', { parentSessionId: 'child', origin: 'subagent', delegationDepth: 2 })],
    ['orphan', ref('orphan')],
  ])
  const { roots, orphans } = store.resolveSessionOwnership(refs)
  assert.deepEqual(roots.map((node) => node.id).sort(), ['main', 'orphan'])
  const main = roots.find((node) => node.id === 'main')
  assert.equal(main.children.length, 1)
  assert.equal(main.children[0].id, 'child')
  assert.equal(main.children[0].ownerWorkspaceId, 'ws-a')
  assert.equal(main.children[0].depth, 2)
  assert.equal(main.children[0].children[0].id, 'grandchild')
  assert.equal(main.children[0].children[0].ownerWorkspaceId, 'ws-a')
  assert.equal(main.children[0].children[0].depth, 3)
  assert.deepEqual(orphans.map((node) => node.id), ['orphan'])
  assert.deepEqual(store.flattenSessionRefs(roots).map((node) => node.id), ['main', 'child', 'grandchild', 'orphan'])
})

test('resolveSessionOwnership nests a fork under its source without calling it a sub-agent', () => {
  const refs = new Map([
    ['main', ref('main', { workspaceIds: ['ws-a'] })],
    ['fork', ref('fork', { workspaceIds: ['ws-a'], parentSessionId: 'main' })],
    ['forkChild', ref('forkChild', { parentSessionId: 'fork', origin: 'subagent', delegationDepth: 1 })],
  ])
  const { roots } = store.resolveSessionOwnership(refs)
  assert.deepEqual(roots.map((node) => node.id), ['main'])
  const fork = roots[0].children[0]
  assert.equal(fork.id, 'fork')
  assert.equal(fork.fork, true)
  assert.equal(fork.subagent, false, 'a fork is never a sub-agent')
  assert.equal(fork.ownerWorkspaceId, 'ws-a')
  assert.equal(fork.depth, 2)
  assert.equal(fork.children[0].id, 'forkChild')
  assert.equal(fork.children[0].subagent, true)
  // Deleting the source conversation only takes its own sub-agents with it.
  assert.deepEqual(store.flattenSubagentRefs(roots).map((node) => node.id), ['main'])
  assert.deepEqual(store.flattenSubagentRefs([fork]).map((node) => node.id), ['fork', 'forkChild'])
  assert.deepEqual(store.flattenSessionRefs(roots).map((node) => node.id), ['main', 'fork', 'forkChild'])
})

test('resolveSessionOwnership keeps a fork independent when its workspace differs from the source', () => {
  const refs = new Map([
    ['main', ref('main', { workspaceIds: ['ws-a'] })],
    ['fork', ref('fork', { workspaceIds: ['ws-b'], parentSessionId: 'main' })],
  ])
  const { roots } = store.resolveSessionOwnership(refs)
  assert.deepEqual(roots.map((node) => node.id).sort(), ['fork', 'main'])
  const main = roots.find((node) => node.id === 'main')
  const fork = roots.find((node) => node.id === 'fork')
  assert.deepEqual(main.children, [])
  assert.equal(fork.fork, true)
  assert.equal(fork.subagent, false)
  assert.equal(fork.ownerWorkspaceId, 'ws-b')
})

test('buildInventory attributes sub-agent conversations to the parent conversation', async () => {
  const { home, state } = await createSandbox()
  const projectA = join(home, 'sessions', '--D-sandbox-A--')
  await mkdir(join(projectA, 'session-aaa-child'), { recursive: true })
  await writeFile(join(projectA, 'session-aaa-child', LOG), 'e'.repeat(30))
  await mkdir(join(projectA, 'session-aaa-grandchild'), { recursive: true })
  await writeFile(join(projectA, 'session-aaa-grandchild', LOG), 'f'.repeat(20))
  const metas = new Map([
    ['session-aaa-child', { parentSessionId: 'session-aaa', origin: 'subagent', delegationDepth: 1 }],
    ['session-aaa-grandchild', { parentSessionId: 'session-aaa-child', origin: 'subagent', delegationDepth: 2 }],
  ])
  const summary = store.summarizeWorkspaceState(state)
  const inventory = await store.buildInventory({
    home,
    workspaces: summary.workspaces,
    defaultWorkspaceId: summary.defaultWorkspaceId,
    metas,
  })
  const workspaceA = inventory.workspaces.find((workspace) => workspace.id === 'ws-a')
  const main = workspaceA.sessions.find((session) => session.id === 'session-aaa')
  assert.equal(workspaceA.sessions.length, 2, 'only main conversations are roots')
  assert.equal(main.children.length, 1)
  assert.equal(main.children[0].id, 'session-aaa-child')
  assert.equal(main.children[0].subagent, true)
  assert.equal(main.children[0].children[0].id, 'session-aaa-grandchild')
  assert.equal(workspaceA.sessionCount, 4)
  assert.equal(workspaceA.subagentCount, 2)
  assert.equal(inventory.totals.subagentSessions, 2)
  assert.deepEqual(inventory.orphans.map((session) => session.id), ['ddd'], 'sub-agents are no longer orphans')
})

test('buildInventory nests a fork under its source, counts it apart from sub-agents', async () => {
  const { home, state } = await createSandbox()
  const projectA = join(home, 'sessions', '--D-sandbox-A--')
  await mkdir(join(projectA, 'session-aaa-fork'), { recursive: true })
  await writeFile(join(projectA, 'session-aaa-fork', LOG), 'g'.repeat(40))
  state.tables.workspaces['ws-a'].sessionIds.push('session-aaa-fork')
  const metas = new Map([['session-aaa-fork', { parentSessionId: 'session-aaa' }]])
  const summary = store.summarizeWorkspaceState(state)
  const inventory = await store.buildInventory({
    home,
    workspaces: summary.workspaces,
    defaultWorkspaceId: summary.defaultWorkspaceId,
    metas,
  })
  const workspaceA = inventory.workspaces.find((workspace) => workspace.id === 'ws-a')
  assert.equal(workspaceA.sessions.length, 2, 'the fork is not a workspace-level root')
  const main = workspaceA.sessions.find((session) => session.id === 'session-aaa')
  const fork = main.children.find((session) => session.id === 'session-aaa-fork')
  assert.ok(fork !== undefined, 'the fork nests under the conversation it was copied from')
  assert.equal(fork.fork, true)
  assert.equal(fork.subagent, false)
  assert.equal(workspaceA.sessionCount, 3)
  assert.equal(workspaceA.forkCount, 1)
  assert.equal(workspaceA.subagentCount, 0)
  assert.equal(inventory.totals.forkSessions, 1)
  assert.equal(inventory.totals.subagentSessions, 0)
  assert.deepEqual(
    store.flattenSubagentRefs(workspaceA.sessions).map((session) => session.id).sort(),
    ['session-aaa', 'session-bbb'],
    'a fork is not part of any conversation lifecycle',
  )
  assert.deepEqual(
    store.flattenSessionRefs(workspaceA.sessions).map((session) => session.id).sort(),
    ['session-aaa', 'session-aaa-fork', 'session-bbb'],
  )
})

test('buildInventory warns about a sub-agent whose parent log is gone', async () => {
  const { home, state } = await createSandbox()
  const metas = new Map([['ddd', { parentSessionId: 'session-gone', origin: 'subagent', delegationDepth: 1 }]])
  const summary = store.summarizeWorkspaceState(state)
  const inventory = await store.buildInventory({
    home,
    workspaces: summary.workspaces,
    defaultWorkspaceId: summary.defaultWorkspaceId,
    metas,
  })
  assert.deepEqual(inventory.orphans.map((session) => session.id), ['ddd'])
  assert.ok(inventory.warnings.some((warning) => warning.includes('父对话记录已不存在')), JSON.stringify(inventory.warnings))
})

test('sortSessionRefsByTime orders roots and sub-agents newest first, undated last', () => {
  const parent = { ...ref('parent'), createdAt: 100 }
  const older = { ...ref('older'), createdAt: 50 }
  const childOld = { ...ref('child-old'), createdAt: 10 }
  const childNew = { ...ref('child-new'), createdAt: 900 }
  parent.children = [childOld, childNew]
  const undated = ref('undated')

  const input = [older, parent, undated]
  const sorted = store.sortSessionRefsByTime(input)
  assert.deepEqual(
    sorted.map((node) => node.id),
    ['parent', 'older', 'undated'],
  )
  assert.deepEqual(
    sorted[0].children.map((node) => node.id),
    ['child-new', 'child-old'],
  )
  assert.deepEqual(
    input.map((node) => node.id),
    ['older', 'parent', 'undated'],
    'the input array is not reordered in place',
  )
})

test('buildInventory sorts conversations and sub-agents by time', async () => {
  const { home, state } = await createSandbox()
  const metas = new Map([
    ['ccc', { createdAt: 300 }],
    ['ddd', { createdAt: 200 }],
    ['session-aaa', { createdAt: 100 }],
    ['session-bbb', { createdAt: 500 }],
  ])
  const summary = store.summarizeWorkspaceState(state)
  const inventory = await store.buildInventory({
    home,
    workspaces: summary.workspaces,
    defaultWorkspaceId: summary.defaultWorkspaceId,
    metas,
  })
  const workspaceB = inventory.workspaces.find((workspace) => workspace.id === 'ws-b')
  assert.deepEqual(
    workspaceB.sessions.map((session) => session.id),
    ['ccc'],
  )
  assert.deepEqual(
    inventory.orphans.map((session) => session.id),
    ['ddd'],
    'the unregistered conversation keeps its time stamp and is still an orphan',
  )
  const workspaceA = inventory.workspaces.find((workspace) => workspace.id === 'ws-a')
  assert.deepEqual(
    workspaceA.sessions.map((session) => session.id),
    ['session-bbb', 'session-aaa'],
  )
  assert.ok(workspaceA.sessions.every((session) => Number.isFinite(session.createdAt)))
})

test('promptTitle turns the first prompt into a readable name', () => {
  assert.equal(store.promptTitle('  帮我看下这个解析器为什么会丢字段，顺便修一下  '), '帮我看下这个解析器为什么会丢字段，顺便修一下')
  assert.equal(
    store.promptTitle('```js\nconst x = 1\n```\n请把这段代码改成 async 函数'),
    '请把这段代码改成 async 函数',
    'code fences are dropped from the name',
  )
  assert.equal(store.promptTitle('# 标题\n\n- 第一项\n- 第二项'), '标题 第一项 第二项')
  assert.equal(store.promptTitle(''), '')
  assert.equal(store.promptTitle('   \n\t '), '', 'a whitespace-only prompt has no usable name')
  assert.equal(store.promptTitle('x'.repeat(200)).length, store.PROMPT_TITLE_MAX_CHARS)
  assert.ok(store.promptTitle('x'.repeat(200)).endsWith('…'))
  assert.equal(store.promptTitle('legacy', 4), 'leg…', 'an explicit limit is honoured')
})

test('buildInventory flags empty conversations and prompt-derived titles', async () => {
  const { home, state } = await createSandbox()
  const summary = store.summarizeWorkspaceState(state)
  const inventory = await store.buildInventory({
    home,
    workspaces: summary.workspaces,
    defaultWorkspaceId: summary.defaultWorkspaceId,
    titles: new Map([['session-bbb', '自动总结的标题']]),
    emptyIds: new Set(['session-aaa']),
    promptIds: new Set(['ccc']),
  })
  const workspaceA = inventory.workspaces.find((workspace) => workspace.id === 'ws-a')
  const emptySession = workspaceA.sessions.find((session) => session.id === 'session-aaa')
  assert.equal(emptySession.empty, true)
  assert.equal(emptySession.titleFromPrompt, false)
  const workspaceB = inventory.workspaces.find((workspace) => workspace.id === 'ws-b')
  assert.equal(workspaceB.sessions[0].titleFromPrompt, true, 'ccc is named from its first prompt')
})
