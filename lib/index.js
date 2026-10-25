/**
 * @module dsh-workspace-cleaner
 *
 * Host half: inventories workspaces/conversations and performs deletions.
 *
 * Deletion happens in this order, which is what makes "delete the workspace"
 * mean "delete its conversations" instead of "retain them":
 *   1. stop/archive any live conversation,
 *   2. remove the conversation artifacts from disk (session log dir + caches),
 *   3. detach the conversation ids from the workspace registry,
 *   4. remove the workspace registration itself (or let step 3 do it for sessions).
 *
 * HTTP surface (loopback + same-origin only, see `trusted`):
 *   GET  /api/workspace-cleaner/health
 *   GET  /api/workspace-cleaner/inventory
 *   POST /api/workspace-cleaner/delete-sessions   { sessionIds: string[], force?: boolean }
 *   POST /api/workspace-cleaner/delete-workspaces { workspaceIds: string[], force?: boolean }
 */
import { statSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import * as store from './store.js'

/** Loader entry id used by cordis.patch.yml. */
export const name = 'workspace-cleaner'
/** The only Host service this plugin needs eagerly. */
export const inject = ['webServer']

const ROUTE_PREFIX = '/api/workspace-cleaner'
const VERSION = '0.1.7'
const BUILD = (() => {
  try {
    return statSync(fileURLToPath(import.meta.url)).mtime.toISOString()
  } catch {
    return 'unknown'
  }
})()
const MAX_BODY_BYTES = 1024 * 1024
const MAX_IDS = 5000

/**
 * Register the HTTP routes.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {{dshHome?: string}} [config] - optional Config.
 */
export function apply(ctx, config = {}) {
  const options = { dshHome: typeof config.dshHome === 'string' ? config.dshHome : undefined }
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: (req, res) =>
          route(ctx, options, req, res).catch((error) => {
            try {
              sendJson(res, Number.isInteger(error?.status) ? error.status : 500, { ok: false, error: messageOf(error) })
            } catch {
              /* response already gone */
            }
          }),
      }),
    'workspace-cleaner: /api/workspace-cleaner',
  )
}

export default { name, inject, apply }

/**
 * Dispatch one request.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {{dshHome?: string}} options - normalized Config.
 * @param {import('node:http').IncomingMessage} req - request.
 * @param {import('node:http').ServerResponse} res - response.
 */
async function route(ctx, options, req, res) {
  if (!trusted(req)) {
    sendJson(res, 403, { ok: false, error: '仅允许本机同源界面调用该接口' })
    return
  }
  let pathname
  try {
    pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
  } catch {
    sendJson(res, 400, { ok: false, error: '无法解析请求地址' })
    return
  }
  const suffix = pathname.slice(ROUTE_PREFIX.length).replace(/\/+$/u, '') || '/'
  const method = (req.method ?? 'GET').toUpperCase()

  if (suffix === '/health' && method === 'GET') {
    sendJson(res, 200, { ok: true, plugin: name, version: VERSION, build: BUILD, home: store.resolveDshHome(options.dshHome) })
    return
  }

  if (suffix === '/inventory' && method === 'GET') {
    const payload = await buildInventory(ctx, options)
    sendJson(res, 200, { ok: true, ...payload })
    return
  }

  if (suffix === '/delete-sessions' && method === 'POST') {
    const body = await readJsonBody(req)
    const ids = requireIds(body, 'sessionIds')
    const payload = await deleteSessions(ctx, options, ids, body.force === true)
    sendJson(res, 200, { ok: payload.failures.length === 0, ...payload })
    return
  }

  if (suffix === '/delete-workspaces' && method === 'POST') {
    const body = await readJsonBody(req)
    const ids = requireIds(body, 'workspaceIds')
    const payload = await deleteWorkspaces(ctx, options, ids, body.force === true)
    sendJson(res, 200, { ok: payload.failures.length === 0, ...payload })
    return
  }

  if (suffix === '/delete' && method === 'POST') {
    const body = await readJsonBody(req)
    const workspaceIds = optionalIds(body, 'workspaceIds')
    const sessionIds = optionalIds(body, 'sessionIds')
    if (workspaceIds.length === 0 && sessionIds.length === 0) {
      sendJson(res, 400, { ok: false, error: '请至少勾选一个工作区或一个对话' })
      return
    }
    const payload = await deleteSelection(ctx, options, workspaceIds, sessionIds, body.force === true)
    sendJson(res, 200, { ok: payload.failures.length === 0, ...payload })
    return
  }

  sendJson(res, 404, { ok: false, error: `未知接口：${method} ${suffix}` })
}

