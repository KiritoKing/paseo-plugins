# Paseo Essentials

Paseo Essentials helps you browse conversation attachments, view images, and return to workspace sessions. It groups complete image-only messages into compact galleries, provides a searchable attachment panel, and lets you browse and reopen restorable sessions in the current workspace.

Image-only assistant and user messages are displayed as galleries; mixed text remains in Paseo's renderer. The attachment panel indexes references in the selected conversation's public timeline and structured tool results. Search by name or path, filter by media type, and load older history. The composer entry appears after the metadata index finds attachments in the conversation.

The index covers references exposed in the host's message text and tool details. It follows the host's merged conversation view; it does not recover old tool details or separate attachment payloads omitted from that history.

Paseo 0.11.2 or later is required. Reopening a session uses the public Paseo CLI on the daemon host. The executable must be available on that host's PATH. PASEO_HOME selects the daemon data directory and defaults to ~/.paseo; PASEO_ESSENTIALS_CLI can select a different executable. The plugin does not require a separate account, token, or model. Preferences are scoped to a host and apply to devices connected to it.

Settings control attachment indexing, image grouping, visible thumbnail count, image gestures, session history, and audio playback. These switches default to on. The thumbnail count ranges from 1 to 8 and defaults to 3. Supported local audio can be played on request. Video, PDF, and other files appear as attachment cards; the plugin has no in-app video player or PDF reader. Native iOS and Android behavior has not been verified on real devices.

The daemon reads public conversation history and structured tool results to find media references. It does not scan workspace directories. Before reading local image or audio content, it confirms that the source appears in the conversation history; a referenced path can resolve outside the workspace. Local image and supported audio reads are limited to 16 MiB. HTTP(S) sources open through Paseo's external URL handler; the daemon does not fetch them. The plugin does not send conversation content to an additional model; messages and tool results sent to an agent follow the selected provider's existing Paseo configuration.
