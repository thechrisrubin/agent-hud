# For Anthropic support — an uploaded plugin stopped reaching Cowork sessions

**Account:** (redacted) · org `<org-id>`
**Desktop app:** 1.37937.3 · macOS 26.4.1 · Apple M4 Pro
**Dates:** worked 2026-08-28 ~19:40–19:55 UTC · stopped after ~19:55 UTC · still failing 2026-08-31

---

## What happened

A personal plugin (14 HTTP lifecycle hooks, no skills, no MCP) was uploaded through the desktop app's **Upload plugin** option. It worked: hooks fired from Cowork sessions, including one started from an iPhone, and reached an external endpoint.

After removing it and uploading a revised version, **no Cowork session has executed its hooks again** — across four upload cycles, a rename, an app restart, and three days.

The desktop app shows the plugin installed and enabled the whole time.

## What a Cowork session reports about its own filesystem

```
$ find ~/.claude/plugins -name hooks.json
(no results)

$ ls ~/.claude/plugins/
synced

$ ls ~/.claude/plugins/synced/<org>_<user>/
cowork-plugin-management   dropbox   marketing   sales
manifest.json  (+ a .meta.json per plugin)
```

The four marketplace plugins sync correctly. The uploaded plugin is absent.

`manifest.json` lists exactly those four, each with `"marketplaceName": "knowledge-work-plugins"` and `"installationPreference": "available"`. Its `lastUpdated` is **2026-08-28T06:35Z** — about twelve hours *before* the plugin was first uploaded — and every `updatedAt` matches. The catalog has not refreshed in three days and has never contained the uploaded plugin.

## Why this is confusing rather than simply "uploaded plugins don't sync"

On 2026-08-28 the plugin demonstrably ran inside Cowork sessions. Five sessions delivered complete hook streams, each carrying a header whose value came from `${CLAUDE_CODE_REMOTE_SESSION_ID}` substituted via `allowedEnvVars`. That is only possible if the plugin was present in the session.

So an uploaded plugin *was* being delivered by some path, and that path is not the synced marketplace catalog — which never listed it. Whatever that path is, it stopped.

## What has been ruled out, with evidence

| Possibility | Evidence against |
|---|---|
| The endpoint is unreachable | Fetched successfully from Anthropic's own network on 2026-08-28 and again on 2026-08-31 |
| The plugin file is malformed | `claude plugin validate` passes; 14 events, http handlers only, one entry each |
| Authentication is rejecting events | Zero rejections recorded; nothing arrives to reject |
| The receiving app is down | 153 events accepted from local Claude Code sessions over the same period |
| A cached broken version | A tool-using thread produces nothing either; under the broken version tool events still arrived |
| It resolves itself | Three days, no change |

## Questions

1. By what mechanism does a plugin uploaded via **Upload plugin** reach a Cowork session, given the synced catalog only carries marketplace plugins?
2. Can removing and re-uploading a plugin leave that mechanism in a state where it no longer delivers?
3. Is there a way to see, from the account side, whether an uploaded plugin is queued for delivery to cloud sessions?

## Reproduction, if useful

1. Build a minimal plugin: `.claude-plugin/plugin.json` plus `hooks/hooks.json` with one `type: "http"` hook on `UserPromptSubmit` pointing at any reachable URL.
2. Upload it via the desktop app. Start a Cowork thread. Confirm the POST arrives.
3. Remove the plugin. Upload a modified copy. Start a new Cowork thread.
4. Observed here: no POST, and no `hooks.json` anywhere under `~/.claude/plugins` in the session.