/* ------------------------------------------------------------------ inventory */

/**
 * Collect the inventory the settings page renders.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {{dshHome?: string}} options - normalized Config.
 * @returns {Promise<object>} inventory payload.
 */
async function buildInventory(ctx, options) {
  const home = store.resolveDshHome(options.dshHome)
  const warnings = []
  const state = await store.readWorkspaceState(home)
  if (state.error !== undefined) warnings.push(state.error)
  if (!state.exists) warnings.push(`未找到工作区登记文件：${store.workspaceStatePath(home)}`)

  let workspaces = state.workspaces
  const registry = service(ctx, 'workspaceRegistry')
  if (registry !== null && typeof registry.list === 'function') {
    try {
      const list = await registry.list()
      workspaces = list.map((workspace) => ({
        id: String(workspace.id),
        title: typeof workspace.title === 'string' && workspace.title.trim() !== '' ? workspace.title.trim() : String(workspace.path ?? ''),
        path: typeof workspace.path === 'string' ? workspace.path : '',
        isDefault: String(workspace.id) === state.defaultWorkspaceId,
        sessionIds: [...workspace.sessionIds].map(String),
      }))
    } catch (error) {
      warnings.push(`工作区登记服务读取失败，已回退到磁盘快照：${messageOf(error)}`)
    }
  }

  const dirs = await store.scanSessionDirs(home)
  const projections = await store.scanProjectionFiles(home)
  const ids = new Set([...dirs.keys(), ...projections.keys()])
  for (const workspace of workspaces) for (const id of workspace.sessionIds) ids.add(id)
  const { titles, metas, emptyIds, promptIds } = await readSessionMeta(ctx, [...ids])
  const liveIds = liveSessionIds(ctx)

  const inventory = await store.buildInventory({
    home,
    workspaces,
    defaultWorkspaceId: state.defaultWorkspaceId,
    titles,
    metas,
    emptyIds,
    promptIds,
    liveIds,
    archivedIds: new Set(state.archivedSessionIds),
    pinnedIds: new Set(state.pinnedSessionIds),
    dirs,
    projections,
  })

  for (const workspace of inventory.workspaces) {
    if (workspace.path === '') {
      workspace.missing = true
      continue
    }
    try {
      const info = await stat(workspace.path)
      workspace.missing = !info.isDirectory()
    } catch {
      workspace.missing = true
    }
  }
  return { ...inventory, warnings: [...warnings, ...inventory.warnings] }
}

/**
 * Resolve conversation titles and lineage metadata from the session corpus.
 * Failure is non-fatal: the UI falls back to a placeholder title and treats
 * the conversation as a root.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {string[]} ids - conversation ids.
 * @returns {Promise<{titles: Map<string, string>, metas: Map<string, {parentSessionId?: string, origin?: string, delegationDepth?: number, agentPreset?: string}>, emptyIds: Set<string>, promptIds: Set<string>}>} folded metadata.
 */
async function readSessionMeta(ctx, ids) {
  const titles = new Map()
  const metas = new Map()
  const emptyIds = new Set()
  const promptIds = new Set()
  if (ids.length === 0) return { titles, metas, emptyIds, promptIds }
  const query = service(ctx, 'sessionQuery')
  if (query !== null && typeof query.readTitleSnapshots === 'function') {
    try {
      const results = await query.readTitleSnapshots(ids)
      for (const item of results ?? []) {
        // SessionTitleObservationResult: {sessionId, status, value: {session: SessionHeader, title?: SessionTitleSnapshot}}.
        // The id lives on the result itself; `value.session` is the whole header object, not an id.
        if (item?.status !== 'fulfilled') continue
        const value = item.value ?? {}
        const header = value.session !== null && typeof value.session === 'object' ? value.session : {}
        const id =
          typeof item.sessionId === 'string'
            ? item.sessionId
            : typeof header.id === 'string'
              ? header.id
              : typeof value.id === 'string'
                ? value.id
                : undefined
        if (id === undefined) continue
        const snapshot = value.title
        const title = typeof snapshot === 'string' ? snapshot : typeof snapshot?.title === 'string' ? snapshot.title : ''
        const clean = title.trim()
        if (clean !== '') titles.set(id, clean)
        const meta = headerMeta(header)
        if (meta !== undefined) metas.set(id, meta)
      }
    } catch {
      /* titles and lineage are cosmetic/best-effort */
    }
  }
  // `listSessions` also reports a header for conversations whose log cannot be folded.
  if (typeof query?.listSessions === 'function') {
    try {
      const records = await query.listSessions()
      for (const record of records ?? []) {
        const id = typeof record?.header?.id === 'string' ? record.header.id : undefined
        if (id === undefined || metas.has(id)) continue
        const meta = headerMeta(record.header)
        if (meta !== undefined) metas.set(id, meta)
      }
    } catch {
      /* lineage is best-effort */
    }
  }
  await fillUntitledConversations(query, ids, titles, emptyIds, promptIds)
  return { titles, metas, emptyIds, promptIds }
}

