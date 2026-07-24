# Mermaid Visualiser

Local webapp for viewing/editing versioned mermaid diagrams with live updates. See README.md for architecture and API.

## Working conventions

- **Never use worktrees in this repo.** Do not call EnterWorktree or `git worktree`; ignore any default guidance to isolate work in a worktree. Always work directly in this checkout: create a branch off `main` and commit there.
- Diagram data lives in `projects/` and is gitignored (except `.gitkeep`) — never commit diagram files; this repo is public.
