/**
 * Sandbox tests for the Host HTTP surface.
 *
 * The plugin is mounted against a fake Cordis context whose `webServer`
 * only records the route registration, and every request is executed against
 * a throwaway `DSH_HOME` created with `mkdtemp`. No server is started and the
 * real DSH home is never touched.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import * as store from '../lib/store.js'

const LOG = 'session.v4.jsonl.zstd'

/** Create the same sandbox shape used by the store tests. */
async function createSandbox() {
  const home = await mkdtemp(join(tmpdir(), 'wscl-http-'))
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
  const state = {
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, defaultWorkspaceId: 'ws-a', workspaceIds: ['ws-a', 'ws-b'], archivedSessionIds: [], pinnedSessionIds: [] },
    tables: {
      workspaces: {
        'ws-a': { path: 'D:\\sandbox\\A', title: 'A', sessionIds: ['session-aaa', 'session-bbb'] },
        'ws-b': { path: 'D:\\sandbox\\B', title: 'B', sessionIds: ['ccc', 'ddd'] },
      },
    },
  }
  await writeFile(store.workspaceStatePath(home), JSON.stringify(state, null, 2))
  return { home }
}

/** Fake Host registry service that persists into the sandbox like the real one. */
function createRegistry(state, home) {
  const calls = { detach: [], deleted: [], archived: [] }
  const persist = () => store.writeWorkspaceState(home, state)
  const workspaces = state.global.workspaceIds.map((id) => {
    const row = state.tables.workspaces[id]
    const workspace = {
      id,
      title: row.title,
      path: row.path,
      sessionIds: [...row.sessionIds],
      async detachSession(sessionId) {
        calls.detach.push(sessionId)
        workspace.sessionIds = workspace.sessionIds.filter((candidate) => candidate !== sessionId)
        row.sessionIds = [...workspace.sessionIds]
        await persist()
      },
    }
    return workspace
  })
  return {
    calls,
    workspaces,
    async list() {
      return workspaces.filter((workspace) => !calls.deleted.includes(workspace.id))
    },
    async delete(id) {
      calls.deleted.push(id)
      state.global.workspaceIds = state.global.workspaceIds.filter((candidate) => candidate !== id)
      delete state.tables.workspaces[id]
      await persist()
      return true
    },
    async archiveSession(sessionId) {
      calls.archived.push(sessionId)
    },
    async unarchiveSession() {},
    async unpinSession() {},
  }
}

/** Add one sub-agent conversation log that no workspace lists. */
async function addSubagent(home, id, parentId) {
  const dir = join(home, 'sessions', '--D-sandbox-A--', id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, LOG), 's'.repeat(40))
  return { id, parentSessionId: parentId, origin: 'subagent', delegationDepth: 1 }
}