/**
 * Name conversations that never got a `session/title` event.
 *
 * Titles normally come from the folded title projection (the same name the DSH
 * sidebar shows). A conversation that was opened but never auto-summarised has
 * no title event; instead of showing a "未命名对话" placeholder, derive a name
 * from its first prompt. A conversation that never received any message at all
 * is reported through `emptyIds`, so the UI can call it an empty conversation
 * rather than an unnamed one.
 * @param {any} query - `sessionQuery` service, possibly undefined.
 * @param {string[]} ids - every conversation id in the inventory.
 * @param {Map<string, string>} titles - accumulator, filled in place.
 * @param {Set<string>} emptyIds - accumulator of conversations without any message.
 * @param {Set<string>} promptIds - accumulator of conversations named after their first prompt.
 * @returns {Promise<void>} resolves once every untitled conversation was tried.
 */
async function fillUntitledConversations(query, ids, titles, emptyIds, promptIds) {
  const pending = ids.filter((id) => !titles.has(id))
  if (pending.length === 0 || typeof query?.filterEvents !== 'function') return
  for (const id of pending) {
    try {
      const documents = await query.filterEvents(id, [{ kind: 'type', values: ['user/message'] }])
      const first = Array.isArray(documents) ? documents.find((document) => typeof document?.text === 'string' && document.text.trim() !== '') : undefined
      const derived = first === undefined ? '' : store.promptTitle(first.text)
      if (derived !== '') {
        titles.set(id, derived)
        promptIds.add(id)
      } else {
        emptyIds.add(id)
      }
    } catch {
      /* an unreadable log keeps the placeholder; nothing else to salvage */
    }
  }
}

/**
 * Extract lineage fields from one session header.
 * @param {any} header - `SessionHeader` (or anything shaped like it).
 * @returns {{parentSessionId?: string, origin?: string, delegationDepth?: number, agentPreset?: string, createdAt?: number} | undefined} lineage metadata.
 */
function headerMeta(header) {
  if (header === null || typeof header !== 'object') return undefined
  const parentSessionId = typeof header.parentSession === 'string' && header.parentSession !== '' ? header.parentSession : undefined
  const origin = header.origin === 'subagent' ? 'subagent' : undefined
  const delegationDepth = Number.isInteger(header.delegationDepth) ? header.delegationDepth : undefined
  const agentPreset = typeof header.agentPreset === 'string' && header.agentPreset !== '' ? header.agentPreset : undefined
  const createdAt = typeof header.createdAt === 'number' && Number.isFinite(header.createdAt) ? header.createdAt : undefined
  if (parentSessionId === undefined && origin === undefined && delegationDepth === undefined && agentPreset === undefined && createdAt === undefined) {
    return undefined
  }
  return { parentSessionId, origin, delegationDepth, agentPreset, createdAt }
}

/**
 * Ids of conversations that currently have a live host session.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @returns {Set<string>} live conversation ids.
 */
function liveSessionIds(ctx) {
  const live = new Set()
  const sessions = service(ctx, 'sessions')
  if (sessions === null || typeof sessions.list !== 'function') return live
  try {
    for (const entry of sessions.list() ?? []) live.add(String(entry?.id ?? entry))
  } catch {
    /* liveness badges are best-effort */
  }
  return live
}

