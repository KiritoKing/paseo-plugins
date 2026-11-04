# Paseo Essentials

Paseo Essentials adds conversation reading controls, per-turn Git changes, attachment browsing, image galleries, and workspace session history to Paseo. The npm package is @chlrc/paseo-ux. The manifest ID remains paseo-ux to preserve the existing plugin identity and settings namespace.

## Requirements

- Paseo app and daemon 0.11.2 or later.
- Node.js 22 or 24 and pnpm 10.34.7 for repository development.
- Session restoration requires the public Paseo CLI on the daemon host's PATH.
- Turn changes requires Git on that host's PATH and a repository with an existing commit.

## Install from this checkout

Install the plugin on the daemon that will host it. From the repository root:

    cd packages/paseo-ux
    paseo plugin install .
    paseo plugin reload paseo-ux

For a remote daemon, install and reload the plugin on that daemon host. Do not rely on a CLI running on another machine to restore sessions.

## Use the plugin

### Conversation reading

Open Essentials' conversation reading settings to adjust Markdown and code layout, font size, density, reading width, reasoning disclosure, and optional individual shell records. Tool grouping remains native by default. Output-only mode hides all tool and reasoning rows, including streaming and failed records, while preserving the underlying conversation history. Switching back restores the saved category preferences. Turn off conversation reading to release its timeline contributions without disabling attachments or session history.

Streaming prose, image messages, attachments, unsupported Markdown, file links, unknown tool shapes, and oversized content retain host rendering. Image-only messages can still use Essentials' gallery; mixed image and text messages stay native. Presentation follows the active Paseo theme. Essentials does not contribute or switch themes.