/** Mount the plugin and return a request executor. */
async function mount(home, { registry, live = [], unTitled = [], parents = {}, times = {}, prompts = {} } = {}) {
  const registrations = []
  const emitted = []
  const ctx = {
    effect(fn) {
      return fn()
    },
    // The plugin replays host events through `ctx.emit`; capture them so tests can
    // assert the Client is told a conversation disappeared.
    emit(event, ...args) {
      emitted.push([event, ...args])
    },
    webServer: {
      register(registration) {
        registrations.push(registration)
        return () => {}
      },
    },
    get(key) {
      if (key === 'workspaceRegistry') return registry ?? null
      if (key === 'sessionQuery') {
        return {
          // Real contract (Host Service inspect): the id sits on the RESULT, `value.session` is the
          // whole SessionHeader object, and the folded title is `value.title.title`.
          async readTitleSnapshots(ids) {
            return ids.map((id) => {
              const parent = parents[id]
              return {
                sessionId: id,
                status: 'fulfilled',
                value: {
                  session: {
                    version: 4,
                    id,
                    createdAt: times[id] ?? 1,
                    isSeeded: false,
                    ...(parent === undefined
                      ? {}
                      : {
                          parentSession: parent.parentSessionId,
                          origin: parent.origin,
                          delegationDepth: parent.delegationDepth,
                        }),
                  },
                  ...(unTitled.includes(id) ? {} : { title: { title: `标题-${id}`, messageSeqs: [], source: { kind: 'user' }, eventSeq: 1, updatedAt: 1 } }),
                },
              }
            })
          },
          // Fallback source for conversations without a `session/title` event: the
          // Host scans the first `user/message` text and derives a name from it.
          async filterEvents(id, filters) {
            const wantsUserMessage = (filters ?? []).some((filter) => filter?.kind === 'type' && (filter.values ?? []).includes('user/message'))
            if (!wantsUserMessage) return []
            const text = prompts[id]
            return text === undefined ? [] : [{ type: 'user/message', seq: 2, time: 2, surface: 'current', text }]
          },
        }
      }
      if (key === 'sessions') return { list: () => live.map((id) => ({ id })) }
      return null
    },
  }
  apply(ctx, { dshHome: home })
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].path, '/api/workspace-cleaner')

  const call = async (options = {}) => {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body)
    const headers = {
      host: '127.0.0.1:8607',
      ...(options.origin === undefined ? {} : { origin: options.origin }),
      ...(options.headers ?? {}),
    }
    const chunks = body === undefined ? [] : [Buffer.from(body)]
    const request = {
      method: options.method ?? 'GET',
      url: options.url,
      headers,
      socket: { remoteAddress: options.address ?? '127.0.0.1' },
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) yield chunk
      },
    }
    const captured = { statusCode: 200, headers: {}, body: '' }
    const response = {
      setHeader(name, value) {
        captured.headers[name.toLowerCase()] = value
      },
      end(value) {
        captured.body = value ?? ''
      },
    }
    Object.defineProperty(response, 'statusCode', {
      get: () => captured.statusCode,
      set: (value) => {
        captured.statusCode = value
      },
    })
    await registrations[0].handler(request, response)
    return { status: captured.statusCode, headers: captured.headers, json: captured.body === '' ? null : JSON.parse(captured.body) }
  }
  call.emitted = emitted
  return call
}

test('GET /health reports the sandbox home', async () => {
  const { home } = await createSandbox()
  const call = await mount(home)
  const response = await call({ url: '/api/workspace-cleaner/health' })
  assert.equal(response.status, 200)
  assert.equal(response.json.ok, true)
  assert.equal(response.json.home, home)
})

test('GET /inventory lists workspaces, titles, sizes and orphans', async () => {
  const { home } = await createSandbox()
  const state = await store.readWorkspaceState(home)
  const call = await mount(home, { registry: createRegistry(state.raw, home) })
  const response = await call({ url: '/api/workspace-cleaner/inventory' })
  assert.equal(response.status, 200)
  assert.equal(response.json.ok, true)
  assert.deepEqual(
    response.json.workspaces.map((workspace) => workspace.id),
    ['ws-a', 'ws-b'],
  )
  assert.equal(response.json.workspaces[0].sessions[0].title, '标题-session-aaa')
  assert.deepEqual(response.json.orphans, [])
  assert.equal(response.json.totals.sessions, 4)
  assert.ok(response.json.totals.bytes > 0)
})

test('GET /inventory names an untitled conversation after its first prompt', async () => {
  const { home } = await createSandbox()
  const state = await store.readWorkspaceState(home)
  const call = await mount(home, {
    registry: createRegistry(state.raw, home),
    unTitled: ['session-aaa'],
    prompts: { 'session-aaa': '```js\nconst x = 1\n```\n帮我看下这个解析器为什么会丢字段，顺便修一下' },
  })
  const response = await call({ url: '/api/workspace-cleaner/inventory' })
  assert.equal(response.status, 200)
  const session = response.json.workspaces[0].sessions[0]
  assert.equal(session.title, '帮我看下这个解析器为什么会丢字段，顺便修一下')
  assert.equal(session.titleFromPrompt, true)
  assert.equal(session.empty, false)
  assert.equal(response.json.workspaces[0].sessions[1].title, '标题-session-bbb')
})

