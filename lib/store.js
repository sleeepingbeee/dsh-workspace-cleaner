/**
 * @module dsh-workspace-cleaner/store
 *
 * Cordis-free helpers for the Workspace Cleaner plugin.
 *
 * Everything here takes an explicit DSH home directory and only reads/writes
 * paths below it, so the module can be exercised against a throwaway sandbox
 * (`DSH_HOME` pointed at a temp directory) without touching real state.
 *
 * What a conversation (session) owns on disk:
 *   <home>/sessions/<projectKey>/<encodeSegment(sessionId)>/session.v4.jsonl.zstd
 *   <home>/storages/session_projcache/sessions/<sessionId>.json   (+ .bak.*)
 * Attachments live in a shared content-addressed store and are intentionally
 * left alone: one object may be referenced by many conversations.
 */
import { readdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Environment variable that overrides the DSH home directory. */
export const DSH_HOME_ENV = 'DSH_HOME'
/** File name of a session log inside its session directory. */
export const SESSION_LOG_FILE = 'session.v4.jsonl.zstd'
/** Workspace registry document, relative to the DSH home. */
export const WORKSPACE_STATE_FILE = join('storages', 'workspace.json')
/** Projection-cache record directory, relative to the DSH home. */
export const PROJECTION_CACHE_DIR = join('storages', 'session_projcache', 'sessions')
/** Session log root, relative to the DSH home. */
export const SESSIONS_ROOT = 'sessions'

const SAFE_CHARACTER = /^[\w.-]$/u
const SAFE_ID = /^[\w.-]{1,200}$/u

/** True when `value` is a non-blank string, after trimming. */
function filled(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** True when a filesystem error means "not there". */
function isMissing(error) {
  const code = error?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/**
 * Resolve the DSH home directory.
 * Precedence mirrors `@deepseek-ai/dsh-home-paths`: an explicit configured
 * path, then `$DSH_HOME`, then `~/.dsh`.
 * @param {string | undefined} configured - explicit path from plugin Config.
 * @param {Record<string, string | undefined>} [env] - environment mapping.
 * @returns {string} absolute path.
 */
export function resolveDshHome(configured, env = process.env) {
  const explicit = filled(configured)
  if (explicit !== undefined) return resolve(explicit)
  const fromEnvironment = filled(env?.[DSH_HOME_ENV])
  if (fromEnvironment !== undefined) return resolve(fromEnvironment)
  return resolve(join(homedir(), '.dsh'))
}

/** Longest prompt-derived title kept by {@link promptTitle}. */
export const PROMPT_TITLE_MAX_CHARS = 48

/**
 * Build a readable conversation name from its first prompt (pure).
 *
 * Used only when the log carries no `session/title` event, so a conversation
 * that was started but never auto-summarised still shows a recognizable name
 * instead of a placeholder. Markdown noise, code fences, blank lines and extra
 * whitespace are normalized away, and the result is clipped on a UTF-16 safe
 * boundary.
 * @param {unknown} input - first user message text.
 * @param {number} [maxChars] - maximum character count.
 * @returns {string} one-line title, empty when nothing usable remains.
 */
export function promptTitle(input, maxChars = PROMPT_TITLE_MAX_CHARS) {
  if (typeof input !== 'string') return ''
  const words = input
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/^[\s>]*(?:[-+*]|\d+[.)])\s+/gmu, ' ')
    .replace(/[#>*_`~[\]()]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  if (words === '') return ''
  const limit = Number.isInteger(maxChars) && maxChars > 0 ? maxChars : PROMPT_TITLE_MAX_CHARS
  return words.length <= limit ? words : `${words.slice(0, limit - 1).trimEnd()}…`
}

/**
 * Encode one path segment the way `dsh-session-persistence-jsonl` does:
 * `.` / `..` become `~002E` / `~002E~002E`, `[A-Za-z0-9._-]` pass through,
 * every other UTF-16 code unit becomes `~` plus four upper-case hex digits.
 * @param {string} raw - logical segment value (here: a session id).
 * @returns {string} filesystem-safe segment.
 */
export function encodeSegment(raw) {
  const value = String(raw)
  if (value === '.') return '~002E'
  if (value === '..') return '~002E~002E'
  let out = ''
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (SAFE_CHARACTER.test(character)) {
      out += character
    } else {
      out += `~${value.charCodeAt(index).toString(16).toUpperCase().padStart(4, '0')}`
    }
  }
  return out
}

/**
 * Inverse of {@link encodeSegment} for ids that are already on disk.
 * Ambiguity is not a concern here: session ids are `session-<uuid>` / `<uuid>`.
 * @param {string} segment - encoded directory name.
 * @returns {string} decoded logical value.
 */
export function decodeSegment(segment) {
  return String(segment).replace(/~([0-9A-Fa-f]{4})/gu, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
}

/**
 * Derive the project directory key for one working directory.
 * `/`, `\` and `:` collapse to a single `-`; unsafe characters become `~XXXX`.
 * @param {string} cwd - working directory path.
 * @returns {string} one directory name (never contains separators).
 */
export function projectKey(cwd) {
  const raw = String(cwd)
  let readable = ''
  let separatorPending = false
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index]
    if (character === '/' || character === '\\' || character === ':') {
      if (!separatorPending) {
        readable += '-'
        separatorPending = true
      }
      continue
    }
    separatorPending = false
    if (SAFE_CHARACTER.test(character)) {
      readable += character
    } else {
      readable += `~${raw.charCodeAt(index).toString(16).toUpperCase().padStart(4, '0')}`
    }
  }
  const trimmed = readable.replace(/^-+/u, '') || 'root'
  return `--${trimmed.slice(0, 251)}--`
}

/** True when an id is safe to embed in a path segment. */
export function isSafeId(id) {
  return typeof id === 'string' && SAFE_ID.test(id) && id !== '.' && id !== '..'
}

/** Absolute workspace-registry path for one home. */
export function workspaceStatePath(home) {
  return join(home, WORKSPACE_STATE_FILE)
}

/** Absolute projection-cache record directory for one home. */
export function projectionCachePath(home) {
  return join(home, PROJECTION_CACHE_DIR)
}

/** Absolute session log root for one home. */
export function sessionsRoot(home) {
  return join(home, SESSIONS_ROOT)
}

/**
 * Guard that a resolved path really lives below the DSH home.
 * @param {string} home - DSH home directory.
 * @param {string} target - candidate path.
 * @returns {string} the resolved target.
 */
export function assertInside(home, target) {
  const root = resolve(home)
  const candidate = resolve(target)
  const rel = relative(root, candidate)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
    const error = new Error(`refusing to touch a path outside the DSH home: ${candidate}`)
    error.code = 'OUTSIDE_HOME'
    throw error
  }
  return candidate
}

