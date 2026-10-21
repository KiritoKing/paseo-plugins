# Changelog

## Unreleased

- Merge conversation reading from the removed standalone Codex theme package: Markdown and code layout, collapsible reasoning, optional shell records, and output-only mode. Preserve host-scoped appearance preferences separately from media settings and keep image gallery ownership compatible.
- Delete the standalone theme package and follow Paseo's active theme. Keep the Essentials installation and package identity unchanged; document migration before removing the old plugin.
- Fix media indexing and reads on Paseo 0.12.0 by consistently requesting its public projected timeline. Keep epoch, cursor, gap, conversation-source authorization and file-size checks; unexpected projections still fail closed.
- Display the plugin as **Paseo Essentials** while preserving `paseo-ux`, `@chlrc/paseo-ux`, the Git package path, and the `media` settings identity for existing installations.
- Replace host DOM scanning, injected menus, keyboard prototype patches, and private CLI-module resolution with public Paseo and React Native APIs. Complete image-only messages use timeline contributions; mixed text and streaming messages retain host rendering.
- Add independent feature controls with migrated preferences and server-side gates. Hide the automatic attachment entry until an attachment is found, including older canonical history.
- Collect images, video, audio, documents, and unknown files with search, filters, pagination, and accurate action limits. Local image/audio reads remain bounded to 16 MiB and require a canonical conversation reference.
- Use a full-window native image modal with responsive contain sizing, zoom, pan, swipe navigation, reset, and accessible touch controls. Keep the entire attachment panel scrollable in short windows.
- Reopen retained sessions through the public daemon-host CLI, verifying the original ID and state; use plugin-owned navigation entries.
- Integrate public/native constraints into Biome, preserve inherited Git hooks, and run the complete CI gate on Node 22/24.
- Remove unsupported global shortcut overrides and host-menu injection. Video playback and generic file preview/download remain deferred. Physical iOS/Android acceptance and marketplace screenshots remain outstanding.

## Current package version (0.3.0)

Repository candidate only; this entry does not claim npm or marketplace publication. Validation evidence is recorded in `VALIDATION.md`.