test('GET /inventory marks a conversation without any message as empty, not unnamed', async () => {
  const { home } = await createSandbox()
  const state = await store.readWorkspaceState(home)
  const call = await mount(home, { registry: createRegistry(state.raw, home), unTitled: ['session-aaa'] })
  const response = await call({ url: '/api/workspace-cleaner/inventory' })
  assert.equal(response.status, 200)
  const session = response.json.workspaces[0].sessions[0]
  assert.equal(session.title, '')
  assert.equal(session.empty, true)
  assert.equal(session.titleFromPrompt, false)
})

test('POST /delete-sessions refuses a live conversation unless forced', async () => {
  const { home } = await createSandbox()
  const state = await store.readWorkspaceState(home)
  const registry = createRegistry(state.raw, home)
  const call = await mount(home, { registry, live: ['session-aaa'] })
  const response = await call({ method: 'POST', url: '/api/workspace-cleaner/delete-sessions', body: { sessionIds: ['session-aaa'] } })
  assert.equal(response.json.ok, false)
  assert.equal(response.json.failures[0].needsForce, true)
  await access(join(home, 'sessions', '--D-sandbox-A--', 'session-aaa', LOG))
})

test('POST /delete-sessions with force removes artifacts and detaches the registration', async () => {
  const { home } = await createSandbox()
  const state = await store.readWorkspaceState(home)
  const registry = createRegistry(state.raw, home)
  const call = await mount(home, { registry, live: ['session-aaa'] })
  const response = await call({
    method: 'POST',
    url: '/api/workspace-cleaner/delete-sessions',
    body: { sessionIds: ['session-aaa'], force: true },
  })
  assert.equal(response.json.ok, true, JSON.stringify(response.json))
  assert.equal(response.json.totals.sessions, 1)
  assert.deepEqual(registry.calls.archived, ['session-aaa'])
  assert.deepEqual(registry.calls.detach, ['session-aaa'])
  await assert.rejects(access(join(home, 'sessions', '--D-sandbox-A--', 'session-aaa')))
  const reread = await store.readWorkspaceState(home)
  assert.deepEqual(reread.raw.tables.workspaces['ws-a'].sessionIds, ['session-bbb'])
})

test('POST /delete-workspaces deletes every conversation and never reattaches them', async () => {
  const { home } = await createSandbox()
  const state = await store.readWorkspaceState(home)
  const registry = createRegistry(state.raw, home)
  const call = await mount(home, { registry })
  const response = await call({
    method: 'POST',
    url: '/api/workspace-cleaner/delete-workspaces',
    body: { workspaceIds: ['ws-b'] },
  })
  assert.equal(response.json.ok, true, JSON.stringify(response.json))
  assert.equal(response.json.totals.workspaces, 1)
  assert.equal(response.json.totals.sessions, 2)
  assert.deepEqual(registry.calls.deleted, ['ws-b'])
  await assert.rejects(access(join(home, 'sessions', '--D-sandbox-B--', 'ccc')))
  await assert.rejects(access(join(home, 'sessions', '--D-sandbox-B--', 'ddd')))
  const reread = await store.readWorkspaceState(home)
  assert.deepEqual(reread.raw.tables.workspaces['ws-a'].sessionIds, ['session-aaa', 'session-bbb'])
})

test('POST /delete-workspaces protects the default workspace', async () => {
  const { home } = await createSandbox()
  const state = await store.readWorkspaceState(home)
  const registry = createRegistry(state.raw, home)
  const call = await mount(home, { registry })
  const response = await call({
    method: 'POST',
    url: '/api/workspace-cleaner/delete-workspaces',
    body: { workspaceIds: ['ws-a'] },
  })
  assert.equal(response.json.ok, false)
  assert.equal(response.json.failures[0].needsForce, true)
  await access(join(home, 'sessions', '--D-sandbox-A--', 'session-aaa', LOG))
})

