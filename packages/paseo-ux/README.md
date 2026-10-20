# Paseo Essentials

Paseo Essentials adds conversation attachment browsing, image galleries, and workspace session history to Paseo. The npm package is @chlrc/paseo-ux. The manifest ID remains paseo-ux to preserve the existing plugin identity and settings namespace.

## Requirements

- Paseo app and daemon 0.11.2 or later.
- Node.js 22 or 24 and pnpm 10.34.7 for repository development.
- Session restoration requires the public Paseo CLI on the daemon host's PATH.

## Install from this checkout

Install the plugin on the daemon that will host it. From the repository root:

    cd packages/paseo-ux
    paseo plugin install .
    paseo plugin reload paseo-ux

For a remote daemon, install and reload the plugin on that daemon host. Do not rely on a CLI running on another machine to restore sessions.

## Use the plugin

### Conversation media

The Media composer entry appears after a metadata check finds attachments in the conversation. You can also open the panel with the Command Center attachment action or the /media command. Search by name or source, filter by media type, and load older history. The metadata check pages through conversation history so an empty newest page does not hide older attachments.

Complete assistant and user messages containing only images are rendered as compact galleries through Paseo's timeline pipeline. Mixed text stays in Paseo's renderer. Select an image to open the full-screen viewer. The viewer supports previous and next navigation, zoom, pan, and reset. Source details and thumbnails are collapsed by default to leave more room for the image. Image gestures are enabled by default; navigation controls remain available when gestures are disabled.

The attachment panel shows image previews, lets you play supported local audio, and presents video, document, and file references as cards. HTTP(S) sources can be opened through Paseo's external URL handler. Local video, PDF, and other file contents are not downloaded or previewed in the plugin.

### Workspace sessions

Use the workspace header's Session button or the Command Center restore action to browse sessions in the current workspace. Search by session name or provider. Selecting a closed, persistent session reloads the same session ID; selecting a session that is already running opens it directly. The history list is limited to the selected workspace and the records retained by its daemon.

### Settings

Preferences are scoped to the selected host and apply to every device connected to that host:

- Attachments enables media indexing and the composer entry.
- Group image-only messages enables or disables gallery transformation.
- Visible thumbnails sets the collapsed gallery count from 1 to 8. The default is 3.
- Image gestures enables zoom, pan, and reset gestures. The default is on.
- Session history enables the workspace session list and restore actions. The default is on.
- Audio playback enables new playback requests for supported local audio. The default is on. Paseo exposes no stop control for an already playing clip.

## Host interaction checks

See [VALIDATION.md](VALIDATION.md) for evidence and remaining device checks, and the [component fixture guide](tests/browser/README.md) for repeatable browser scenarios. Fixture results do not prove native device behavior. Marketplace screenshots and publication are separate follow-up work.

## Data access and limits

The daemon finds media references in the selected conversation's canonical timeline and structured tool results. It does not scan workspace directories. Before reading local image or audio content, it confirms the source appears in that conversation's history. A referenced path can be outside the workspace and is read on the daemon host. Local image and supported audio reads are limited to 16 MiB per item. HTTP(S) resources are not fetched by the daemon; the client opens their original source through Paseo's external URL handler.

Native iOS and Android behavior has not been verified on real devices. The plugin does not send conversation content to an additional model; messages and tool results sent to an agent follow the selected provider's existing Paseo configuration.

## Develop from this repository

Run these commands from the repository root:

    pnpm install --frozen-lockfile --ignore-scripts
    pnpm hooks:install
    pnpm --filter @chlrc/paseo-ux typecheck
    pnpm --filter @chlrc/paseo-ux test

The package uses the repository's pnpm workspace and lockfile. Install or reload the local plugin after changing code to pick up the new bundle.

### Session restore configuration

The plugin invokes the public CLI on the daemon host. It inspects the selected session ID and working directory before reloading, then reads the session back to confirm the same ID is active. The CLI executable defaults to paseo and must be available on the daemon host's PATH.

- PASEO_HOME selects the daemon data directory and defaults to ~/.paseo.
- PASEO_ESSENTIALS_CLI selects a standalone executable when paseo is not the desired binary.

Set these variables in the daemon's environment. The plugin clears PASEO_HOST for the CLI call, so PASEO_HOME must point to the daemon that owns the conversation.