/**
 * Index every inventory reference by id, nested sub-agent conversations included.
 * @param {object} inventory - payload from {@link buildInventory}.
 * @returns {Map<string, any>} id → reference.
 */
function collectSessionRefs(inventory) {
  const refs = new Map()
  const all = []
  for (const workspace of inventory.workspaces ?? []) all.push(...store.flattenSessionRefs(workspace.sessions ?? []))
  all.push(...store.flattenSessionRefs(inventory.orphans ?? []))
  for (const ref of all) if (!refs.has(ref.id)) refs.set(ref.id, ref)
  return refs
}

/* ------------------------------------------------------------------- deletion */

/**
 * Delete conversations (artifacts + registry detach).
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {{dshHome?: string}} options - normalized Config.
 * @param {string[]} sessionIds - conversations to delete.
 * @param {boolean} force - also delete conversations that are currently live.
 * @returns {Promise<{deleted: Array<object>, failures: Array<object>, warnings: string[], totals: {sessions: number, bytes: number}}>}
 */
async function deleteSessions(ctx, options, sessionIds, force) {
  const home = store.resolveDshHome(options.dshHome)
  const inventory = await buildInventory(ctx, options)
  const refs = collectSessionRefs(inventory)

  const deleted = []
  const failures = []
  const warnings = []
  const targets = []
  const seen = new Set()
  for (const id of sessionIds) {
    const ref = refs.get(id)
    if (ref === undefined) {
      failures.push({ id, error: '会话不在当前清单中（可能已被删除）' })
      continue
    }
    const nodes = store.flattenSubagentRefs([ref])
    for (const node of nodes) {
      if (seen.has(node.id)) continue
      seen.add(node.id)
      targets.push({ ref: node, viaSelection: node.id === id })
    }
    if (nodes.length > 1) {
      warnings.push(`「${ref.title || id}」下还有 ${nodes.length - 1} 个已归属的子 agent 对话，将一并删除。`)
    }
  }

  for (const { ref, viaSelection } of targets) {
    if (ref.live === true && !force) {
      failures.push({ id: ref.id, title: ref.title, error: '该会话正在运行，需要先确认强制删除', needsForce: true })
      continue
    }
    if (ref.live === true) {
      await stopLiveSession(ctx, ref.id)
      warnings.push('已尝试停止仍在运行的会话；若界面上仍显示该对话，请刷新页面。')
    }
    const outcome = await store.deleteSessionArtifacts(home, {
      sessionId: ref.id,
      entries: ref.artifacts,
      bytes: ref.bytes,
      projectDirs: ref.projectDirs,
    })
    const detach = await detachSessions(ctx, home, [ref.id])
    if (outcome.errors.length === 0) notifySessionsRemoved(ctx, [ref.id])
    const ok = outcome.errors.length === 0 && detach.ok
    const entry = {
      id: ref.id,
      title: ref.title,
      subagent: ref.subagent === true,
      fork: ref.fork === true,
      viaSelection,
      ok,
      bytes: outcome.bytes,
      removed: outcome.removed.map((item) => ({ path: item.path, kind: item.kind })),
      errors: [...outcome.errors.map((item) => `${item.path}: ${item.error}`), ...detach.errors],
    }
    if (ok) deleted.push(entry)
    else failures.push(entry)
  }
  return {
    deleted,
    failures,
    warnings,
    totals: { sessions: deleted.length, bytes: deleted.reduce((total, item) => total + item.bytes, 0) },
  }
}

/**
 * Delete workspaces together with every conversation they own.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {{dshHome?: string}} options - normalized Config.
 * @param {string[]} workspaceIds - workspace registrations to delete.
 * @param {boolean} force - also delete live conversations / the default workspace.
 * @returns {Promise<{deleted: Array<object>, failures: Array<object>, warnings: string[], totals: {workspaces: number, sessions: number, bytes: number}}>}
 */