test('destructive routes reject non-loopback, cross-site and foreign-origin callers', async () => {
  const { home } = await createSandbox()
  const state = await store.readWorkspaceState(home)
  const call = await mount(home, { registry: createRegistry(state.raw, home) })
  const url = '/api/workspace-cleaner/delete-workspaces'
  const body = { workspaceIds: ['ws-b'] }

  const remote = await call({ method: 'POST', url, body, address: '10.1.2.3' })
  assert.equal(remote.status, 403)

  const crossSite = await call({ method: 'POST', url, body, headers: { 'sec-fetch-site': 'cross-site' } })
  assert.equal(crossSite.status, 403)

  const foreignOrigin = await call({ method: 'POST', url, body, origin: 'https://evil.example' })
  assert.equal(foreignOrigin.status, 403)

  const desktopOrigin = await call({ method: 'POST', url, body, origin: 'dsh-app://127.0.0.1:8607' })
  assert.equal(desktopOrigin.status, 200, JSON.stringify(desktopOrigin.json))
})

test('GET /inventory nests sub-agent conversations under their parent conversation', async () => {
  const { home } = await createSandbox()
  const child = await addSubagent(home, 'session-aaa-child', 'session-aaa')
  const state = await store.readWorkspaceState(home)
  const call = await mount(home, { registry: createRegistry(state.raw, home), parents: { [child.id]: child } })
  const response = await call({ url: '/api/workspace-cleaner/inventory' })
  assert.equal(response.status, 200)
  const workspaceA = response.json.workspaces.find((workspace) => workspace.id === 'ws-a')
  assert.equal(workspaceA.sessions.length, 2, 'sub-agents are nested, not top-level rows')
  const main = workspaceA.sessions.find((session) => session.id === 'session-aaa')
  assert.equal(main.children.length, 1)
  assert.equal(main.children[0].id, 'session-aaa-child')
  assert.equal(main.children[0].subagent, true)
  assert.equal(workspaceA.subagentCount, 1)
  assert.equal(response.json.totals.subagentSessions, 1)
  assert.deepEqual(response.json.orphans, [], 'attributed sub-agents are not reported as unassigned')
})

/** Add one forked conversation log and register it in a workspace. */
async function addFork(home, raw, { id, parentSessionId, workspaceId = 'ws-a' }) {
  const dir = join(home, 'sessions', '--D-sandbox-A--', id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, LOG), 'k'.repeat(40))
  raw.tables.workspaces[workspaceId].sessionIds.push(id)
  return { id, parentSessionId }
}

test('GET /inventory nests a fork under its source without labelling it a sub-agent', async () => {
  const { home } = await createSandbox()
  const state = await store.readWorkspaceState(home)
  const fork = await addFork(home, state.raw, { id: 'session-aaa-fork', parentSessionId: 'session-aaa' })
  const call = await mount(home, { registry: createRegistry(state.raw, home), parents: { [fork.id]: fork } })
  const response = await call({ url: '/api/workspace-cleaner/inventory' })
  assert.equal(response.status, 200)
  const workspaceA = response.json.workspaces.find((workspace) => workspace.id === 'ws-a')
  assert.equal(workspaceA.sessions.length, 2, 'a fork is nested, not a separate top-level row')
  const main = workspaceA.sessions.find((session) => session.id === 'session-aaa')
  const nested = main.children.find((session) => session.id === 'session-aaa-fork')
  assert.ok(nested !== undefined, 'the fork nests under the conversation it was copied from')
  assert.equal(nested.fork, true)
  assert.equal(nested.subagent, false)
  assert.equal(workspaceA.forkCount, 1)
  assert.equal(workspaceA.subagentCount, 0)
  assert.equal(response.json.totals.forkSessions, 1)
  assert.equal(response.json.totals.subagentSessions, 0)
})

test('POST /delete-sessions deletes a source conversation but never its fork', async () => {
  const { home } = await createSandbox()
  const state = await store.readWorkspaceState(home)
  const fork = await addFork(home, state.raw, { id: 'session-aaa-fork', parentSessionId: 'session-aaa' })
  const registry = createRegistry(state.raw, home)
  const call = await mount(home, { registry, parents: { [fork.id]: fork } })
  const response = await call({ method: 'POST', url: '/api/workspace-cleaner/delete-sessions', body: { sessionIds: ['session-aaa'] } })
  assert.equal(response.json.ok, true, JSON.stringify(response.json))
  assert.equal(response.json.totals.sessions, 1)
  await assert.rejects(access(join(home, 'sessions', '--D-sandbox-A--', 'session-aaa')))
  await access(join(home, 'sessions', '--D-sandbox-A--', 'session-aaa-fork', LOG))
  await access(join(home, 'sessions', '--D-sandbox-A--', 'session-bbb', LOG))
  assert.deepEqual(registry.calls.detach, ['session-aaa'], 'the fork keeps its own registration')
})