/** Recursively sum the size of one directory or file, tolerating races. */
async function sizeOf(target) {
  let info
  try {
    info = await stat(target)
  } catch (error) {
    if (isMissing(error)) return 0
    return 0
  }
  if (info.isFile()) return info.size
  if (!info.isDirectory()) return 0
  let total = 0
  let entries
  try {
    entries = await readdir(target, { withFileTypes: true })
  } catch {
    return total
  }
  for (const entry of entries) total += await sizeOf(join(target, entry.name))
  return total
}

/**
 * Read and summarize the workspace registry document.
 * A missing document is reported, not thrown.
 * @param {string} home - DSH home directory.
 * @returns {Promise<{file: string, exists: boolean, error?: string, raw?: object, defaultWorkspaceId?: string, workspaces: Array<{id: string, title: string, path: string, sessionIds: string[], isDefault: boolean}>, archivedSessionIds: string[], pinnedSessionIds: string[]}>}
 */
export async function readWorkspaceState(home) {
  const file = workspaceStatePath(home)
  const empty = { file, exists: false, workspaces: [], archivedSessionIds: [], pinnedSessionIds: [] }
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (isMissing(error)) return empty
    return { ...empty, error: error instanceof Error ? error.message : String(error) }
  }
  let raw
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { ...empty, exists: true, error: `workspace.json 不是合法 JSON：${error instanceof Error ? error.message : String(error)}` }
  }
  return { file, exists: true, raw, ...summarizeWorkspaceState(raw) }
}