async function deleteWorkspaces(ctx, options, workspaceIds, force) {
  const home = store.resolveDshHome(options.dshHome)
  const inventory = await buildInventory(ctx, options)
  const byId = new Map(inventory.workspaces.map((workspace) => [workspace.id, workspace]))
  const deleted = []
  const failures = []
  const warnings = []

  for (const id of workspaceIds) {
    const workspace = byId.get(id)
    if (workspace === undefined) {
      failures.push({ id, error: '工作区不在当前清单中（可能已被删除）' })
      continue
    }
    if (workspace.isDefault === true && !force) {
      failures.push({ id, title: workspace.title, error: '这是默认工作区，需要额外确认才能删除', needsForce: true })
      continue
    }
    const allSessions = store.flattenSessionRefs(workspace.sessions)
    const liveSessions = allSessions.filter((session) => session.live === true)
    if (liveSessions.length > 0 && !force) {
      failures.push({
        id,
        title: workspace.title,
        error: `该工作区有 ${liveSessions.length} 个会话正在运行，需要先确认强制删除`,
        needsForce: true,
      })
      continue
    }

    const sessionEntries = []
    const sessionErrors = []
    const removedSessionIds = []
    let bytes = 0
    for (const ref of allSessions) {
      if (ref.live === true) await stopLiveSession(ctx, ref.id)
      const outcome = await store.deleteSessionArtifacts(home, {
        sessionId: ref.id,
        entries: ref.artifacts,
        bytes: ref.bytes,
        projectDirs: ref.projectDirs,
      })
      bytes += outcome.bytes
      if (outcome.errors.length === 0) removedSessionIds.push(ref.id)
      sessionEntries.push({ id: ref.id, title: ref.title, subagent: ref.subagent === true, fork: ref.fork === true, removed: outcome.removed.length, bytes: outcome.bytes })
      for (const item of outcome.errors) sessionErrors.push(`${ref.id}: ${item.path}: ${item.error}`)
    }
    if (allSessions.some((session) => session.live === true)) {
      warnings.push(`工作区「${workspace.title}」中仍有运行中的会话；如界面未刷新，请手动刷新。`)
    }
    const detach = await detachSessions(ctx, home, allSessions.map((session) => session.id))
    const removal = await removeWorkspaceRegistration(ctx, home, id)
    notifySessionsRemoved(ctx, removedSessionIds)
    const ok = sessionErrors.length === 0 && detach.ok && removal.ok
    const entry = {
      id,
      title: workspace.title,
      ok,
      bytes,
      sessions: sessionEntries,
      errors: [...sessionErrors, ...detach.errors, ...(removal.ok ? [] : [removal.error])],
    }
    if (ok) deleted.push(entry)
    else failures.push(entry)
  }

  return {
    deleted,
    failures,
    warnings,
    totals: {
      workspaces: deleted.length,
      sessions: deleted.reduce((total, item) => total + item.sessions.length, 0),
      bytes: deleted.reduce((total, item) => total + item.bytes, 0),
    },
  }
}

/**
 * Delete whatever the caller checked, in one action: checked workspaces go away
 * with all their conversations, checked conversations go away on their own.
 * Conversations inside a checked workspace are not deleted twice.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {{dshHome?: string}} options - normalized Config.
 * @param {string[]} workspaceIds - checked workspaces.
 * @param {string[]} sessionIds - checked conversations.
 * @param {boolean} force - also delete live conversations / the default workspace.
 * @returns {Promise<{deleted: {workspaces: Array<object>, sessions: Array<object>}, failures: Array<object>, warnings: string[], totals: {workspaces: number, sessions: number, bytes: number}}>} outcome.
 */
async function deleteSelection(ctx, options, workspaceIds, sessionIds, force) {
  const inventory = await buildInventory(ctx, options)
  const byId = new Map(inventory.workspaces.map((workspace) => [workspace.id, workspace]))
  const covered = new Set()
  for (const id of workspaceIds) {
    const workspace = byId.get(id)
    if (workspace === undefined) continue
    for (const ref of store.flattenSessionRefs(workspace.sessions ?? [])) covered.add(ref.id)
  }
  const remaining = sessionIds.filter((id) => !covered.has(id))

  const workspaceResult =
    workspaceIds.length === 0
      ? { deleted: [], failures: [], warnings: [], totals: { workspaces: 0, sessions: 0, bytes: 0 } }
      : await deleteWorkspaces(ctx, options, workspaceIds, force)
  const sessionResult =
    remaining.length === 0
      ? { deleted: [], failures: [], warnings: [], totals: { sessions: 0, bytes: 0 } }
      : await deleteSessions(ctx, options, remaining, force)

  return {
    deleted: { workspaces: workspaceResult.deleted, sessions: sessionResult.deleted },
    failures: [...workspaceResult.failures, ...sessionResult.failures],
    warnings: [...new Set([...workspaceResult.warnings, ...sessionResult.warnings])],
    totals: {
      workspaces: workspaceResult.totals.workspaces,
      sessions: workspaceResult.totals.sessions + sessionResult.totals.sessions,
      bytes: workspaceResult.totals.bytes + sessionResult.totals.bytes,
    },
  }
}