These controls replace the conversation features previously bundled with the removed Codex theme package. Existing preferences can be moved to Essentials without changing its media settings; see the [migration guide](../../docs/migration.md#会话阅读并入-essentials). Preferences are scoped to the daemon host.

The [conversation reading contract](../../docs/conversation-reading.md) documents content ownership, plugin coexistence, settings, and cleanup requirements.

### Turn changes

After a turn that changes files or creates commits, Essentials adds a timeline card with changed paths, line counts and commit subjects. Select a file to open its saved diff in the Turn changes panel. Image changes offer before-and-after previews. The card lists up to 20 files and 10 commits; View all changes opens the recorded turn. Command Center → Essentials · Open turn changes opens All turns, with pagination through this agent's retained history.

Turn changes is enabled by default and independent of conversation reading, attachments and session history. Turn it off in Essentials → Features to stop new snapshots and hide its cards and command; retained history remains on the daemon. There is no retroactive capture of earlier turns. Non-Git directories, repositories without an initial commit, and turns without a usable start snapshot do not produce a card. Concurrent turns sharing a Git worktree display a warning because their edits cannot be attributed separately.

Snapshots compare working files at turn start and end, including changes already present at the start as the baseline. A separate temporary index preserves the real staging area. Eligible untracked files are included, ignored files are excluded, and untracked files over 1 MiB are listed without saved contents. Tracked files have no corresponding size exclusion. See Data access and limits below for storage and retention.

This feature independently implements the behavior described by [HiepPP's Turn Diff](https://paseo.sh/plugins/hieppp/turn-diff). Running multiple plugins that generate turn cards can produce duplicate cards.

### Conversation media

The Media composer entry appears after a metadata check finds attachments in the conversation. You can also open the panel with the Command Center attachment action or the /media command. Search by name or source, filter by media type, and load older history. The metadata check pages through conversation history so an empty newest page does not hide older attachments.

Complete assistant and user messages containing only images are rendered as compact galleries through Paseo's timeline pipeline. Mixed text stays in Paseo's renderer. Select an image to open the viewer in Paseo's standard dialog or sheet; its size, safe areas, title, close control, and Escape dismissal are host-owned. This lets Paseo close the preview before considering its conversation interrupt shortcut. The viewer supports previous and next navigation, zoom, pan, and reset. On desktop the mouse wheel zooms around the cursor, dragging pans a zoomed image, double click resets, and the left/right arrow keys switch images; the viewer takes focus when it opens and keeps its arrow shortcuts inside the preview. Source details and thumbnails are collapsed by default to leave more room for the image. Image gestures are enabled by default; navigation controls and arrow keys remain available when gestures are disabled.

The attachment panel shows image previews, lets you play supported local audio, and presents video, document, and file references as cards. HTTP(S) sources can be opened through Paseo's external URL handler. Local video, PDF, and other file contents are not downloaded or previewed in the plugin.

### Workspace sessions

Use the workspace header's Session button or the Command Center restore action to browse sessions in the current workspace. Search by session name or provider. Selecting a closed, persistent session reloads the same session ID; selecting a session that is already running opens it directly. The history list is limited to the selected workspace and the records retained by its daemon.

### Settings

Preferences are scoped to the selected host and apply to every device connected to that host:

- Attachments enables media indexing and the composer entry.
- Group image-only messages enables or disables gallery transformation.
- Visible thumbnails sets the collapsed gallery count from 1 to 8. The default is 3.
- Image gestures enables zoom, pan, and reset gestures, including desktop wheel zoom. The default is on. Arrow-key navigation is unaffected by this switch.
- Session history enables the workspace session list and restore actions. The default is on.
- Audio playback enables new playback requests for supported local audio. The default is on. Paseo exposes no stop control for an already playing clip.
- Turn changes enables per-turn Git snapshots, timeline cards and saved change history. The default is on.

## Host interaction checks

See [VALIDATION.md](VALIDATION.md) for evidence and remaining device checks, and the [component fixture guide](tests/browser/README.md) for repeatable browser scenarios. Fixture results do not prove native device behavior. Marketplace screenshots and publication are separate follow-up work.

## Data access and limits

For attachments, the daemon finds media references in the selected conversation's public timeline and structured tool results without scanning workspace directories. Before reading local image or audio content, it confirms the source appears in that conversation's history. A referenced path can be outside the workspace and is read on the daemon host. Local image and supported audio reads are limited to 16 MiB per item. HTTP(S) resources are not fetched by the daemon; the client opens their original source through Paseo's external URL handler.

Turn changes reads the agent's Git repository at turn boundaries. Snapshot contents remain in its Git object database, retained by private refs under `refs/paseo-ux/turns/`. Ordinary branch pushes exclude these refs; mirror pushes include them. The daemon saves paths, commit subjects, snapshot identifiers and turn metadata under `PASEO_HOME/plugin-data/paseo-ux/turn-diff` (default `~/.paseo/plugin-data/paseo-ux/turn-diff`) with owner-only permissions. When history first loads and after recording a turn, it prunes records older than 30 days or beyond 2,000 and cleans up their snapshot refs. Removing a ref leaves its objects until Git garbage collection. Pending starts can survive plugin reload for one day; timeline cards follow the daemon's timeline lifetime, while the panel reads saved history.

Saved diff and image requests are bound to recorded agent, turn and file entries; clients cannot select arbitrary repositories or refs. Diff previews are limited to 200,000 characters and 2,000 rendered rows. Images over 3 MiB are not previewed. Snapshot errors, unavailable repositories and expired history cannot reconstruct missing changes. Diff text and image data travel to the connected Paseo client through plugin RPC; this feature makes no network requests of its own.

Capture stops at 50,000 paths, 1 GiB of input, or a 120-second snapshot deadline. A turn without a complete snapshot cannot provide saved file diffs. Oversized untracked files are compared by size, modification time and mode only; content changes that preserve those values cannot be detected.

The index follows the host's projected conversation history, including its merged messages and tool results. It covers references exposed in message text and tool details, rather than every raw event or separate attachment payload. Older tool details replaced by the host may no longer appear in this view.

Native iOS and Android behavior has not been verified on real devices. The plugin does not send conversation content to an additional model; messages and tool results sent to an agent follow the selected provider's existing Paseo configuration.

## Develop from this repository

Run these commands from the repository root:

    pnpm install --frozen-lockfile --ignore-scripts
    pnpm hooks:install
    pnpm --filter @chlrc/paseo-ux typecheck
    pnpm --filter @chlrc/paseo-ux test

The package uses the repository's pnpm workspace and lockfile. Install or reload the local plugin after changing code to pick up the new bundle. A fixed Marked build and its license are included under shared/conversation/vendor; run pnpm --filter @chlrc/paseo-ux build:markdown when intentionally updating that parser.

### Session restore configuration

The plugin invokes the public CLI on the daemon host. It inspects the selected session ID and working directory before reloading, then reads the session back to confirm the same ID is active. The CLI executable defaults to paseo and must be available on the daemon host's PATH.

- PASEO_HOME selects the daemon data directory and defaults to ~/.paseo.
- PASEO_ESSENTIALS_CLI selects a standalone executable when paseo is not the desired binary.

Set these variables in the daemon's environment. The plugin clears PASEO_HOST for the CLI call, so PASEO_HOME must point to the daemon that owns the conversation.
