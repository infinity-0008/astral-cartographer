# Frontend design decisions — M3 Astral Cartographer

The design choices below were provided by the project owner and are now reflected in the client implementation.

- **Visual style:** professional developer tool, with restrained colour, technical hierarchy and a dark theme.
- **First screen:** repository launch page that accepts a public GitHub URL or ZIP upload.
- **Workspace:** graph-first layout with an adjacent details panel.
- **Device targets:** responsive desktop/laptop, preserving the main workflows on mobile.
- **Reference direction:** dark-mode FAQ landing page layout. The launch page includes a collapsible FAQ and a clear workflow section; the analysis workspace uses a code-editor/dashboard visual language.

## Implemented screens

- Launch page: GitHub URL form, ZIP drag/drop, source scope, recent analyses, capability cards, workflow and FAQ.
- Processing page: stage-by-stage progress from the backend SSE endpoint, with status polling as fallback.
- Atlas workspace: Cytoscape file/folder graph, extension and risk filters, cycle-only filter, colour modes, searchable nodes, code and metrics panel.
- Analysis views: hotspot scatter and table, circular-dependency paths, starter-file recommendations, learning levels and change-impact checker.

## UI/UX implementation notes

- Keyboard search shortcut: `Ctrl/Cmd + K`; arrow keys move through results; `Enter` opens a match; `Escape` clears and closes the search input.
- Graph canvas uses a frozen `fcose` layout per graph/filter change rather than re-running force layout continuously during pan/zoom.
- User-controlled reduced-motion preferences are respected.
- Mobile uses a bottom navigation rail and collapsible details controls instead of requiring the desktop three-column layout.
