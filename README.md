# dsh-workspace-cleaner

> 在 DSH Web UI 的「设置」里列出所有工作区与对话，勾选后连同记录、日志、缓存一起删除。
> A DSH Web UI plugin that lists every workspace and conversation, then deletes the
> checked ones together with their session logs, projection caches and registrations.

[![npm version](https://img.shields.io/npm/v/dsh-workspace-cleaner)](https://www.npmjs.com/package/dsh-workspace-cleaner)
[![CI](https://github.com/sleeepingbeee/dsh-workspace-cleaner/actions/workflows/ci.yml/badge.svg)](https://github.com/sleeepingbeee/dsh-workspace-cleaner/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/sleeepingbeee/dsh-workspace-cleaner)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

**一句话**：DSH 的「移除工作区」只摘掉登记、把会话赶到「未分组」，这个插件让你看清
每个工作区、每条对话各占多少磁盘，然后**一次勾选、一个按钮**把它们删干净。

- 勾选工作区 → 删除整个工作区（含其下所有对话）
- 勾选对话 → 只删除该对话（自动带上它的子 agent 对话）
- 两者可以混选，一次确认、一次执行，删除不可撤销

> 与 DeepSeek 官方无关，个人开发的第三方插件。

## 目录

- [它解决什么问题](#它解决什么问题)
- [30 秒上手](#30-秒上手)
- [安装](#安装)
- [使用](#使用)
- [到底删了什么](#到底删了什么)
- [不会删除什么](#不会删除什么)
- [安全边界](#安全边界)
- [已知限制](#已知限制)
- [常见问题](#常见问题)
- [配置](#配置)
- [HTTP 接口](#http-接口)
- [开发](#开发)
- [卸载](#卸载)
- [更新记录](#更新记录)
- [English](#english)
- [License](#license)

## 它解决什么问题

DSH 自带的「移除工作区」只删除登记，会话记录仍留在磁盘上，并会在界面上变成
「未分组」；手动清理 `~/.dsh` 又容易漏掉投影缓存、或误删别的会话。这个插件把
「有哪些工作区、各自有哪些对话、各占多少空间」摆在一个页面里，勾选后一次删干净：

- **一个删除按钮**：勾选工作区 → 删除整个工作区（含其下所有对话）；勾选对话 →
  只删除该对话。两者可以混选，一次确认、一次执行。
- **空工作区也能删**：没有对话的工作区同样可以勾选、可以删除（旧版本会报
  `字段 sessionIds 必须是非空数组`）。
- **子 agent 对话归属主对话**：子 agent 的记录没有独立的工作区登记，插件按会话头
  里的 `parentSession` 把它们嵌在发起它的对话下面并标注「子 agent」；删除主对话
  会连同这些子对话一起删除。
- **fork 是独立对话**：fork 出来的对话同样缩进显示在原对话下面，但带「分叉」标注，
  不代表从属关系——删除原对话不会删除它的 fork。
- **按时间排序**：所有对话按创建时间倒序，最新在最上面。
- **删除后界面立刻消失**：删除成功后向界面广播会话移除事件，不会出现「删完还挂在
  『未分组』里，直到重启 DSH」的问题。
- **空对话不再叫「未命名对话」**：没有任何消息的对话显示为「空对话」，只有首条提问
  而没有标题事件的对话用该提问作为名称，并标注「首条提问」。
- **删除前先看清楚**：确认框里给出工作区数、对话数、总字节数，以及「运行中 /
  默认工作区」这类需要二次确认的情况；删除后还会列出每条失败原因。

## 30 秒上手

```bash
# 1. 安装（二选一）
plugin_manager install_bundle dsh-workspace-cleaner                     # 从 npm
plugin_manager install_bundle github:sleeepingbeee/dsh-workspace-cleaner # 从 GitHub

# 2. 重启一次 DSH（Host 半需要进入模块图；之后只改 Client 半刷新页面即可）

# 3. 打开 设置 → 工作区清理，勾选、点「删除所选」
```

页面大致长这样：

```text
┌─ 工作区清理 ────────────────────────────────────────────────┐
│ 7 个工作区 · 21 个对话 · 19.1 MB · ~/.dsh          [刷新]  │
├─────────────────────────────────────────────────────────────┤
│ ☑ dsh workspace (默认)                    20 个对话  18.2MB │
│   ☑ 公众号文章爬取与AI总结方案 (1)          1.2 MB  运行中   │
│     ☑ 你是计算神经科学/化学信息学 …  [子 agent]  0.4 MB      │
│   ☐ 工作区对话管理插件                      0.8 MB           │
│ ☑ 线性代数                                  0 个对话  0 B    │
├─────────────────────────────────────────────────────────────┤
│ 已选 2 个工作区 / 3 个对话（共 21 个对话）     [删除所选]   │
└─────────────────────────────────────────────────────────────┘
```

## 安装

要求：DSH 带 Web UI（桌面版或 `dsh web`）、Node.js >= 22。插件**没有第三方依赖、
没有构建步骤**，仓库根目录就是插件包（`package.json` 里带 `dsh.bundle.patch`）。

### 方式一：npm（推荐）

```bash
plugin_manager install_bundle dsh-workspace-cleaner
# 或锁定版本：
plugin_manager install_bundle dsh-workspace-cleaner@0.1.7
```

### 方式二：从 GitHub 安装

```bash
plugin_manager install_bundle github:sleeepingbeee/dsh-workspace-cleaner
# 或锁定 tag：
plugin_manager install_bundle github:sleeepingbeee/dsh-workspace-cleaner#v0.1.7
```

也可以先 `git clone`，再用方式三安装本地目录。

### 方式三：本地目录

把仓库放到任意目录，然后在 DSH 里执行（界面：设置 → 插件 → 安装，或让 agent 调用
`plugin_manager`）：

```bash
plugin_manager install_bundle D:/path/to/dsh-workspace-cleaner
```

> ⚠️ 本地目录方式在 Windows 上会建立一个目录联接（junction）。如果之后改成从
> npm / GitHub 安装，pnpm 无法 rename 覆盖这个联接，会报
> `[ERR_PNPM_EPERM] ... rename '..._tmp_...' -> '...'`。先把旧联接删掉（只删链接，
> 不动源码）：
>
> ```powershell
> cmd /c rmdir "$env:USERPROFILE\.dsh\profiles\<profile>\node_modules\dsh-workspace-cleaner"
> ```

首次安装后**需要重启一次 DSH**，让 Host 半进入模块图；之后只改 Client 半时刷新页面
即可。Host 半（`lib/index.js`、`lib/store.js`）变更需要重启，或在插件管理器里把
本插件「禁用 → 启用」以重新挂载。

## 使用

1. 打开 **设置 → 工作区清理**。
2. 页面顶部显示当前 DSH home、工作区数、对话数与总占用；「刷新」重新读取磁盘。
3. 勾选工作区（整块删除）或对话（单条删除，会自动带上它的子 agent 对话）。
   被勾选工作区覆盖的对话行会显示为已勾选且不可单独取消。
4. 点底部唯一的「删除所选」，在确认对话框里核对数量、字节数与「运行中 / 默认工作区」
   提示后确认。删除不可撤销。
5. 结果面板会列出失败的条目与原因；运行中的对话或默认工作区需要再次确认才会强制删除。

## 到底删了什么

对**被选中的每一个对话**，插件按下面的顺序执行：

```text
1. 归档并请求停止（仅运行中的对话）
2. 删除磁盘产物
   ~/.dsh/sessions/<projectKey>/<会话目录>/session.v4.jsonl.zstd
   ~/.dsh/storages/session_projcache/sessions/<sessionId>.json（含 .bak.*）
3. 从工作区登记里摘除该 session id（detach + 取消归档/置顶）
4. 向界面广播 api-session/removed，让列表行立即消失
```

对**被选中的工作区**，第 2~4 步作用于它的每一个对话（含子 agent 对话），然后：

```text
5. 删除 storages/workspace.json 中该工作区的行与 global.workspaceIds 里的 id
6. 如果它是默认工作区，同时清掉 defaultWorkspaceId
```

| 勾选对象 | 磁盘与状态变更 |
| --- | --- |
| 一个对话 | 该会话在所有项目目录下的 `session.v4.jsonl.zstd` 日志目录；`storages/session_projcache/sessions/<id>.json`（含 `.bak.*`）；工作区登记里的该 session id；归档/置顶列表里的该 id；向界面广播 `api-session/removed` |
| 一个工作区 | 上述操作作用于它的每一个对话（含子 agent 对话）；删除 `storages/workspace.json` 中该工作区的行与 `global.workspaceIds` 里的 id；如果它是默认工作区则同时清掉 `defaultWorkspaceId` |

删除后，被清空的 `sessions/<projectKey>/` 目录会被顺手删掉。

运行中的对话会先归档并请求停止，再删除文件；仍被 DSH 持有的会话可能在下次写入时重建
日志，所以删除运行中的对话会要求二次确认，并在结果里给出提示。默认工作区同理。

## 不会删除什么

- **其他工作区**：只处理勾选的内容，其余工作区与对话不受影响。
- **`~/.dsh` 下的其他文件**：凭据、配置、profile、市场缓存等一概不碰。
- **按内容哈希共享的附件**：`attachments/v1`、`cache/attachments` 里的对象可能被多个
  对话引用，按会话删除会误伤别的对话，所以保留（它们数量有限、多为小文件）。
- **插件自身与 DSH 本体**：不做升级、不改配置。卸载插件见[卸载](#卸载)。

## 安全边界

- HTTP 接口只注册在 DSH Web 服务器的 `/api/workspace-cleaner` 前缀下，并校验：调用方
  必须是回环地址、`Host` 与 `Origin` 同源、拒绝 `Sec-Fetch-Site: cross-site`。
- 所有文件操作都被 `assertInside` 限制在当前 DSH home 之下；id 必须是 `[\w.-]{1,200}`
  且不能是 `.` / `..`，避免路径穿越。
- 插件不访问网络，不上传任何数据；读取的清单只用于渲染页面。
- 删除只能由页面上的用户操作触发（界面上勾选 + 确认），agent 侧没有暴露删除工具。

## 已知限制

- **删除不可撤销**：没有回收站，删掉的日志与投影缓存无法从界面恢复。重要数据请先备份
  `~/.dsh/sessions` 与 `~/.dsh/storages`。
- **运行中的对话**：删除后若该会话仍被宿主持有，下一次写入可能重新生成日志文件，
  插件会给出告警；最稳妥的做法是先结束该对话，再删除。
- **默认工作区**：可以删，但 DSH 之后可能重新初始化一个默认工作区；插件会要求二次确认。
- **共享附件不回收**：见上一节；如需彻底清空，请自行确认无引用后手动删除
  `attachments/` 与 `cache/attachments/`。
- **平台验证**：在 Windows 11 + DSH 桌面版上验证通过；代码只用 `node:fs` / `node:path`
  并做了跨平台路径编码，macOS / Linux 理论上可用但未实测。

## 常见问题

**Q：删错了能恢复吗？**
不能。删除会同时移除日志、投影缓存和工作区登记。重要数据请先备份；插件在确认框里会
先给出将要删除的数量与字节数。

**Q：删除工作区会不会把对话挪到「默认工作区」？**
不会。DSH 自带的「移除工作区」才会那样；本插件删除工作区时会先删掉它下面的每个对话，
再把工作区登记移除，所以不会出现「对话被搬进默认工作区」。

**Q：为什么删掉对话后附件目录没变小？**
附件按内容哈希共享，同一张图可能被多个对话引用，无法按会话安全回收（见
[不会删除什么](#不会删除什么)）。

**Q：为什么装完要重启一次 DSH？**
Host 半（路由与删除流水线）需要进入模块图。之后只改 Client 半（页面）刷新页面即可；
Host 半改动可在插件管理器里「禁用 → 启用」重新挂载，无需重启。

**Q：能不能不打开界面，用命令删？**
插件故意不向 agent 暴露删除工具，删除只能由界面上的人操作。需要自动化时可以自己调
`POST /api/workspace-cleaner/delete`（同样受回环 + 同源校验限制）。

**Q：会读取或上传我的对话内容吗？**
不会。插件只读会话头（时间、父会话、是否有标题）、目录大小和项目缓存文件，不解析
消息正文，也不访问网络。

**Q：支持多 profile 吗？**
默认处理当前 DSH home（`~/.dsh`）。多 profile 时可用配置 `dshHome` 指定另一个 home；
沙箱验证也用它指向临时目录。

## 配置

插件没有必填配置。可选 `Config.dshHome` 用于把插件指向另一个 DSH home（默认按
`DSH_HOME` 环境变量、再退回 `~/.dsh`），多用于沙箱验证：

```yaml
- insert:
    - id: workspace-cleaner
      name: 'dsh-workspace-cleaner'
      config:
        dshHome: D:/tmp/dsh-sandbox
```

## HTTP 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/workspace-cleaner/health` | 插件名、版本、构建时间、当前 home |
| GET | `/api/workspace-cleaner/inventory` | 工作区树、未归属对话、字节数、告警 |
| POST | `/api/workspace-cleaner/delete` | `{ workspaceIds?, sessionIds?, force? }`，两个列表都可省略或为空 |
| POST | `/api/workspace-cleaner/delete-sessions` | `{ sessionIds, force? }`（严格版） |
| POST | `/api/workspace-cleaner/delete-workspaces` | `{ workspaceIds, force? }`（严格版） |

`delete` 会把「勾选的工作区覆盖到的对话」从 `sessionIds` 里剔除，避免同一份记录被删
两次。

## 开发

```bash
node --check lib/index.js && node --check lib/store.js && node --check lib/client.js
node test/package.test.mjs
node test/store.test.mjs
node test/http.test.mjs
node test/client.smoke.test.mjs
```

或直接 `npm test`（52 个断言：package 5 / store 21 / http 24 / client-smoke 2）。测试全部在
`mkdtemp()` 出来的假 home 上运行，不会碰真实 DSH 数据；详见 [CONTRIBUTING.md](CONTRIBUTING.md)
（含「为什么不用 `node --test test/`」和 UTF-8 BOM 的坑）。

```text
lib/index.js     Host 半：路由、删除流水线、广播会话移除事件
lib/store.js     纯函数：路径编码、清单组装、归属解析、删除计划（无 Cordis 依赖）
lib/client.js    Client 半：window.__ModuleLoader__ 注册 settings.section 页面
test/            package / store / http / client-smoke 四组测试
```

## 卸载

```bash
plugin_manager remove_bundle dsh-workspace-cleaner
```

卸载只移除插件代码，**不会**恢复已删除的对话，也不会改动 `~/.dsh` 下的会话数据。

## 更新记录

见 [CHANGELOG.md](CHANGELOG.md)。当前版本 **0.1.7**。

## English

`dsh-workspace-cleaner` adds a **Settings → Workspace Cleaner** page to the DSH Web
UI. It lists every workspace with its conversations (newest first), the disk
footprint of each conversation, and the conversations that belong to no
workspace. Check a workspace to delete it *with* all of its conversations, or
check individual conversations to delete only those — one button, one
confirmation. Deletion is permanent.

Details worth knowing:

- Deleting a workspace deletes its conversations; it never moves them into the
  default workspace.
- Sub-agent conversations are nested under the conversation that spawned them and
  are deleted together with it. Forks are nested too but stay independent: they
  carry a *fork* badge and survive their source conversation.
- Deleting the artifacts removes the session log directory, the projection cache
  entry and the workspace registration. Content-addressed attachments shared by
  other conversations are intentionally kept.
- The browser is told about every removed conversation, so rows do not linger
  under "ungrouped" until the next restart.
- Empty workspaces are selectable and deletable; conversations without any
  message are labelled *empty* instead of *untitled*.

Install with the DSH plugin manager, from npm or GitHub:

```bash
plugin_manager install_bundle dsh-workspace-cleaner
plugin_manager install_bundle github:sleeepingbeee/dsh-workspace-cleaner
```

Restart DSH once after the first install (the Host half joins the module graph),
refresh the page for Client-half changes. Node.js >= 22, no runtime
dependencies. MIT licensed. Third-party plugin, not affiliated with DeepSeek.

## License

[MIT](LICENSE)