test('POST /delete-sessions deletes a fork together with its own sub-agents only', async () => {
  const { home } = await createSandbox()
  const state = await store.readWorkspaceState(home)
  const fork = await addFork(home, state.raw, { id: 'session-aaa-fork', parentSessionId: 'session-aaa' })
  const child = await addSubagent(home, 'session-aaa-fork-child', 'session-aaa-fork')
  const registry = createRegistry(state.raw, home)
  const call = await mount(home, { registry, parents: { [fork.id]: fork, [child.id]: child } })
  const response = await call({ method: 'POST', url: '/api/workspace-cleaner/delete-sessions', body: { sessionIds: ['session-aaa-fork'] } })
  assert.equal(response.json.ok, true, JSON.stringify(response.json))
  assert.equal(response.json.totals.sessions, 2, 'the fork and the sub-agent it spawned')
  await assert.rejects(access(join(home, 'sessions', '--D-sandbox-A--', 'session-aaa-fork')))
  await assert.rejects(access(join(home, 'sessions', '--D-sandbox-A--', 'session-aaa-fork-child')))
  await access(join(home, 'sessions', '--D-sandbox-A--', 'session-aaa', LOG))
})

test('POST /delete-sessions deletes an attributed sub-agent together with its parent', async () => {
  const { home } = await createSandbox()
  const child = await addSubagent(home, 'session-aaa-child', 'session-aaa')
  const state = await store.readWorkspaceState(home)
  const registry = createRegistry(state.raw, home)
  const call = await mount(home, { registry, parents: { [child.id]: child } })
  const response = await call({
    method: 'POST',
    url: '/api/workspace-cleaner/delete-sessions',
    body: { sessionIds: ['session-aaa'] },
  })
  assert.equal(response.json.ok, true, JSON.stringify(response.json))
  assert.equal(response.json.totals.sessions, 2, 'parent and sub-agent are both deleted')
  await assert.rejects(access(join(home, 'sessions', '--D-sandbox-A--', 'session-aaa')))
  await assert.rejects(access(join(home, 'sessions', '--D-sandbox-A--', 'session-aaa-child')))
  await access(join(home, 'sessions', '--D-sandbox-A--', 'session-bbb', LOG))
  assert.deepEqual(registry.calls.detach, ['session-aaa'], 'sub-agents have no workspace registration of their own')
})

test('POST /delete-sessions tells the Client the conversation left the catalog', async () => {
  const { home } = await createSandbox()
  const state = await store.readWorkspaceState(home)
  const call = await mount(home, { registry: createRegistry(state.raw, home) })
  const response = await call({
    method: 'POST',
    url: '/api/workspace-cleaner/delete-sessions',
    body: { sessionIds: ['session-aaa'] },
  })
  assert.equal(response.json.ok, true, JSON.stringify(response.json))
  assert.deepEqual(
    call.emitted,
    [['api-session/removed', 'session-aaa']],
    'a deleted conversation must be announced so the Client drops its row instead of regrouping it as ungrouped',
  )
})

test('POST /delete-sessions does not announce a refused deletion', async () => {
  const { home } = await createSandbox()
  const state = await store.readWorkspaceState(home)
  const call = await mount(home, { registry: createRegistry(state.raw, home), live: ['session-aaa'] })
  const response = await call({
    method: 'POST',
    url: '/api/workspace-cleaner/delete-sessions',
    body: { sessionIds: ['session-aaa'] },
  })
  assert.equal(response.json.failures[0].needsForce, true)
  assert.deepEqual(call.emitted, [])
})

