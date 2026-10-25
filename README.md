# dsh-workspace-cleaner

> 在 DSH Web UI 的「设置」里列出所有工作区与对话，勾选后连同记录、日志、缓存一起删除。
> A DSH Web UI plugin that lists every workspace and conversation, then deletes the
> checked ones together with their session logs, projection caches and registrations.

[![CI](https://github.com/sleeepingbeee/dsh-workspace-cleaner/actions/workflows/ci.yml/badge.svg)](https://github.com/sleeepingbeee/dsh-workspace-cleaner/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/sleeepingbeee/dsh-workspace-cleaner)](LICENSE)

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

## 安装

要求：DSH 带 Web UI（桌面版或 `dsh web`）、Node.js >= 22。插件没有第三方依赖，
没有构建步骤。

### 方式一：插件管理器（本地目录）

把仓库放到任意目录，然后在 DSH 里执行（界面：设置 → 插件 → 安装，或让 agent 调用
`plugin_manager`）：

```
plugin_manager install_bundle D:/path/to/dsh-workspace-cleaner
```

### 方式二：从 GitHub 安装

仓库根目录就是插件包（`package.json` 里带 `dsh.bundle.patch`），可以直接用 `pnpm`
支持的 git 地址安装：

```
plugin_manager install_bundle github:sleeepingbeee/dsh-workspace-cleaner
```

也可以先在本地 `git clone`，再用方式一安装。

### 方式三：npm（发布之后）

```
plugin_manager install_bundle dsh-workspace-cleaner
```

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

| 勾选对象 | 磁盘与状态变更 |
| --- | --- |
| 一个对话 | 该会话在所有项目目录下的 `session.v4.jsonl.zstd` 日志目录；`storages/session_projcache/sessions/<id>.json`（含 `.bak.*`）；工作区登记里的该 session id；归档/置顶列表里的该 id；向界面广播 `api-session/removed` |
| 一个工作区 | 上述操作作用于它的每一个对话（含子 agent 对话）；删除 `storages/workspace.json` 中该工作区的行与 `global.workspaceIds` 里的 id；如果它是默认工作区则同时清掉 `defaultWorkspaceId` |

删除后，被清空的 `sessions/<projectKey>/` 目录会被顺手删掉。

**不会删除**：其他工作区、`~/.dsh` 下的其他文件、以及 `attachments/`、`cache/attachments`
里按内容哈希共享的附件对象——同一张图片可能被多个对话引用，按会话删除会误伤别的对话。

运行中的对话会先归档并请求停止，再删除文件；仍被 DSH 持有的会话可能在下次写入时重建
日志，所以删除运行中的对话会要求二次确认，并在结果里给出提示。默认工作区同理。

## 安全边界

- HTTP 接口只注册在 DSH Web 服务器的 `/api/workspace-cleaner` 前缀下，并校验：调用方
  必须是回环地址、`Host` 与 `Origin` 同源、拒绝 `Sec-Fetch-Site: cross-site`。
- 所有文件操作都被 `assertInside` 限制在当前 DSH home 之下；id 必须是 `[\w.-]{1,200}`
  且不能是 `.` / `..`，避免路径穿越。
- 插件不访问网络，不上传任何数据；读取的清单只用于渲染页面。
- 删除只能由页面上的用户操作触发（界面上勾选 + 确认），agent 侧没有暴露删除工具。

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

或直接 `npm test`。测试全部在 `mkdtemp()` 出来的假 home 上运行，不会碰真实 DSH 数据；
详见 [CONTRIBUTING.md](CONTRIBUTING.md)（含「为什么不用 `node --test test/`」和
UTF-8 BOM 的坑）。

```
lib/index.js     Host 半：路由、删除流水线、广播会话移除事件
lib/store.js     纯函数：路径编码、清单组装、归属解析、删除计划（无 Cordis 依赖）
lib/client.js    Client 半：window.__ModuleLoader__ 注册 settings.section 页面
test/            package / store / http / client-smoke 四组测试
```

## 更新记录

见 [CHANGELOG.md](CHANGELOG.md)。

## English

`dsh-workspace-cleaner` adds a **Settings → Workspace Cleaner** page to the DSH Web
UI. It lists every workspace with its conversations (newest first), the disk
footprint of each conversation, and the conversations that belong to no
workspace. Check a workspace to delete it *with* all of its conversations, or
check individual conversations to delete only those — one button, one
confirmation.

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

Install with the DSH plugin manager:

```
plugin_manager install_bundle github:sleeepingbeee/dsh-workspace-cleaner
```

Restart DSH once after the first install (the Host half joins the module graph),
refresh the page for Client-half changes. MIT licensed.

## License

[MIT](LICENSE)
