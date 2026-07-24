# Mermaid Visualiser

A small local webapp for viewing and editing mermaid diagrams, organised as versioned projects on disk. Diagrams are **live**: any change to a file under `projects/` (by you, an editor, or Claude) is pushed to the browser instantly — no refresh needed.

## Run

```sh
npm install
npm start
# → http://localhost:4400
```

## How it works

- **Projects are folders**: `projects/<name>/v1.mermaid`, `v2.mermaid`, … (`.mmd` also works). The UI shows the highest version by default; a dropdown lets you view older ones.
- **Live updates**: the server watches `projects/` with `fs.watch` and broadcasts change events over Server-Sent Events (`/api/events`). The page re-fetches and re-renders the current diagram on every event.
- **Editing**: click **Edit** for a source pane with live preview. **Save** overwrites the current version; **Save as v+1** writes the next version file. You can equally just edit the files on disk.
- **Rendering** is client-side with the mermaid ESM bundle served from `node_modules` (works offline).

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/projects` | List projects with versions |
| GET | `/api/projects/:name/versions/latest` (or `/:n`) | Get diagram source |
| PUT | `/api/projects/:name/versions/:n` | Overwrite a version |
| POST | `/api/projects/:name/versions` | New version (creates the project if needed) |
| GET | `/api/events` | SSE change stream |