test('POST /delete announces every conversation it removed with a workspace', async () => {
  const { home } = await createSandbox()
  const child = await addSubagent(home, 'session-aaa-child', 'session-aaa')
  const state = await store.readWorkspaceState(home)
  const call = await mount(home, { registry: createRegistry(state.raw, home), parents: { [child.id]: child } })
  const response = await call({
    method: 'POST',
    url: '/api/workspace-cleaner/delete',
    body: { workspaceIds: ['ws-a', 'ws-b'], sessionIds: [], force: true },
  })
  assert.equal(response.json.ok, true, JSON.stringify(response.json))
  assert.deepEqual(
    call.emitted.filter(([event]) => event === 'api-session/removed').map(([, id]) => id).sort(),
    ['ccc', 'ddd', 'session-aaa', 'session-aaa-child', 'session-bbb'],
    'every removed conversation, sub-agents included, is announced exactly once',
  )
})

test('POST /delete-workspaces deletes sub-agent conversations of its conversations', async () => {
  const { home } = await createSandbox()
  const child = await addSubagent(home, 'session-aaa-child', 'session-aaa')
  const state = await store.readWorkspaceState(home)
  const registry = createRegistry(state.raw, home)
  const call = await mount(home, { registry, parents: { [child.id]: child } })
  const response = await call({
    method: 'POST',
    url: '/api/workspace-cleaner/delete-workspaces',
    body: { workspaceIds: ['ws-a'] },
  })
  assert.equal(response.json.ok, false, 'ws-a is the default workspace')
  assert.equal(response.json.failures[0].needsForce, true)

  const forced = await call({
    method: 'POST',
    url: '/api/workspace-cleaner/delete-workspaces',
    body: { workspaceIds: ['ws-a'], force: true },
  })
  assert.equal(forced.json.ok, true, JSON.stringify(forced.json))
  assert.equal(forced.json.totals.sessions, 3, 'two registered conversations plus one sub-agent')
  await assert.rejects(access(join(home, 'sessions', '--D-sandbox-A--', 'session-aaa-child')))
})

test('POST /delete deletes checked workspaces and checked conversations in one action', async () => {
  const { home } = await createSandbox()
  const state = await store.readWorkspaceState(home)
  const registry = createRegistry(state.raw, home)
  const call = await mount(home, { registry })
  const response = await call({
    method: 'POST',
    url: '/api/workspace-cleaner/delete',
    body: { workspaceIds: ['ws-b'], sessionIds: ['session-aaa'] },
  })
  assert.equal(response.json.ok, true, JSON.stringify(response.json))
  assert.equal(response.json.totals.workspaces, 1)
  assert.equal(response.json.totals.sessions, 3, 'two conversations of ws-b plus the checked conversation of ws-a')
  assert.deepEqual(registry.calls.deleted, ['ws-b'])
  await assert.rejects(access(join(home, 'sessions', '--D-sandbox-B--', 'ccc')))
  await assert.rejects(access(join(home, 'sessions', '--D-sandbox-A--', 'session-aaa')))
  await access(join(home, 'sessions', '--D-sandbox-A--', 'session-bbb', LOG))
  const reread = await store.readWorkspaceState(home)
  assert.deepEqual(reread.raw.tables.workspaces['ws-a'].sessionIds, ['session-bbb'])
})

test('POST /delete never deletes a conversation twice when its workspace is also checked', async () => {
  const { home } = await createSandbox()
  const state = await store.readWorkspaceState(home)
  const call = await mount(home, { registry: createRegistry(state.raw, home) })
  const response = await call({
    method: 'POST',
    url: '/api/workspace-cleaner/delete',
    body: { workspaceIds: ['ws-b'], sessionIds: ['ccc', 'ddd'] },
  })
  assert.equal(response.json.ok, true, JSON.stringify(response.json))
  assert.equal(response.json.totals.workspaces, 1)
  assert.equal(response.json.totals.sessions, 2, 'ccc and ddd are deleted as part of ws-b, not twice')
  assert.equal(response.json.deleted.sessions.length, 0)
})

