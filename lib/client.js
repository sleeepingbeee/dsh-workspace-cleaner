/**
 * @module dsh-workspace-cleaner/client
 *
 * Client half: a settings page that lists every workspace and conversation
 * with checkboxes and deletes the checked items through the Host route
 * `/api/workspace-cleaner/*`.
 */
window.__ModuleLoader__.load({
  id: 'dsh-workspace-cleaner',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const mod = { exports: {} }
    const PLUGIN_ID = 'workspace-cleaner'
    const API = '/api/workspace-cleaner'
    const NS = 'workspace-cleaner'

    const STRINGS = {
      zh: {
        nav: '工作区清理',
        title: '工作区与对话清理',
        subtitle: '勾选要删除的工作区或对话，删除后记录、日志与缓存一并清除，无法恢复。',
        refresh: '刷新',
        reloading: '正在读取…',
        totalWorkspaces: '个工作区',
        totalSessions: '个对话',
        totalSize: '占用',
        orphans: '未归属工作区的对话',
        noOrphans: '没有未归属的对话',
        empty: '还没有任何工作区。',
        defaultBadge: '默认',
        missingBadge: '目录缺失',
        liveBadge: '运行中',
        archivedBadge: '已归档',
        pinnedBadge: '已置顶',
        noFileBadge: '无本地文件',
        untitled: '未命名对话',
        emptySession: '空对话（没有任何消息）',
        emptySessionBadge: '空对话',
        promptTitleBadge: '首条提问',
        sessionCount: (n) => `${n} 个对话`,
        sessionCountWithSubagents: (n, subagents) => `${n} 个对话（含 ${subagents} 个子 agent）`,
        subagentBadge: '子 agent',
        subagentNote: '子 agent 对话归属于它上面的主对话，删除主对话时会一并删除。',
        forkBadge: '分叉',
        forkCount: (n) => `${n} 个分叉`,
        forkNote: '分叉对话是从上面那条对话复制出来的独立对话，只在这里缩进显示；删除原对话不会删除它。',
        selectAll: '全选',
        clearSelection: '清空选择',
        selectedSummary: (workspaces, sessions) => `已选 ${workspaces} 个工作区、${sessions} 个对话`,
        deleteSelected: '删除所选',
        deleteHint: '勾选工作区会连同其下全部对话一起删除（不会转到默认工作区）；只勾选对话则只删除该对话。',
        coveredByWorkspace: '已随上面的工作区一起删除',
        emptyWorkspaceHint: '空工作区也可以勾选并删除。',
        nothingSelected: '请先勾选要删除的条目',
        confirmTitle: '确认删除',
        confirmBody: '以下内容将从磁盘永久删除，且不会进入回收站：',
        confirmSessions: (n) => `${n} 个对话（会话记录、日志、投影缓存）`,
        confirmWorkspaces: (n) => `${n} 个工作区（含其下全部对话）`,
        confirmBytes: (size) => `预计释放 ${size}`,
        confirmLive: '其中包含正在运行的对话：删除前会尝试停止它。',
        confirmDefault: '其中包含默认工作区：删除后，若你再次打开同一目录，DSH 可能会重新登记该目录（旧对话不会恢复）。',
        cancel: '取消',
        confirm: '确认删除',
        deleting: '正在删除…',
        forceTitle: '有正在运行或受保护的条目',
        forceBody: '这些条目需要额外确认：',
        force: '强制删除',
        resultTitle: '删除结果',
        resultOk: (sessions, workspaces, size) => `已删除 ${workspaces} 个工作区、${sessions} 个对话，释放 ${size}`,
        resultFailures: '以下条目未删除：',
        close: '关闭',
        loadFailed: '读取清单失败',
        retry: '重试',
        sharedAttachmentsNote: '共享附件（内容寻址存储）不会被删除，因为其他对话仍可能引用它们。',
        workspacePath: '目录',
        home: 'DSH 数据目录',
      },
      en: {
        nav: 'Workspace Cleanup',
        title: 'Workspaces and conversations',
        subtitle: 'Check workspaces or conversations to delete. Records, logs and caches are removed permanently.',
        refresh: 'Refresh',
        reloading: 'Loading…',
        totalWorkspaces: ' workspaces',
        totalSessions: ' conversations',
        totalSize: 'on disk',
        orphans: 'Conversations outside any workspace',
        noOrphans: 'No unassigned conversations',
        empty: 'No workspaces yet.',
        defaultBadge: 'default',
        missingBadge: 'missing dir',
        liveBadge: 'running',
        archivedBadge: 'archived',
        pinnedBadge: 'pinned',
        noFileBadge: 'no files',
        untitled: 'Untitled conversation',
        emptySession: 'Empty conversation (no messages)',
        emptySessionBadge: 'empty',
        promptTitleBadge: 'first prompt',
        sessionCount: (n) => `${n} conversations`,
        sessionCountWithSubagents: (n, subagents) => `${n} conversations (${subagents} sub-agent)`,
        subagentBadge: 'sub-agent',
        subagentNote: 'Sub-agent conversations belong to the main conversation above; deleting the main one deletes them too.',
        forkBadge: 'fork',
        forkCount: (n) => `${n} fork(s)`,
        forkNote: 'A fork is an independent conversation copied from the one above; it is only indented here, and deleting the source conversation never deletes it.',
        selectAll: 'Select all',
        clearSelection: 'Clear',
        selectedSummary: (workspaces, sessions) => `${workspaces} workspace(s), ${sessions} conversation(s) selected`,
        deleteSelected: 'Delete selected',
        deleteHint: 'A checked workspace is deleted with every conversation inside it (nothing is moved to the default workspace); a checked conversation is deleted on its own.',
        coveredByWorkspace: 'Deleted together with the workspace above',
        emptyWorkspaceHint: 'Empty workspaces can be checked and deleted too.',
        nothingSelected: 'Select something first',
        confirmTitle: 'Confirm deletion',
        confirmBody: 'The following is deleted from disk permanently:',
        confirmSessions: (n) => `${n} conversation(s) (records, logs, projection cache)`,
        confirmWorkspaces: (n) => `${n} workspace(s) with all their conversations`,
        confirmBytes: (size) => `About ${size} freed`,
        confirmLive: 'Running conversations are stopped before deletion.',
        confirmDefault: 'The default workspace is included: opening the same directory again may re-register it (old conversations stay gone).',
        cancel: 'Cancel',
        confirm: 'Delete',
        deleting: 'Deleting…',
        forceTitle: 'Some items are running or protected',
        forceBody: 'These items need extra confirmation:',
        force: 'Delete anyway',
        resultTitle: 'Result',
        resultOk: (sessions, workspaces, size) => `Deleted ${workspaces} workspace(s) and ${sessions} conversation(s), freed ${size}`,
        resultFailures: 'Not deleted:',
        close: 'Close',
        loadFailed: 'Failed to load inventory',
        retry: 'Retry',
        sharedAttachmentsNote: 'Shared attachments are kept because other conversations may still reference them.',
        workspacePath: 'Path',
        home: 'DSH data directory',
      },
    }

    const locale = typeof navigator !== 'undefined' && /^zh\b/u.test(navigator.language ?? '') ? 'zh' : 'en'
    const dict = STRINGS[locale]
    const t = (key, ...args) => {
      const value = dict[key] ?? key
      return typeof value === 'function' ? value(...args) : value
    }

    const CSS = `
.wscl-root { display: flex; flex-direction: column; gap: 16px; padding: 4px 2px 32px; color: var(--dsw-alias-label-primary); }
.wscl-head { display: flex; flex-direction: column; gap: 6px; }
.wscl-title { font-size: 18px; font-weight: 600; margin: 0; }
.wscl-subtitle { font-size: 13px; color: var(--dsw-alias-label-secondary); margin: 0; line-height: 1.6; }
.wscl-meta { display: flex; flex-wrap: wrap; gap: 8px 16px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.wscl-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-2); }
.wscl-toolbar-spacer { flex: 1 1 auto; }
.wscl-selected { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.wscl-button { font: inherit; font-size: 13px; line-height: 1.2; padding: 6px 12px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); cursor: pointer; }
.wscl-button:hover:not(:disabled) { border-color: var(--dsw-alias-brand-primary); }
.wscl-button:disabled { opacity: 0.45; cursor: default; }
.wscl-button-primary { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); }
.wscl-button-danger { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
.wscl-button-danger:hover:not(:disabled) { background: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-bg-base); border-color: var(--dsw-alias-state-error-primary); }
.wscl-button-danger-solid { background: var(--dsw-alias-state-error-primary); border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-bg-base); }
.wscl-hint { font-size: 12px; color: var(--dsw-alias-label-secondary); margin: 0; }
.wscl-group { display: flex; flex-direction: column; gap: 8px; }
.wscl-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; }
.wscl-card-head { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; background: var(--dsw-alias-bg-layer-2); border-bottom: 1px solid var(--dsw-alias-border-l1); }
.wscl-card-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1 1 auto; }
.wscl-card-title { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wscl-card-path { font-size: 12px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wscl-badges { display: flex; flex-wrap: wrap; gap: 4px; }
.wscl-badge { font-size: 11px; line-height: 1.4; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.wscl-badge-live { border-color: var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-state-warn-primary); }
.wscl-badge-default { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.wscl-badge-missing { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
.wscl-session { display: flex; align-items: flex-start; gap: 10px; padding: 8px 12px 8px 30px; border-top: 1px solid var(--dsw-alias-border-l1); }
.wscl-session:first-child { border-top: none; }
.wscl-session-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
.wscl-session-title { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wscl-session-sub { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.wscl-session-size { font-size: 11px; color: var(--dsw-alias-label-secondary); white-space: nowrap; padding-top: 2px; }
.wscl-sessions-empty { padding: 10px 12px 10px 30px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.wscl-check { margin-top: 3px; accent-color: var(--dsw-alias-brand-primary); width: 15px; height: 15px; flex: none; cursor: pointer; }
.wscl-notice { font-size: 12px; line-height: 1.6; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }
.wscl-error { font-size: 12px; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
.wscl-overlay { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.45); padding: 24px; }
.wscl-dialog { width: min(560px, 100%); max-height: 80vh; overflow: auto; display: flex; flex-direction: column; gap: 12px; padding: 18px; border-radius: 12px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); box-shadow: 0 18px 48px rgba(0,0,0,0.35); }
.wscl-dialog-title { font-size: 15px; font-weight: 600; margin: 0; }
.wscl-dialog-body { font-size: 13px; line-height: 1.7; margin: 0; white-space: pre-wrap; }
.wscl-dialog-list { margin: 0; padding-left: 18px; font-size: 12px; line-height: 1.7; max-height: 180px; overflow: auto; color: var(--dsw-alias-label-secondary); }
.wscl-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }
.wscl-result { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--dsw-alias-state-success-primary); background: var(--dsw-alias-bg-layer-2); font-size: 12px; }
.wscl-result-fail { border-color: var(--dsw-alias-state-error-primary); }
`

    /** Inject the page CSS exactly once per document. */
    function ensureCss() {
      if (typeof document === 'undefined') return
      if (document.querySelector(`style[data-plugin-css="${PLUGIN_ID}"]`) !== null) return
      const style = document.createElement('style')
      style.setAttribute('data-plugin-css', PLUGIN_ID)
      style.textContent = CSS
      document.head.append(style)
    }

    /** Human-readable byte size. */
    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
      const units = ['B', 'KB', 'MB', 'GB', 'TB']
      let value = bytes
      let index = 0
      while (value >= 1024 && index < units.length - 1) {
        value /= 1024
        index += 1
      }
      return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`
    }

    /**
     * Flatten nested conversation references (a sub-agent sits under its parent).
     * @param {readonly any[]} nodes - top-level conversations.
     * @returns {Array<{session: any, depth: number}>} pre-order rows with their indent depth.
     */
    function flattenSessions(nodes) {
      const rows = []
      const visit = (session, depth) => {
        rows.push({ session, depth })
        for (const child of session.children ?? []) visit(child, depth + 1)
      }
      for (const node of nodes ?? []) visit(node, 0)
      return rows
    }

    /** Fetch one API endpoint, surfacing Host errors as thrown values. */
    async function request(pathname, init) {
      const response = await fetch(`${API}${pathname}`, {
        credentials: 'same-origin',
        headers: init?.body === undefined ? undefined : { 'content-type': 'application/json' },
        ...init,
      })
      let payload = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      if (!response.ok || payload === null || payload.ok !== true) {
        if (payload !== null && (payload.deleted !== undefined || payload.failures !== undefined)) return payload
        throw new Error(payload?.error ?? `HTTP ${response.status}`)
      }
      return payload
    }

    /** Checkbox with an indeterminate state. */
    function Checkbox({ checked, indeterminate, disabled, onChange, label, title }) {
      return h('input', {
        type: 'checkbox',
        className: 'wscl-check',
        checked,
        disabled,
        title,
        'aria-label': label,
        ref: (node) => {
          if (node !== null) node.indeterminate = indeterminate === true && checked !== true
        },
        onChange: (event) => onChange(event.target.checked),
      })
    }

    /** Badge row. */
    function Badges({ items }) {
      if (items.length === 0) return null
      return h(
        'div',
        { className: 'wscl-badges' },
        ...items.map((item, index) => h('span', { key: `${item.text}-${index}`, className: `wscl-badge ${item.className ?? ''}` }, item.text)),
      )
    }

    /** The settings page. */
    function WorkspaceCleanerPage() {
      const [inventory, setInventory] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [error, setError] = React.useState(null)
      const [selectedSessions, setSelectedSessions] = React.useState(() => new Set())
      const [selectedWorkspaces, setSelectedWorkspaces] = React.useState(() => new Set())
      const [dialog, setDialog] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [result, setResult] = React.useState(null)
      const [forcePending, setForcePending] = React.useState(null)

      const load = React.useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
          const payload = await request('/inventory', { method: 'GET' })
          setInventory(payload)
          setSelectedSessions(new Set())
          setSelectedWorkspaces(new Set())
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setLoading(false)
        }
      }, [])

      React.useEffect(() => {
        void load()
      }, [load])

      const workspaces = inventory?.workspaces ?? []
      const orphans = inventory?.orphans ?? []

      const sessionIndex = React.useMemo(() => {
        const index = new Map()
        const add = (nodes) => {
          for (const row of flattenSessions(nodes ?? [])) index.set(row.session.id, row.session)
        }
        for (const workspace of workspaces) add(workspace.sessions ?? [])
        add(orphans)
        return index
      }, [workspaces, orphans])

      /** conversation id → id of the workspace registration that owns it. */
      const sessionWorkspace = React.useMemo(() => {
        const index = new Map()
        for (const workspace of workspaces) {
          for (const row of flattenSessions(workspace.sessions ?? [])) index.set(row.session.id, workspace.id)
        }
        return index
      }, [workspaces])

      const sessionsOfWorkspace = (workspace) => flattenSessions(workspace.sessions ?? []).map((row) => row.session)
      /** Ids deleted together with one conversation: itself and its sub-agents only. */
      const idsOfSession = (session) => sessionSubtree(session).map((node) => node.id)

      /** Check or uncheck one conversation together with every sub-agent under it. */
      const toggleSession = (session, checked) => {
        const ids = idsOfSession(session)
        setSelectedSessions((previous) => {
          const next = new Set(previous)
          for (const id of ids) {
            if (checked) next.add(id)
            else next.delete(id)
          }
          return next
        })
        // Checking a single conversation means "this conversation only", so the
        // workspace that owns it must stop being checked as a whole.
        if (checked) {
          setSelectedWorkspaces((previous) => {
            const next = new Set(previous)
            for (const id of ids) {
              const workspaceId = sessionWorkspace.get(id)
              if (workspaceId !== undefined) next.delete(workspaceId)
            }
            return next
          })
        }
      }

      /** A checked workspace is deleted as a whole, so its conversations are covered. */
      const toggleWorkspace = (workspace, checked) => {
        const ids = sessionsOfWorkspace(workspace).map((session) => session.id)
        setSelectedSessions((previous) => {
          const next = new Set(previous)
          for (const id of ids) next.delete(id)
          return next
        })
        setSelectedWorkspaces((previous) => {
          const next = new Set(previous)
          if (checked) next.add(workspace.id)
          else next.delete(workspace.id)
          return next
        })
      }

      const toggleAllOrphans = (checked) => {
        const ids = flattenSessions(orphans).map((row) => row.session.id)
        setSelectedSessions((previous) => {
          const next = new Set(previous)
          for (const id of ids) {
            if (checked) next.add(id)
            else next.delete(id)
          }
          return next
        })
      }

      const selectedWorkspaceList = React.useMemo(
        () => workspaces.filter((workspace) => selectedWorkspaces.has(workspace.id)),
        [workspaces, selectedWorkspaces],
      )
      /** Conversations checked on their own: a checked workspace already covers its own. */
      const selectedSessionList = React.useMemo(
        () => [...selectedSessions].filter((id) => !selectedWorkspaces.has(sessionWorkspace.get(id) ?? '')),
        [selectedSessions, selectedWorkspaces, sessionWorkspace],
      )
      const selectedBytes = React.useMemo(() => {
        let bytes = 0
        for (const workspace of selectedWorkspaceList) bytes += workspace.bytes ?? 0
        for (const id of selectedSessionList) bytes += sessionIndex.get(id)?.bytes ?? 0
        return bytes
      }, [selectedWorkspaceList, selectedSessionList, sessionIndex])

      const liveSelected = React.useMemo(
        () =>
          selectedSessionList.some((id) => sessionIndex.get(id)?.live === true) ||
          selectedWorkspaceList.some((workspace) => flattenSessions(workspace.sessions ?? []).some((row) => row.session.live === true)),
        [selectedSessionList, selectedWorkspaceList, sessionIndex],
      )
      const defaultSelected = React.useMemo(
        () => selectedWorkspaceList.some((workspace) => workspace.isDefault === true),
        [selectedWorkspaceList],
      )
      const selectionCount = selectedWorkspaceList.length + selectedSessionList.length

      const runDelete = async (payload, force) => {
        setBusy(true)
        setError(null)
        try {
          const response = await request('/delete', {
            method: 'POST',
            body: JSON.stringify({ workspaceIds: payload.workspaceIds, sessionIds: payload.sessionIds, force }),
          })
          setResult(response)
          setForcePending(response.failures?.some((failure) => failure.needsForce === true) ? { payload } : null)
          await load()
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setBusy(false)
          setDialog(null)
        }
      }

      const requestDelete = () => {
        if (selectionCount === 0) {
          setError(t('nothingSelected'))
          return
        }
        setForcePending(null)
        setResult(null)
        setDialog({
          workspaceIds: selectedWorkspaceList.map((workspace) => workspace.id),
          sessionIds: [...selectedSessionList],
          workspaceCount: selectedWorkspaceList.length,
          sessionCount: selectedSessionList.length,
          bytes: selectedBytes,
          live: liveSelected,
          isDefault: defaultSelected,
        })
      }

      const header = h(
        'div',
        { className: 'wscl-head' },
        h('h2', { className: 'wscl-title' }, t('title')),
        h('p', { className: 'wscl-subtitle' }, t('subtitle')),
        h(
          'div',
          { className: 'wscl-meta' },
          h('span', null, `${inventory?.totals?.workspaces ?? 0} ${t('totalWorkspaces')}`),
          h('span', null, `${inventory?.totals?.sessions ?? 0} ${t('totalSessions')}`),
          h('span', null, `${t('totalSize')} ${formatBytes(inventory?.totals?.bytes ?? 0)}`),
          inventory?.home !== undefined ? h('span', null, `${t('home')}: ${inventory.home}`) : null,
        ),
      )

      const toolbar = h(
        'div',
        { className: 'wscl-toolbar' },
        h('span', { className: 'wscl-selected' }, t('selectedSummary', selectedWorkspaceList.length, selectedSessionList.length)),
        h('span', { className: 'wscl-toolbar-spacer' }),
        h('button', { type: 'button', className: 'wscl-button', disabled: loading || busy, onClick: () => void load() }, t('refresh')),
        h(
          'button',
          {
            type: 'button',
            className: 'wscl-button wscl-button-danger-solid',
            disabled: loading || busy || selectionCount === 0,
            onClick: () => requestDelete(),
          },
          t('deleteSelected'),
        ),
      )

      /**
       * The conversations deleted together with one conversation: itself plus
       * every sub-agent it spawned. A fork is never included — it is an
       * independent conversation that merely nests under its source here.
       */
      const sessionSubtree = (session) => {
        const rows = [session]
        const visit = (node) => {
          for (const child of node.children ?? []) {
            if (child.subagent !== true) continue
            rows.push(child)
            visit(child)
          }
        }
        visit(session)
        return rows
      }
      const subtreeChecked = (session) => {
        const nodes = sessionSubtree(session)
        return nodes.length > 0 && nodes.every((node) => selectedSessions.has(node.id))
      }
      const subtreePartial = (session) => {
        const nodes = sessionSubtree(session)
        const count = nodes.filter((node) => selectedSessions.has(node.id)).length
        return count > 0 && count < nodes.length
      }

      /**
       * Display name of one conversation: the folded auto-summary title, the
       * first-prompt fallback the Host derived, or an explicit empty marker.
       */
      const sessionLabel = (session) => {
        if (typeof session.title === 'string' && session.title !== '') return session.title
        if (session.empty === true) return t('emptySession')
        return t('untitled')
      }

      const renderSessionRow = (session, depth, key) => {
        const covered = selectedWorkspaces.has(sessionWorkspace.get(session.id) ?? '')
        return h(
          'div',
          { className: 'wscl-session', key, style: depth > 0 ? { paddingLeft: `${30 + depth * 18}px` } : undefined },
          h(Checkbox, {
            checked: covered || subtreeChecked(session),
            indeterminate: !covered && subtreePartial(session),
            disabled: covered,
            title: covered ? t('coveredByWorkspace') : undefined,
            label: sessionLabel(session),
            onChange: (checked) => toggleSession(session, checked),
          }),
          h(
            'div',
            { className: 'wscl-session-main' },
            h('div', { className: 'wscl-session-title' }, sessionLabel(session)),
            h('div', { className: 'wscl-session-sub' }, session.id),
          ),
          h(
            'div',
            { className: 'wscl-session-size' },
            h(Badges, {
              items: [
                ...(session.subagent === true ? [{ text: t('subagentBadge') }] : []),
                ...(session.fork === true ? [{ text: t('forkBadge') }] : []),
                ...(session.titleFromPrompt === true ? [{ text: t('promptTitleBadge') }] : []),
                ...(session.empty === true ? [{ text: t('emptySessionBadge') }] : []),
                ...(session.live === true ? [{ text: t('liveBadge'), className: 'wscl-badge-live' }] : []),
                ...(session.archived === true ? [{ text: t('archivedBadge') }] : []),
                ...(session.pinned === true ? [{ text: t('pinnedBadge') }] : []),
                ...(session.exists === false ? [{ text: t('noFileBadge'), className: 'wscl-badge-missing' }] : []),
              ],
            }),
            formatBytes(session.bytes ?? 0),
          ),
        )
      }

      const workspaceCards = workspaces.map((workspace) => {
        const rows = flattenSessions(workspace.sessions ?? [])
        const selectedInWorkspace = rows.filter((row) => selectedSessions.has(row.session.id))
        const workspaceSelected = selectedWorkspaces.has(workspace.id)
        const allSelected = rows.length > 0 && selectedInWorkspace.length === rows.length
        const checkboxChecked = workspaceSelected || allSelected
        const partiallySelected = !checkboxChecked && selectedInWorkspace.length > 0
        const subagentCount = rows.filter((row) => row.session.subagent === true).length
        const forkCount = rows.filter((row) => row.session.fork === true).length
        const badges = []
        if (workspace.isDefault === true) badges.push({ text: t('defaultBadge'), className: 'wscl-badge-default' })
        if (workspace.missing === true) badges.push({ text: t('missingBadge'), className: 'wscl-badge-missing' })
        if (rows.some((row) => row.session.live === true)) badges.push({ text: t('liveBadge'), className: 'wscl-badge-live' })
        badges.push({
          text: subagentCount > 0 ? t('sessionCountWithSubagents', rows.length, subagentCount) : t('sessionCount', rows.length),
        })
        if (forkCount > 0) badges.push({ text: t('forkCount', forkCount) })
        badges.push({ text: formatBytes(workspace.bytes ?? 0) })

        return h(
          'div',
          { className: 'wscl-card', key: workspace.id },
          h(
            'div',
            { className: 'wscl-card-head' },
            h(Checkbox, {
              checked: checkboxChecked,
              indeterminate: partiallySelected,
              label: workspace.title,
              onChange: (checked) => toggleWorkspace(workspace, checked),
            }),
            h(
              'div',
              { className: 'wscl-card-main' },
              h('div', { className: 'wscl-card-title' }, workspace.title || workspace.path || workspace.id),
              h('div', { className: 'wscl-card-path' }, workspace.path || ''),
              h(Badges, { items: badges }),
            ),
          ),
          rows.length === 0
            ? h('div', { className: 'wscl-sessions-empty' }, t('emptyWorkspaceHint'))
            : rows.map((row) => renderSessionRow(row.session, row.depth, `${workspace.id}:${row.session.id}`)),
        )
      })

      const orphanRows = flattenSessions(orphans)
      const orphanCard =
        orphanRows.length === 0
          ? null
          : h(
              'div',
              { className: 'wscl-group' },
              h('h3', { className: 'wscl-title' }, t('orphans')),
              h(
                'div',
                { className: 'wscl-card' },
                h(
                  'div',
                  { className: 'wscl-card-head' },
                  h(Checkbox, {
                    checked: orphanRows.length > 0 && orphanRows.every((row) => selectedSessions.has(row.session.id)),
                    indeterminate: orphanRows.some((row) => selectedSessions.has(row.session.id)) && !orphanRows.every((row) => selectedSessions.has(row.session.id)),
                    label: t('orphans'),
                    onChange: (checked) => toggleAllOrphans(checked),
                  }),
                  h('div', { className: 'wscl-card-main' }, h('div', { className: 'wscl-card-title' }, t('orphans'))),
                ),
                orphanRows.map((row) => renderSessionRow(row.session, row.depth, `orphan:${row.session.id}`)),
              ),
            )

      const dialogs = []
      if (dialog !== null) {
        const lines = []
        if (dialog.workspaceCount > 0) lines.push(t('confirmWorkspaces', dialog.workspaceCount))
        if (dialog.sessionCount > 0) lines.push(t('confirmSessions', dialog.sessionCount))
        lines.push(t('confirmBytes', formatBytes(dialog.bytes)))
        dialogs.push(
          h(
            'div',
            { className: 'wscl-overlay', key: 'confirm' },
            h(
              'div',
              { className: 'wscl-dialog' },
              h('h3', { className: 'wscl-dialog-title' }, t('confirmTitle')),
              h('p', { className: 'wscl-dialog-body' }, t('confirmBody')),
              h('ul', { className: 'wscl-dialog-list' }, ...lines.map((line, index) => h('li', { key: index }, line))),
              dialog.live ? h('p', { className: 'wscl-notice' }, t('confirmLive')) : null,
              dialog.isDefault ? h('p', { className: 'wscl-notice' }, t('confirmDefault')) : null,
              h('p', { className: 'wscl-hint' }, t('sharedAttachmentsNote')),
              h(
                'div',
                { className: 'wscl-dialog-actions' },
                h('button', { type: 'button', className: 'wscl-button', disabled: busy, onClick: () => setDialog(null) }, t('cancel')),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'wscl-button wscl-button-danger-solid',
                    disabled: busy,
                    onClick: () => void runDelete(dialog, dialog.live || dialog.isDefault),
                  },
                  busy ? t('deleting') : t('confirm'),
                ),
              ),
            ),
          ),
        )
      }
      if (forcePending !== null) {
        dialogs.push(
          h(
            'div',
            { className: 'wscl-overlay', key: 'force' },
            h(
              'div',
              { className: 'wscl-dialog' },
              h('h3', { className: 'wscl-dialog-title' }, t('forceTitle')),
              h('p', { className: 'wscl-dialog-body' }, t('forceBody')),
              h(
                'ul',
                { className: 'wscl-dialog-list' },
                ...(result?.failures ?? []).filter((failure) => failure.needsForce === true).map((failure, index) => h('li', { key: index }, `${failure.title ?? failure.id}：${failure.error}`)),
              ),
              h(
                'div',
                { className: 'wscl-dialog-actions' },
                h('button', { type: 'button', className: 'wscl-button', disabled: busy, onClick: () => setForcePending(null) }, t('cancel')),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'wscl-button wscl-button-danger-solid',
                    disabled: busy,
                    onClick: () => void runDelete(forcePending.payload, true),
                  },
                  busy ? t('deleting') : t('force'),
                ),
              ),
            ),
          ),
        )
      }

      const resultBox =
        result === null
          ? null
          : h(
              'div',
              { className: `wscl-result ${result.failures?.length > 0 ? 'wscl-result-fail' : ''}` },
              h(
                'div',
                null,
                t('resultOk', result.totals?.sessions ?? 0, result.totals?.workspaces ?? 0, formatBytes(result.totals?.bytes ?? 0)),
              ),
              result.failures?.length > 0
                ? h(
                    'div',
                    null,
                    h('div', null, t('resultFailures')),
                    h(
                      'ul',
                      { className: 'wscl-dialog-list' },
                      ...result.failures.map((failure, index) =>
                        h('li', { key: index }, `${failure.title ?? failure.id}：${failure.error ?? (failure.errors ?? []).join('; ')}`),
                      ),
                    ),
                  )
                : null,
              h('button', { type: 'button', className: 'wscl-button', onClick: () => setResult(null) }, t('close')),
            )

      const body = loading
        ? h('p', { className: 'wscl-hint' }, t('reloading'))
        : h(
            'div',
            { className: 'wscl-group' },
            ...workspaceCards,
            orphanCard,
            h('p', { className: 'wscl-hint' }, t('deleteHint')),
            h('p', { className: 'wscl-hint' }, t('subagentNote')),
            h('p', { className: 'wscl-hint' }, t('forkNote')),
          )

      return h(
        'div',
        { className: 'wscl-root' },
        header,
        error !== null ? h('div', { className: 'wscl-error' }, error) : null,
        toolbar,
        resultBox,
        body,
        ...dialogs,
      )
    }

    /** Client plugin entry point. */
    function apply(ctx) {
      ensureCss()
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: PLUGIN_ID,
            order: 45,
            label: () => t('nav'),
          },
          WorkspaceCleanerPage,
        ),
      )
    }

    mod.exports.name = PLUGIN_ID
    mod.exports.inject = ['slots']
    mod.exports.apply = apply
    return mod.exports
  },
})