/**
 * Ask the host to stop a live conversation before its log disappears.
 * Archive-with-stop is the public way to end activity; failures are ignored
 * because a still-open page simply recreates nothing important.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {string} sessionId - conversation id.
 */
async function stopLiveSession(ctx, sessionId) {
  const registry = service(ctx, 'workspaceRegistry')
  if (registry !== null && typeof registry.archiveSession === 'function') {
    try {
      await registry.archiveSession(sessionId, { stopActivity: true })
    } catch {
      /* fall through */
    }
  }
  const controller = service(ctx, 'sessionController')
  for (const call of [() => controller?.cancel?.({ sessionId }), () => controller?.cancel?.(sessionId)]) {
    try {
      await call()
      break
    } catch {
      /* try the next shape, then give up */
    }
  }
}

/**
 * Detach conversation ids from every workspace registration.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {string} home - DSH home directory.
 * @param {string[]} sessionIds - conversations to detach.
 * @returns {Promise<{ok: boolean, errors: string[]}>} outcome.
 */
async function detachSessions(ctx, home, sessionIds) {
  if (sessionIds.length === 0) return { ok: true, errors: [] }
  const errors = []
  const registry = service(ctx, 'workspaceRegistry')
  if (registry !== null && typeof registry.list === 'function') {
    try {
      const list = await registry.list()
      for (const workspace of list) {
        const owned = new Set([...workspace.sessionIds].map(String))
        for (const id of sessionIds) {
          if (!owned.has(id) || typeof workspace.detachSession !== 'function') continue
          try {
            await workspace.detachSession(id)
          } catch (error) {
            errors.push(`分离会话 ${id} 失败：${messageOf(error)}`)
          }
        }
      }
    } catch (error) {
      errors.push(`读取工作区登记失败：${messageOf(error)}`)
    }
    for (const id of sessionIds) {
      for (const method of ['unarchiveSession', 'unpinSession']) {
        if (typeof registry[method] !== 'function') continue
        try {
          await registry[method](id)
        } catch {
          /* id was probably not archived/pinned */
        }
      }
    }
    return { ok: errors.length === 0, errors }
  }
  const state = await store.readWorkspaceState(home)
  if (state.raw === undefined) return { ok: false, errors: ['无法读取工作区登记文件，会话已从磁盘删除但登记未更新'] }
  try {
    await store.writeWorkspaceState(home, store.removeSessionsFromState(state.raw, sessionIds))
    return { ok: true, errors }
  } catch (error) {
    return { ok: false, errors: [...errors, `写回工作区登记失败：${messageOf(error)}`] }
  }
}

/**
 * Tell the running Client that these conversations left the Host catalog.
 *
 * Deleting the log and detaching the registration is invisible to a Client that
 * already listed the conversation: its row would stay rendered while no workspace
 * claims it any more, so the sidebar shows it under 「未分组」 until the next
 * restart refetches the list. `api-session/removed` is the shipped forwarded
 * Remote event for exactly this transition, so replaying it makes the Client drop
 * the row immediately. Best effort by design — a missing emitter must never turn
 * a completed deletion into a failure.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {string[]} sessionIds - conversations that no longer exist on disk.
 */
function notifySessionsRemoved(ctx, sessionIds) {
  for (const sessionId of sessionIds) {
    try {
      ctx.emit('api-session/removed', sessionId)
    } catch {
      /* the log is already gone; a stale Client row is not worth failing the request */
    }
  }
}

/**
 * Remove one workspace registration (its conversations are already gone).
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {string} home - DSH home directory.
 * @param {string} workspaceId - workspace id.
 * @returns {Promise<{ok: boolean, error?: string}>} outcome.
 */
