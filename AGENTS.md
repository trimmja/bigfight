# Agent Instructions

Project-wide agent instructions live in [CLAUDE.md](CLAUDE.md). Read and follow that file.

## Codex-specific: Computer Use

- When Jacob asks for Computer Use specifically, use it for the requested outcome and say
  precisely what used Computer Use versus another controller. Do not imply that a Chrome-controller
  action was Computer Use.
- Prove the capability with the real requested result (for example, a live game capture), not a
  successful setup call. Prefer accessibility-element actions; coordinate clicks have been flaky.
- A Computer Use tool-preview image may not appear in the chat. For any requested screenshot,
  save the capture to a visible absolute local path and embed it with normal Markdown in the final
  response; never only say that the image was "above".

Keep future Codex-specific instruction updates in this file; keep shared project instructions in
`CLAUDE.md`.