/** @typedef {{id: string, title: string, path: string, sessionIds: string[], isDefault: boolean}} WorkspaceSummary */

/**
 * Normalize a raw `workspace.json` document.
 * Stored order is preserved; rows present in the table but missing from
 * `global.workspaceIds` are appended so nothing silently disappears from the UI.
 * @param {any} raw - parsed document.
 * @returns {{defaultWorkspaceId?: string, workspaces: WorkspaceSummary[], archivedSessionIds: string[], pinnedSessionIds: string[]}}
 */
export function summarizeWorkspaceState(raw) {
  const global = raw?.global ?? {}
  const table = raw?.tables?.workspaces ?? {}
  const defaultWorkspaceId = typeof global.defaultWorkspaceId === 'string' ? global.defaultWorkspaceId : undefined
  const order = []
  const seen = new Set()
  for (const id of Array.isArray(global.workspaceIds) ? global.workspaceIds : []) {
    if (typeof id === 'string' && !seen.has(id)) {
      seen.add(id)
      order.push(id)
    }
  }
  for (const id of Object.keys(table)) {
    if (!seen.has(id)) {
      seen.add(id)
      order.push(id)
    }
  }
  const workspaces = order.map((id) => {
    const row = table[id] ?? {}
    const path = typeof row.path === 'string' ? row.path : ''
    const title = typeof row.title === 'string' && row.title.trim() !== '' ? row.title.trim() : path
    return {
      id,
      title,
      path,
      sessionIds: Array.isArray(row.sessionIds) ? row.sessionIds.filter((sessionId) => typeof sessionId === 'string') : [],
      isDefault: id === defaultWorkspaceId,
    }
  })
  const strings = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [])
  return {
    defaultWorkspaceId,
    workspaces,
    archivedSessionIds: strings(global.archivedSessionIds),
    pinnedSessionIds: strings(global.pinnedSessionIds),
  }
}

/**
 * Scan every session directory below the home.
 * @param {string} home - DSH home directory.
 * @returns {Promise<Map<string, string[]>>} session id → absolute session directories.
 */
export async function scanSessionDirs(home) {
  const found = new Map()
  const root = sessionsRoot(home)
  let projects
  try {
    projects = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (isMissing(error)) return found
    throw error
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const projectDir = join(root, project.name)
    let entries
    try {
      entries = await readdir(projectDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const sessionId = decodeSegment(entry.name)
      const list = found.get(sessionId) ?? []
      list.push(join(projectDir, entry.name))
      found.set(sessionId, list)
    }
  }
  return found
}

/**
 * Scan projection-cache records below the home (including `.bak.*` siblings).
 * @param {string} home - DSH home directory.
 * @returns {Promise<Map<string, string[]>>} session id → absolute cache files.
 */
export async function scanProjectionFiles(home) {
  const found = new Map()
  const root = projectionCachePath(home)
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (isMissing(error)) return found
    throw error
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const match = /^(.+?)\.json(?:\.bak\..*)?$/u.exec(entry.name)
    if (match === null) continue
    const sessionId = match[1]
    const list = found.get(sessionId) ?? []
    list.push(join(root, entry.name))
    found.set(sessionId, list)
  }
  return found
}

/**
 * Build a removal plan for one conversation.
 * @param {{home: string, sessionId: string, dirs?: Map<string, string[]>, projections?: Map<string, string[]>}} input
 * @returns {Promise<{sessionId: string, entries: Array<{path: string, kind: string, bytes: number}>, bytes: number, projectDirs: string[]}>}
 */
