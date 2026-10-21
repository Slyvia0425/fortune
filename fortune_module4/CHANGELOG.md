# Changelog

## Unreleased

- Added an explicit inference-eligibility boundary for archived session events.
- Added full conversation-history storage through `conversation.message` events.
- Restricted recommendation and similar-case inputs to structured whitelist events.
- Added automatic `feedback.submitted` event creation alongside feedback records.
- Added per-user session listing with conversation counts and latest-message previews.

## 0.2.0

- Added explicit Windows-local, Linux-local, and remote-macOS-Qwen deployment modes.
- Added Linux setup, test, start, migration, seed, and CUDA/ML scripts.
- Added macOS Ollama setup and verification script for `qwen3.8:27b-q8_0`.
- Added SSH tunnel launchers for Windows and POSIX clients.
- Added `linux.env.example` and `remote_mac_qwen.env.example`.
- Added macOS CI and shell syntax validation.
- Added cross-platform deployment documentation.
- Added live end-to-end verification covering frontend compatibility routes, PostgreSQL, and remote Qwen.
- Added knowledge dataset contract validation and deterministic source-id mapping.

## 0.1.0

- Initial Module 4 backend with sessions, events, recommendations, similar cases, feedback,
  collections, notes, tags, privacy, export, deletion, hashing embeddings, and template explanations.