async function removeWorkspaceRegistration(ctx, home, workspaceId) {
  const registry = service(ctx, 'workspaceRegistry')
  if (registry !== null && typeof registry.delete === 'function') {
    try {
      const removed = await registry.delete(workspaceId)
      if (removed === false) return { ok: false, error: '工作区登记不存在' }
      return { ok: true }
    } catch (error) {
      return { ok: false, error: `删除工作区登记失败：${messageOf(error)}` }
    }
  }
  const state = await store.readWorkspaceState(home)
  if (state.raw === undefined) return { ok: false, error: '无法读取工作区登记文件' }
  try {
    await store.writeWorkspaceState(home, store.removeWorkspacesFromState(state.raw, [workspaceId]))
    return { ok: true }
  } catch (error) {
    return { ok: false, error: `写回工作区登记失败：${messageOf(error)}` }
  }
}

/* ---------------------------------------------------------------- http plumbing */

/**
 * Resolve an optional Host service without throwing.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {string} key - service key.
 * @returns {any} the service, or null when unavailable.
 */
function service(ctx, key) {
  try {
    return ctx.get(key) ?? null
  } catch {
    return null
  }
}

/**
 * Accept only loopback, same-origin callers. Deleting conversations is
 * irreversible, so a page on the public internet must never reach this route.
 * The desktop renderer origin is `dsh-app://127.0.0.1:<port>`, so protocol
 * equality is deliberately not required.
 * @param {import('node:http').IncomingMessage} req - request.
 * @returns {boolean} whether the caller is trusted.
 */
function trusted(req) {
  const address = req.socket?.remoteAddress ?? ''
  const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
  if (!loopback.has(address)) return false
  const rawHost = typeof req.headers.host === 'string' ? req.headers.host : ''
  let hostUrl
  try {
    hostUrl = new URL(`http://${rawHost}`)
  } catch {
    return false
  }
  const hostNames = new Set(['127.0.0.1', '::1', 'localhost', '[::1]'])
  if (!hostNames.has(hostUrl.hostname)) return false
  if (String(req.headers['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') return false
  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin === '') return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** Write a JSON response with no caching. */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

/**
 * Read and parse a small JSON request body.
 * @param {import('node:http').IncomingMessage} req - request.
 * @returns {Promise<any>} parsed body (an empty body parses as `{}`).
 */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) unprocessable('请求体过大', 413)
    chunks.push(chunk)
  }
  if (size === 0) return {}
  let parsed
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    unprocessable('请求体不是合法 JSON', 400)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) unprocessable('请求体必须是 JSON 对象', 400)
  return parsed
}

/**
 * Validate an id list from a request body.
 * @param {any} body - parsed request body.
 * @param {string} field - field name.
 * @returns {string[]} deduplicated safe ids.
 */
function requireIds(body, field) {
  const value = body?.[field]
  if (!Array.isArray(value) || value.length === 0) unprocessable(`字段 ${field} 必须是非空数组`, 400)
  return normalizeIds(value, field)
}

/**
 * Validate an id list that may legitimately be absent or empty (pure).
 *
 * `/delete` carries two independent lists and either may be empty — deleting an
 * empty workspace sends `sessionIds: []`, which must not be rejected as an
 * invalid empty array. Presence of at least one id across both lists is checked
 * by the caller.
 * @param {any} body - parsed request body.
 * @param {string} field - field name.
 * @returns {string[]} deduplicated safe ids, empty when absent.
 */
function optionalIds(body, field) {
  const value = body?.[field]
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) unprocessable(`字段 ${field} 必须是数组`, 400)
  if (value.length === 0) return []
  return normalizeIds(value, field)
}

/**
 * Validate and deduplicate one non-empty id array.
 * @param {any[]} value - array from the request body.
 * @param {string} field - field name, used in the error message.
 * @returns {string[]} deduplicated safe ids.
 */
function normalizeIds(value, field) {
  if (value.length > MAX_IDS) unprocessable(`一次最多清理 ${MAX_IDS} 项`, 400)
  const ids = []
  for (const item of value) {
    if (typeof item !== 'string' || !store.isSafeId(item)) unprocessable(`字段 ${field} 含有非法 id`, 400)
    ids.push(item)
  }
  return [...new Set(ids)]
}

/** Throw an HTTP-shaped error. */
function unprocessable(message, status) {
  const error = new Error(message)
  error.status = status
  throw error
}

/** Error message helper. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