export async function planSessionRemoval({ home, sessionId, dirs, projections }) {
  const entries = []
  const projectDirs = new Set()
  for (const directory of dirs?.get(sessionId) ?? []) {
    entries.push({ path: assertInside(home, directory), kind: '会话目录', bytes: await sizeOf(directory) })
    projectDirs.add(dirname(directory))
  }
  for (const file of projections?.get(sessionId) ?? []) {
    entries.push({ path: assertInside(home, file), kind: '投影缓存', bytes: await sizeOf(file) })
  }
  const bytes = entries.reduce((total, entry) => total + entry.bytes, 0)
  return { sessionId, entries, bytes, projectDirs: [...projectDirs] }
}

/**
 * Remove one conversation's artifacts.
 * @param {string} home - DSH home directory.
 * @param {Awaited<ReturnType<typeof planSessionRemoval>>} plan - removal plan.
 * @returns {Promise<{sessionId: string, removed: Array<{path: string, kind: string, bytes: number}>, bytes: number, errors: Array<{path: string, error: string}>, pruned: string[]}>}
 */
export async function deleteSessionArtifacts(home, plan) {
  const removed = []
  const errors = []
  for (const entry of plan.entries) {
    try {
      assertInside(home, entry.path)
      await rm(entry.path, { recursive: true, force: true })
      removed.push(entry)
    } catch (error) {
      errors.push({ path: entry.path, error: error instanceof Error ? error.message : String(error) })
    }
  }
  const pruned = []
  for (const directory of plan.projectDirs) {
    try {
      assertInside(home, directory)
      const rest = await readdir(directory)
      if (rest.length === 0) {
        await rmdir(directory)
        pruned.push(directory)
      }
    } catch {
      /* a shared project directory with other sessions stays */
    }
  }
  return {
    sessionId: plan.sessionId,
    removed,
    bytes: removed.reduce((total, entry) => total + entry.bytes, 0),
    errors,
    pruned,
  }
}

/** Recursive clone of a plain JSON document. */
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

/** Deduplicate a list of strings. */
function unique(values) {
  return [...new Set(values)]
}

/**
 * Remove conversations from the registry document (pure).
 * Detaches each id from every workspace and from the archived/pinned lists.
 * @param {any} raw - parsed `workspace.json`.
 * @param {string[]} sessionIds - conversations to detach.
 * @returns {any} a new document; the input is not mutated.
 */
export function removeSessionsFromState(raw, sessionIds) {
  const drop = new Set(sessionIds)
  const next = cloneJson(raw ?? {})
  next.global = next.global ?? {}
  next.global.archivedSessionIds = (Array.isArray(next.global.archivedSessionIds) ? next.global.archivedSessionIds : []).filter((id) => !drop.has(id))
  next.global.pinnedSessionIds = (Array.isArray(next.global.pinnedSessionIds) ? next.global.pinnedSessionIds : []).filter((id) => !drop.has(id))
  const table = next.tables?.workspaces
  if (table !== null && typeof table === 'object') {
    for (const row of Object.values(table)) {
      if (row === null || typeof row !== 'object') continue
      if (Array.isArray(row.sessionIds)) row.sessionIds = row.sessionIds.filter((id) => !drop.has(id))
    }
  }
  return next
}

/**
 * Remove workspace registrations from the registry document (pure).
 * Conversations are NOT reattached anywhere: callers delete their artifacts.
 * @param {any} raw - parsed `workspace.json`.
 * @param {string[]} workspaceIds - registrations to drop.
 * @returns {any} a new document; the input is not mutated.
 */
export function removeWorkspacesFromState(raw, workspaceIds) {
  const drop = new Set(workspaceIds)
  const next = cloneJson(raw ?? {})
  next.global = next.global ?? {}
  next.global.workspaceIds = (Array.isArray(next.global.workspaceIds) ? next.global.workspaceIds : []).filter((id) => !drop.has(id))
  const table = next.tables?.workspaces
  if (table !== null && typeof table === 'object') {
    for (const id of drop) delete table[id]
  }
  if (typeof next.global.defaultWorkspaceId === 'string' && drop.has(next.global.defaultWorkspaceId)) {
    delete next.global.defaultWorkspaceId
  }
  return next
}

