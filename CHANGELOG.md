# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.7] - 2026-10-25

### Changed

- Renamed the package from `@local/workspace-cleaner` to `dsh-workspace-cleaner` so
  the repository can be published and installed from GitHub or npm without a
  private scope.
- Repository layout is now a standalone, publishable package: `LICENSE`,
  `CHANGELOG.md`, `CONTRIBUTING.md`, `.gitignore`, `.gitattributes`,
  `.editorconfig` and GitHub Actions workflows added; no build step needed.
- `package.json` gained `license`, `publishConfig`, `keywords`, `icon` and a
  broader `exports` map (`./cordis.patch.yml` included).

## [0.1.6] - 2026-10-25

### Fixed

- Forks were labelled as sub-agent conversations and shown beside their source
  conversation. A fork now nests under the conversation it was forked from and
  carries a separate 分叉 / fork badge; only real sub-agent conversations
  (`origin: "subagent"`) get the 子 agent badge.

### Changed

- Deleting a source conversation no longer deletes its forks; deleting a fork
  still deletes that fork's own sub-agent conversations.

## [0.1.5] - 2026-10-25

### Fixed

- Deleting a conversation without deleting its workspace left the row in the
  Web UI under 未分组 / ungrouped until DSH restarted. The Host now broadcasts
  `api-session/removed` for every conversation it actually deleted, so the
  Client drops the row immediately.

## [0.1.4] - 2026-10-25

### Fixed

- Deleting a workspace that contains no conversations failed with
  `字段 sessionIds 必须是非空数组`; both id lists in `POST /delete` are now
  optional and an empty workspace can be deleted on its own.
- Conversations that were opened but never prompted showed up as 未命名对话.
  They are now named after their first user prompt when one exists, and are
  labelled 空对话 / empty when the log genuinely contains no message.

## [0.1.3] - 2026-10-25

### Added

- Empty workspaces can be selected and deleted.
- Conversations (and sub-agent conversations) are sorted newest first by
  creation time, in every workspace and in the unassigned group.

### Changed

- One delete button instead of two: checked workspaces are deleted as
  workspaces, checked conversations are deleted as conversations, and both can
  be combined in one confirmed action.

## [0.1.2] - 2026-10-25

### Added

- Sub-agent conversations are attributed to the conversation that spawned them
  and nested under it with a 子 agent badge instead of being listed as
  unassigned. Deleting a parent conversation deletes its sub-agent
  conversations too.

## [0.1.1] - 2026-10-25

### Added

- `/health` reports the build timestamp so a stale Host half is visible without
  guessing.

## [0.1.0] - 2026-10-25

### Added

- Initial release: a 设置 → 工作区清理 page that lists workspaces and their
  conversations, shows the on-disk footprint, and deletes the checked ones
  together with their session logs, projection caches and workspace
  registrations. Deleting a workspace deletes its conversations instead of
  moving them to the default workspace.

[Unreleased]: https://github.com/sleeepingbeee/dsh-workspace-cleaner/compare/v0.1.7...HEAD
[0.1.7]: https://github.com/sleeepingbeee/dsh-workspace-cleaner/releases/tag/v0.1.7
[0.1.6]: https://github.com/sleeepingbeee/dsh-workspace-cleaner/releases/tag/v0.1.6
[0.1.5]: https://github.com/sleeepingbeee/dsh-workspace-cleaner/releases/tag/v0.1.5
[0.1.4]: https://github.com/sleeepingbeee/dsh-workspace-cleaner/releases/tag/v0.1.4
[0.1.3]: https://github.com/sleeepingbeee/dsh-workspace-cleaner/releases/tag/v0.1.3
[0.1.2]: https://github.com/sleeepingbeee/dsh-workspace-cleaner/releases/tag/v0.1.2
[0.1.1]: https://github.com/sleeepingbeee/dsh-workspace-cleaner/releases/tag/v0.1.1
[0.1.0]: https://github.com/sleeepingbeee/dsh-workspace-cleaner/releases/tag/v0.1.0