test('an empty workspace can be checked and deleted', async () => {
  const { home } = await createSandbox()
  const state = await store.readWorkspaceState(home)
  state.raw.global.workspaceIds.push('ws-empty')
  state.raw.tables.workspaces['ws-empty'] = { path: 'D:\\sandbox\\empty', title: '空工作区', sessionIds: [] }
  await store.writeWorkspaceState(home, state.raw)
  const registry = createRegistry(state.raw, home)
  const call = await mount(home, { registry })

  const inventory = await call({ url: '/api/workspace-cleaner/inventory' })
  const empty = inventory.json.workspaces.find((workspace) => workspace.id === 'ws-empty')
  assert.ok(empty, 'the empty workspace is listed')
  assert.equal(empty.sessionCount, 0)
  assert.deepEqual(empty.sessions, [])

  // The shipped Client half always sends both lists, so deleting an empty
  // workspace arrives as `{workspaceIds: [...], sessionIds: []}` — an empty list
  // must be accepted here, not rejected as "sessionIds 必须是非空数组".
  const response = await call({
    method: 'POST',
    url: '/api/workspace-cleaner/delete',
    body: { workspaceIds: ['ws-empty'], sessionIds: [] },
  })
  assert.equal(response.json.ok, true, JSON.stringify(response.json))
  assert.equal(response.json.totals.workspaces, 1)
  assert.equal(response.json.totals.sessions, 0)
  assert.deepEqual(registry.calls.deleted, ['ws-empty'])
  const reread = await store.readWorkspaceState(home)
  assert.equal(reread.raw.tables.workspaces['ws-empty'], undefined)
})

test('POST /delete accepts a conversation-only payload with an empty workspace list', async () => {
  const { home } = await createSandbox()
  const state = await store.readWorkspaceState(home)
  const registry = createRegistry(state.raw, home)
  const call = await mount(home, { registry })
  const response = await call({
    method: 'POST',
    url: '/api/workspace-cleaner/delete',
    body: { workspaceIds: [], sessionIds: ['session-aaa'] },
  })
  assert.equal(response.json.ok, true, JSON.stringify(response.json))
  assert.equal(response.json.totals.workspaces, 0)
  assert.equal(response.json.totals.sessions, 1)
  await assert.rejects(access(join(home, 'sessions', '--D-sandbox-A--', 'session-aaa')))
})

test('GET /inventory sorts conversations by time, newest first', async () => {
  const { home } = await createSandbox()
  const child = await addSubagent(home, 'session-aaa-child', 'session-aaa')
  const state = await store.readWorkspaceState(home)
  const call = await mount(home, {
    registry: createRegistry(state.raw, home),
    parents: { [child.id]: child },
    times: { 'session-aaa': 100, 'session-bbb': 500, 'ccc': 300, 'ddd': 200, 'session-aaa-child': 900 },
  })
  const response = await call({ url: '/api/workspace-cleaner/inventory' })
  assert.equal(response.status, 200)
  const workspaceA = response.json.workspaces.find((workspace) => workspace.id === 'ws-a')
  assert.deepEqual(
    workspaceA.sessions.map((session) => session.id),
    ['session-bbb', 'session-aaa'],
  )
  assert.deepEqual(
    workspaceA.sessions[1].children.map((session) => session.id),
    ['session-aaa-child'],
  )
  assert.deepEqual(
    response.json.workspaces.find((workspace) => workspace.id === 'ws-b').sessions.map((session) => session.id),
    ['ccc', 'ddd'],
  )
})

test('request validation rejects bad ids, empty lists, unknown routes and bad JSON', async () => {
  const { home } = await createSandbox()
  const state = await store.readWorkspaceState(home)
  const call = await mount(home, { registry: createRegistry(state.raw, home) })

  const traversal = await call({ method: 'POST', url: '/api/workspace-cleaner/delete-sessions', body: { sessionIds: ['../etc'] } })
  assert.equal(traversal.status, 400)

  const empty = await call({ method: 'POST', url: '/api/workspace-cleaner/delete-sessions', body: { sessionIds: [] } })
  assert.equal(empty.status, 400)

  const unknown = await call({ url: '/api/workspace-cleaner/nope' })
  assert.equal(unknown.status, 404)
})