/**
 * Atomically replace the workspace registry document.
 * The host process keeps its own in-memory copy, so prefer the registry service
 * at runtime; this writer exists for sandboxes and for repair paths.
 * @param {string} home - DSH home directory.
 * @param {any} raw - document to persist.
 * @returns {Promise<string>} the written path.
 */
export async function writeWorkspaceState(home, raw) {
  const file = workspaceStatePath(home)
  const temporary = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`
  await writeFile(temporary, `${JSON.stringify(raw, null, 2)}\n`, 'utf8')
  await rename(temporary, file)
  return file
}

/** Deepest lineage depth followed before a conversation is treated as a root. */
const MAX_LINEAGE = 64

/**
 * Resolve workspace ownership and nesting for every conversation (pure).
 *
 * A conversation is owned by the workspace that lists it; when it is not
 * listed anywhere (sub-agent conversations never are), ownership is inherited
 * from the nearest ancestor. That is what makes a sub-agent conversation show
 * up inside the conversation that spawned it, labelled as such, instead of
 * appearing as an unassigned leftover.
 *
 * A forked conversation is a full, independently registered conversation whose
 * header also names the source conversation. It is a child of that source for
 * display only — never a sub-agent and never deleted along with its source — so
 * it nests under the source only while both stay in the same workspace.
 *
 * @param {Map<string, any>} refs - id → reference; entries gain `children`,
 *   `depth`, `rootId`, `ownerWorkspaceId`, `subagent` and `fork`.
 * @returns {{roots: any[], orphans: any[]}} top-level nodes, and the ones no workspace owns.
 */
export function resolveSessionOwnership(refs) {
  const resolved = new Map()

  /** Resolve one id, following `parentSession` links upwards. */
  const walk = (id, visiting) => {
    const cached = resolved.get(id)
    if (cached !== undefined) return cached
    const ref = refs.get(id)
    if (ref === undefined || visiting.has(id)) return undefined
    visiting.add(id)
    const directOwner = ref.workspaceIds.length > 0 ? ref.workspaceIds[0] : undefined
    const parentId = ref.parentSessionId !== undefined && ref.parentSessionId !== id ? ref.parentSessionId : undefined
    const upstream = parentId === undefined || !refs.has(parentId) ? undefined : walk(parentId, visiting)
    visiting.delete(id)
    const node =
      upstream === undefined
        ? { ownerWorkspaceId: directOwner, rootId: id, depth: 1 }
        : {
            ownerWorkspaceId: directOwner ?? upstream.ownerWorkspaceId,
            rootId: upstream.rootId,
            depth: Math.min(upstream.depth + 1, MAX_LINEAGE),
          }
    resolved.set(id, node)
    return node
  }

  for (const id of refs.keys()) walk(id, new Set())

  for (const [id, ref] of refs) {
    const node = resolved.get(id) ?? { ownerWorkspaceId: undefined, rootId: id, depth: 1 }
    ref.ownerWorkspaceId = node.ownerWorkspaceId
    ref.rootId = node.rootId
    ref.depth = node.depth
    ref.children = []
    const parentId = ref.parentSessionId
    const hasKnownParent = parentId !== undefined && parentId !== id && refs.has(parentId)
    // Only `origin: 'subagent'` means sub-agent. A fork carries a `parentSession`
    // header without that origin, and must stay an independent conversation.
    ref.subagent = ref.origin === 'subagent'
    ref.fork = ref.subagent !== true && hasKnownParent
  }

  // Attach every conversation to its parent; ids whose parent is unknown stay roots.
  // A sub-agent conversation is always nested. A forked conversation is nested for
  // display, but only while it lives in the same workspace as its source — when the
  // two workspaces differ the fork stays a root in its own workspace so it cannot
  // vanish from the workspace that actually lists it.
  const attached = new Set()
  for (const ref of refs.values()) {
    const parentId = ref.parentSessionId
    if (parentId === undefined || parentId === ref.id) continue
    const parent = refs.get(parentId)
    if (parent === undefined) continue
    if (ref.subagent === true && ref.workspaceIds.length > 0) continue
    if (ref.fork === true && ref.workspaceIds.length > 0 && ref.ownerWorkspaceId !== parent.ownerWorkspaceId) continue
    parent.children.push(ref)
    attached.add(ref.id)
  }

  const roots = [...refs.values()].filter((ref) => !attached.has(ref.id))
  const orphanRoots = roots.filter((ref) => ref.ownerWorkspaceId === undefined && ref.exists === true)
  return { roots, orphans: orphanRoots }
}

/**
 * Flatten session references into themselves plus every descendant (pre-order).
 * @param {readonly any[]} nodes - top-level references, each carrying `children`.
 * @returns {any[]} flattened references.
 */
export function flattenSessionRefs(nodes) {
  const out = []
  const visit = (node) => {
    out.push(node)
    for (const child of node.children ?? []) visit(child)
  }
  for (const node of nodes ?? []) visit(node)
  return out
}

/**
 * Flatten session references into themselves plus the descendants they own.
 *
 * Only sub-agent conversations belong to their parent's lifecycle: deleting a
 * conversation deletes the sub-agents it spawned, but never a fork, because a
 * fork is an independent conversation with its own registration and history.
 *
 * @param {readonly any[]} nodes - top-level references, each carrying `children`.
 * @returns {any[]} flattened references joined through sub-agent edges only.
 */
export function flattenSubagentRefs(nodes) {
  const out = []
  const visit = (node) => {
    out.push(node)
    for (const child of node.children ?? []) if (child.subagent === true) visit(child)
  }
  for (const node of nodes ?? []) visit(node)
  return out
}

/**
 * Order conversation trees newest first (pure, returns a new array).
 * Conversations without a timestamp (log unreadable or header missing) sink to
 * the bottom, ordered by id so the list stays stable between refreshes.
 * @param {readonly any[]} nodes - top-level references, each carrying `children`.
 * @returns {any[]} the same references in time order, children sorted too.
 */
export function sortSessionRefsByTime(nodes) {
  const time = (ref) => (typeof ref.createdAt === 'number' && Number.isFinite(ref.createdAt) ? ref.createdAt : Number.NEGATIVE_INFINITY)
  const sorted = [...(nodes ?? [])].sort((left, right) => time(right) - time(left) || String(left.id).localeCompare(String(right.id)))
  for (const node of sorted) node.children = sortSessionRefsByTime(node.children ?? [])
  return sorted
}

/**
 * Assemble the inventory shown by the settings page.
 * @param {{home: string, workspaces: WorkspaceSummary[], defaultWorkspaceId?: string, titles?: Map<string, string>, metas?: Map<string, {parentSessionId?: string, origin?: string, delegationDepth?: number, agentPreset?: string}>, emptyIds?: Set<string>, promptIds?: Set<string>, liveIds?: Set<string>, archivedIds?: Set<string>, pinnedIds?: Set<string>, dirs?: Map<string, string[]>, projections?: Map<string, string[]>, currentSessionId?: string}} input
 * @returns {Promise<object>} inventory payload.
 */
export async function buildInventory({ home, workspaces, defaultWorkspaceId, titles = new Map(), metas = new Map(), emptyIds = new Set(), promptIds = new Set(), liveIds = new Set(), archivedIds = new Set(), pinnedIds = new Set(), dirs, projections, currentSessionId }) {
  const sessionDirs = dirs ?? (await scanSessionDirs(home))
  const projectionFiles = projections ?? (await scanProjectionFiles(home))
  const known = new Set([...sessionDirs.keys(), ...projectionFiles.keys(), ...titles.keys(), ...metas.keys()])
  for (const workspace of workspaces) for (const id of workspace.sessionIds) known.add(id)
  const references = new Map()
  for (const workspace of workspaces) {
    for (const id of workspace.sessionIds) {
      const list = references.get(id) ?? []
      list.push(workspace.id)
      references.set(id, list)
    }
  }
  const sessionRefs = new Map()
  for (const id of known) {
    const plans = await planSessionRemoval({ home, sessionId: id, dirs: sessionDirs, projections: projectionFiles })
    const meta = metas.get(id) ?? {}
    sessionRefs.set(id, {
      id,
      title: titles.get(id) ?? '',
      empty: emptyIds.has(id),
      titleFromPrompt: promptIds.has(id),
      live: liveIds.has(id),
      current: currentSessionId === id,
      archived: archivedIds.has(id),
      pinned: pinnedIds.has(id),
      exists: plans.entries.length > 0,
      bytes: plans.bytes,
      artifacts: plans.entries,
      workspaceIds: [...new Set(references.get(id) ?? [])],
      projectDirs: plans.projectDirs,
      parentSessionId: typeof meta.parentSessionId === 'string' && meta.parentSessionId !== '' ? meta.parentSessionId : undefined,
      origin: meta.origin === 'subagent' ? 'subagent' : undefined,
      delegationDepth: Number.isInteger(meta.delegationDepth) ? meta.delegationDepth : undefined,
      agentPreset: typeof meta.agentPreset === 'string' && meta.agentPreset !== '' ? meta.agentPreset : undefined,
      createdAt: typeof meta.createdAt === 'number' && Number.isFinite(meta.createdAt) ? meta.createdAt : undefined,
    })
  }

  const ownership = resolveSessionOwnership(sessionRefs)
  const roots = sortSessionRefsByTime(ownership.roots)
  const orphans = sortSessionRefsByTime(ownership.orphans)
  const workspaceNodes = workspaces.map((workspace) => {
    const sessions = roots.filter((ref) => ref.ownerWorkspaceId === workspace.id)
    const all = flattenSessionRefs(sessions)
    const bytes = all.reduce((total, ref) => total + ref.bytes, 0)
    return {
      id: workspace.id,
      title: workspace.title,
      path: workspace.path,
      isDefault: workspace.isDefault || workspace.id === defaultWorkspaceId,
      missing: false,
      sessionCount: all.length,
      rootSessionCount: sessions.length,
      subagentCount: all.filter((ref) => ref.subagent === true).length,
      forkCount: all.filter((ref) => ref.fork === true).length,
      bytes,
      sessions,
    }
  })

  const uniqueSessions = new Map()
  for (const ref of sessionRefs.values()) if (ref.exists) uniqueSessions.set(ref.id, ref)
  const orphanSessions = flattenSessionRefs(orphans).filter((ref) => ref.exists === true)
  const warnedOrphans = orphanSessions.filter((ref) => ref.subagent === true && refsHaveMissingParent(ref, sessionRefs))
  const warnings = []
  if (uniqueSessions.size !== sessionRefs.size) {
    warnings.push('部分会话记录只有登记信息、磁盘文件已不存在：仍可勾选清理登记。')
  }
  if (warnedOrphans.length > 0) {
    warnings.push(`有 ${warnedOrphans.length} 个子 agent 对话的父对话记录已不存在，只能单独列出。`)
  }
  if (orphanSessions.some((ref) => ref.subagent !== true)) {
    warnings.push('未归属工作区的对话没有工作区登记，无法自动归到某个主对话下。')
  }
  return {
    home,
    generatedAt: new Date().toISOString(),
    defaultWorkspaceId,
    workspaces: workspaceNodes,
    orphans,
    totals: {
      workspaces: workspaceNodes.length,
      sessions: uniqueSessions.size,
      orphanSessions: orphanSessions.length,
      subagentSessions: [...uniqueSessions.values()].filter((ref) => ref.subagent === true).length,
      forkSessions: [...uniqueSessions.values()].filter((ref) => ref.fork === true).length,
      bytes: [...uniqueSessions.values()].reduce((total, ref) => total + ref.bytes, 0),
    },
    warnings,
  }
}

/** True when a reference names a parent that is absent from the inventory. */
function refsHaveMissingParent(ref, sessionRefs) {
  return ref.parentSessionId !== undefined && !sessionRefs.has(ref.parentSessionId)
}
