# Figma MCP Bridge

[![Pairing with Hopp](https://gethopp.app/git/hopp-shield.svg?ref=hopp-repo)](https://gethopp.app)

- [Demo](#demo)
- [Quick Start](#quick-start)
- [Available Tools](#available-tools)
- [Local development](#local-development)
- [Structure](#structure)
- [How it works](#how-it-works)

<br/>

<img src="https://raw.githubusercontent.com/gethopp/figma-mcp-bridge/main/logo.png" alt="Figma MCP Bridge" align="center" />

<br/>

> [!NOTE]  
> Requires the Figma desktop app (macOS/Windows). The browser version of Figma does not support importing development plugins.

While other amazing Figma MCP servers like [Figma-Context-MCP](https://github.com/GLips/Figma-Context-MCP/) exist, one issues is the [API limiting](https://github.com/GLips/Figma-Context-MCP/issues/258) for free users.

The limit for free accounts is 6 requests per month, yes **per month**.

Figma MCP Bridge is a solution to this problem. It is a plugin + MCP server that streams live Figma document data to AI tools without hitting Figma API rate limits, so its Figma MCP for the rest of us ✊

It supports **multiple Figma files connected simultaneously**; open the plugin in each file and your AI agent can query any of them by `fileKey`. Single-file setups work exactly as before with no changes required.

It also includes a small, opt-in set of **write tools** for safe agent-driven edits — see [Editing Notes](#editing-notes) below.

## Demo

[Watch a demo of building a UI in Cursor with Figma MCP Bridge](https://youtu.be/ouygIhFBx0g)

[![Watch the video](https://img.youtube.com/vi/ouygIhFBx0g/maxresdefault.jpg)](https://youtu.be/ouygIhFBx0g)

## Quick Start

### 1. Add the MCP server to your favourite AI tool

Add the following to your AI tool's MCP configuration (e.g. Cursor, Windsurf, Claude Desktop):

```json
{
  "figma-bridge": {
    "command": "npx",
    "args": ["-y", "@gethopp/figma-mcp-bridge"]
  }
}
```

That's it — no binaries to download or install.

### 2. Add the Figma plugin

Download the plugin from the [latest release](https://github.com/gethopp/figma-mcp-bridge/releases) page, then in Figma go to `Plugins > Development > Import plugin from manifest` and select the `manifest.json` file from the `plugin/` folder. The same plugin runs in Figma design files, Dev Mode (read-only), and FigJam boards.

### 3. Start using it 🎉

Open a Figma file, run the plugin, and start prompting your AI tool. The MCP server will automatically connect to the plugin.

To work across multiple files, just open the plugin in each Figma file. The bridge keeps all connections active and your AI agent can target any of them by `fileKey`.

If you want to know more about how it works, read the [How it works](#how-it-works) section.

## Available Tools

| Tool                           | Description                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `list_files`                   | List all connected Figma files (supports multi-file workflows)                                           |
| `get_document`                 | Get the current Figma page document tree                                                                 |
| `get_selection`                | Get the currently selected nodes in Figma                                                                |
| `get_node`                     | Get a specific Figma node by ID (colon format, e.g. `4029:12345`)                                        |
| `get_prototype_connections`    | Read prototype interactions on a node and its descendants                                                |
| `trace_prototype_flow`         | Trace prototype navigation between screens                                                               |
| `get_styles`                   | Get all local paint, text, effect, and grid styles                                                       |
| `get_metadata`                 | Get file name, pages, and current page info                                                              |
| `get_design_context`           | Get a depth-limited tree optimized for understanding design context                                      |
| `get_variable_defs`            | Get all variable collections, modes, and values (design tokens)                                          |
| `get_screenshot`               | Export nodes as PNG/SVG/JPG/PDF (base64-encoded)                                                         |
| `save_screenshots`             | Export and save screenshots directly to the local filesystem                                             |
| `get_motion_styles`            | List all available animation presets (beta)                                                              |
| `get_node_motion`              | Read a node's current animation styles and properties (beta)                                             |
| `apply_animation_style`        | Apply a preset animation style to a node (beta)                                                          |
| `remove_animation_style`       | Remove an applied animation style from a node (beta)                                                     |
| `apply_manual_keyframe_track`  | Apply a manual keyframe track to a node property (beta)                                                  |
| `remove_manual_keyframe_track` | Remove a manual keyframe track from a node property (beta)                                               |
| `set_timeline_duration`        | Set the duration of a timeline in seconds (beta)                                                         |
| `set_node_visibility`          | Show or hide specific nodes                                                                              |
| `set_text_content`             | Replace the contents of a text node (TEXT, FigJam sticky, or shape label)                                |
| `set_text_properties`          | Patch font, size, alignment, auto-resize, color, and bounds on text nodes/sublayers                      |
| `set_node_properties`          | Patch common node properties: name, position, size, visibility, opacity, corner radius (single or batch) |
| `set_solid_fill`               | Replace a node's fill or stroke with a single solid paint                                                |
| `set_gradient_fill`            | Replace a node's fill or stroke with a linear/radial/angular/diamond gradient                            |
| `set_effects`                  | Replace a node's effects list (drop/inner shadows, layer/background blurs)                               |
| `set_stroke_properties`        | Patch stroke weight, align, dash pattern, cap, and join                                                  |
| `set_auto_layout`              | Configure auto-layout direction, padding, gap, alignment, sizing, and wrap (not sections)                |
| `create_page`                  | Create a new page in the document, optionally switching to it                                            |
| `create_frame`                 | Create a new frame, optionally under a parent                                                            |
| `create_section`               | Create a section — a named, resizable container (Figma and FigJam)                                       |
| `create_text`                  | Create a new text node                                                                                   |
| `create_shape`                 | Create a rectangle, ellipse, or line                                                                     |
| `create_shape_with_text`       | Create a FigJam shape with its own text label (SHAPE_WITH_TEXT), incl. text fill                         |
| `create_image`                 | Create an image-backed rectangle from a local path, URL, or data URI                                     |
| `create_svg`                   | Import raw SVG markup or a workspace-local SVG file as editable vector layers                            |
| `create_sticky`                | Create a sticky note in FigJam                                                                           |
| `create_connector`             | Create a connector between two nodes in FigJam, with attachment anchors                                  |
| `import_html_layers`           | Bulk-import an html-figma layer tree (JSON) as frames, text, rectangles, and vectors                     |
| `duplicate_nodes`              | Duplicate nodes in place                                                                                 |
| `duplicate_with_offset`        | Duplicate nodes and move each duplicate by a fixed offset                                                |
| `fit_to_content`               | Resize a SECTION around its children with optional padding                                               |
| `distribute_horizontally`      | Space 3+ nodes with equal horizontal gaps (first/last stay fixed)                                        |
| `distribute_vertically`        | Space 3+ nodes with equal vertical gaps (first/last stay fixed)                                          |
| `align_to_grid`                | Snap node positions to a grid of the given size                                                          |
| `place_below`                  | Move a node below another with gap and start/center alignment                                            |
| `place_right_of`               | Move a node to the right of another with gap and start/center alignment                                  |
| `reparent_nodes`               | Move nodes into another parent                                                                           |
| `group_nodes`                  | Wrap a list of nodes (sharing a parent) in a new group                                                   |
| `ungroup_node`                 | Ungroup a group or frame — children move up to its parent                                                |
| `set_selection`                | Set the page selection to a list of node IDs (works in Dev Mode)                                         |
| `scroll_and_zoom_into_view`    | Frame the viewport around the given nodes (works in Dev Mode)                                            |
| `delete_nodes`                 | Delete nodes with explicit confirmation                                                                  |

All tools accept an optional `fileKey` parameter when multiple Figma files are connected. Use `list_files` to discover connected files and their keys.

### Inspection & Measurement

| Tool                 | Description                                                                                                                                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_node_details`   | Deep inspection of one node or page: absolute/local bounds, transforms, rotation, fills/strokes/effects as hex, opacity, blend mode, constraints, corner radii, auto-layout, grids, export settings, style IDs, bound variables/modes, component properties, text segments, and vector paths. `depth` recurses into descendants |
| `measure_nodes`      | Precise measurement of one or many nodes: document-absolute boxes, local geometry, rotation, constraints, auto-layout, pairwise gaps (negative = overlap), overlap area, containment, and edge/center alignment                                                                                                                 |
| `find_nodes`         | Search a page or subtree by name (contains/exact/regex) and/or node type; returns IDs, layer paths, and bounds                                                                                                                                                                                                                  |
| `get_components`     | List every local component and component set with IDs, keys, descriptions, bounds, variants, and property definitions                                                                                                                                                                                                           |
| `get_image_data`     | Read the image behind an IMAGE paint, or fetch by hash: dimensions and base64 bytes                                                                                                                                                                                                                                             |
| `get_node_variables` | List every variable bound to a node plus values per mode and the value resolved for that node, and explicit/resolved variable modes                                                                                                                                                                                             |

### Appearance, Layout & Text

| Tool                  | Description                                                                                                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `set_node_appearance` | Batch-patch name, visibility, lock, opacity, blend mode, mask, clipsContent, constraints, corner radii, corner smoothing, min/max size, layout sizing/align/grow/positioning, strokes-in-layout, and grid spans |
| `set_layout_grids`    | Replace a frame's layout grids (GRID/COLUMNS/ROWS); pass `[]` to clear                                                                                                                                          |
| `set_export_settings` | Replace a node's export settings (format, scale/size constraints, suffix, SVG options); pass `[]` to clear                                                                                                      |
| `set_style_reference` | Attach or detach paint/text/effect/grid/background styles on a node                                                                                                                                             |
| `reorder_nodes`       | Move nodes in the layer/paint order: FRONT, BACK, FORWARD, BACKWARD, INDEX, BEFORE, AFTER                                                                                                                       |
| `align_nodes`         | Align nodes to the union, their parent, or a reference node (rotation-aware)                                                                                                                                    |
| `set_image_fill`      | Apply an image fill/stroke from a path, URL, data URI, or existing `imageHash`, with FILL/FIT/CROP/TILE and a 2×3 transform                                                                                     |
| `set_text_advanced`   | Character-range text editing: characters, font, size, color, letter spacing, line height, case, decoration, hyperlink, paragraph spacing/indent, style ID, alignment, auto-resize, truncation                   |

### Components, Vectors & Design Tokens

| Tool                         | Description                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `create_component`           | Convert an existing node or create a new main component                                             |
| `create_component_set`       | Combine two or more components into a variant set                                                   |
| `create_instance`            | Instantiate a component/component set with size, position, parent, and property overrides           |
| `update_instance`            | Set properties, swap the main component (preserving overrides), reset overrides, or detach          |
| `add_component_property`     | Add a BOOLEAN, TEXT, INSTANCE_SWAP, VARIANT, or SLOT property with a default                        |
| `edit_component_property`    | Rename/reconfigure a property, its default, preferred values, or SLOT description                   |
| `delete_component_property`  | Delete a component property (requires `confirm: true`)                                              |
| `boolean_operation`          | UNION, SUBTRACT, INTERSECT, or EXCLUDE two or more nodes                                            |
| `flatten_nodes`              | Flatten nodes into a single editable vector                                                         |
| `outline_stroke`             | Convert a stroke into an editable vector outline                                                    |
| `create_vector`              | Create an editable vector from SVG path data, with fill, stroke, size, rotation, and parent         |
| `set_vector_paths`           | Replace a vector's geometry, optionally resizing and restyling it                                   |
| `create_style`               | Create a local paint, text, effect, or grid style                                                   |
| `update_style`               | Update a local style's name, description, and definition                                            |
| `delete_style`               | Delete a local style (requires `confirm: true`)                                                     |
| `create_variable_collection` | Create a variable collection with modes and publishing visibility                                   |
| `create_variable`            | Create a COLOR/FLOAT/STRING/BOOLEAN token with default and per-mode values, description, and scopes |
| `set_variable_value`         | Set a variable's value for a mode                                                                   |
| `update_variable`            | Rename a variable, change its description/scopes/visibility, and set per-mode values                |
| `delete_variable`            | Delete a local variable (requires `confirm: true`)                                                  |
| `update_variable_collection` | Rename a collection, toggle publishing visibility, add, rename, or remove modes                     |
| `delete_variable_collection` | Delete a local variable collection and all its variables (requires `confirm: true`)                 |
| `bind_variable`              | Bind/unbind a variable to a node field or to the color of a specific fill/stroke paint              |
| `set_variable_mode`          | Set or clear a node's explicit mode for a collection                                                |
| `set_reactions`              | Write prototype reactions on a node (Figma `Reaction[]`), pass `[]` to clear                        |
| `update_page`                | Rename a page, switch to it, replace backgrounds, set flow starting points, or delete it            |

### Prototype Notes

- Prototype tools are read-only and unavailable in FigJam. Set `includePrototype: true` on `get_node` to include the same interactions.
- Reactions are Figma's own trigger and action data, with destinations, variables, and modes resolved to names.
- Flow edges list their enclosing branch `conditions` from outermost to innermost (`null` marks an else branch).
- Observed `AFTER_TIMEOUT` values are in seconds (for example, `0.8` for 800 ms).

### Editing Notes

- Edit tools work only when the plugin is opened in Figma's design editor (Dev Mode is read-only — they will return a clear error there).
- In **FigJam**, read tools plus the write tools (`set_text_content`, `set_text_properties`, `set_node_properties`, `set_solid_fill`, `create_text`, `create_shape`, `create_shape_with_text`, `create_sticky`, `create_connector`, `create_section`, `duplicate_nodes`, `duplicate_with_offset`, `fit_to_content`, `distribute_horizontally`, `distribute_vertically`, `align_to_grid`, `place_below`, `place_right_of`, `delete_nodes`, ...) are available. Auto-layout and motion/animation tools return a clear error in FigJam.
- `set_text_content` / `set_text_properties` edit a TEXT node's content directly, or the text sublayer of a FigJam STICKY / SHAPE_WITH_TEXT node. Alignment and auto-resize are TEXT-node-only — they return a clear error on stickies and shapes (x/y/width/height still apply to the containing node).
- `set_node_properties` accepts either `nodeId` or a `nodeIds` array to apply the same property changes to several nodes in one call.
- `set_auto_layout` targets frames; SECTION nodes have no auto-layout in Figma's API and return an explicit error.
- `fit_to_content` works on SECTION nodes only (Figma's API exposes no equivalent for other containers): it shifts children so their bounding box starts at `padding` and resizes the section to bbox + 2×padding.
- The current user must have permission to edit the target file.
- `delete_nodes` is intentionally gated behind `confirm: true`.
- Text edits automatically load the fonts currently used by the target text node before applying the new content.
- New text nodes default to `Inter Regular` unless a font is provided.
- `create_image` reads local paths relative to the MCP server working directory unless you pass an absolute path.
- `create_svg` accepts raw `<svg>` markup or a local SVG path inside the MCP server working directory. SVG payloads are limited to 2 MiB.
- `import_html_layers` takes a JSON file produced by [html-figma](https://github.com/sergcen/html-to-figma)'s browser `htmlToFigma()`. The path resolves relative to the MCP server working directory and must stay inside it, even when absolute. Everything lands inside one wrapper frame, and the response reports `layerCount` against `expectedLayerCount` so partial imports are visible.
- `create_page` returns the new page's ID — pass it as `parentId` to `create_frame` / `create_text` / `create_shape` / `create_image` to author content on that page without switching the editor.
- `get_node_details` returns the same value shapes the write tools accept (`fills`/`strokes` as `{ type, color }` hex summaries from `get_node`; `vectorPaths`, `layoutGrids`, and `exportSettings` are native Figma objects), so inspect-then-write loops stay lossless.
- `measure_nodes` reports document-absolute boxes (rotation-aware bounding boxes), gaps, overlaps, and alignment flags, which is usually more precise than reading screenshots.
- `set_text_advanced` loads every font used by the range before editing and also works on empty text nodes when replacing `characters`.
- `set_image_fill` resolves local paths, HTTP(S) URLs, and data URIs on the server side, then sends the bytes to the plugin; the same path/URL rules as `create_image` apply.
- `create_vector` / `set_vector_paths` take SVG path data (`{ windingRule, data }`); the plugin rebuilds the geometry natively.
- `create_component_set` needs at least two COMPONENT nodes; `add_component_property` supports BOOLEAN, TEXT, INSTANCE_SWAP, VARIANT, and SLOT.
- Variable tools only write local collections/variables; library (remote) styles and variables are read-only and return an explicit error.
- `update_variable_collection` can add, rename, and remove modes; the collection's default mode cannot be removed.
- Destructive tools (`delete_style`, `delete_variable`, `delete_variable_collection`, `delete_component_property`, and page deletion via `update_page`) require `confirm: true`.
- `bind_variable` accepts any field Figma exposes on the node (`fills`, `strokes`, `opacity`, `width`, `cornerRadius`, `itemSpacing`, `fontSize`, ...); use `get_node_variables` to see the exact field names already in use. Pass `variableId: null` to unbind.
- `set_reactions` expects Figma's own `Reaction[]` shape, including triggers, actions, destination IDs, and variable actions; set `flowStartingPoints` via `update_page`.
- `update_page` requires `confirm: true` to delete a page and refuses to delete the last remaining page.

### What You Can Build

The tool surface covers the full authoring loop, so an agent can inspect and edit a Figma file end to end without the REST API: measure geometry and spacing, read colors/effects/styles as concrete values, build frames and slide decks, author text down to per-character ranges, create and combine vectors, build component/variant libraries with instances and property overrides, create design tokens (variables and modes) and bind them to nodes, wire prototype reactions and flows, and manage pages and exports.

Advanced (read-only) inspection — `get_node_details`, `measure_nodes`, `find_nodes`, `get_components`, `get_image_data`, `get_node_variables` — works in the design editor, Dev Mode, and FigJam where the underlying API allows it. Every mutating advanced tool requires the design editor, like the rest of the write surface.

## Local development

This repo uses [Bun](https://bun.sh) as its package manager and script runner throughout. Install it first if you don't have it.

#### 1. Clone this repository locally

```bash
git clone git@github.com:gethopp/figma-mcp-bridge.git
```

#### 2. Install root tooling

Install the root dependencies once. This runs Husky's `prepare` script, which installs the Git pre-commit hook that formats staged files with Prettier.

```bash
cd figma-mcp-bridge && bun install
```

#### 3. Build the server

```bash
cd server && bun install && bun run build
```

#### 4. Build the plugin

```bash
cd plugin && bun install && bun run build
```

#### 5. Add the MCP server to your favourite AI tool

For local development, add the following to your AI tool's MCP config:

```json
{
  "figma-bridge": {
    "command": "node",
    "args": ["/path/to/figma-mcp-bridge/server/dist/index.js"]
  }
}
```

### Code style

The repo is formatted with [Prettier](https://prettier.io) (config in `.prettierrc`). A Husky pre-commit hook runs `lint-staged`, which formats only your staged files, so commits stay formatted automatically. You can also run it manually:

```bash
bun run format        # format the whole repo
bun run format:check  # verify formatting without writing (useful in CI)
```

## Structure

```
Figma-MCP-Bridge/
├── plugin/   # Figma plugin (TypeScript/React)
└── server/   # MCP server (TypeScript/Node.js)
    └── src/
        ├── index.ts      # Entry point
        ├── bridge.ts     # WebSocket bridge to Figma plugin
        ├── leader.ts     # Leader: HTTP server + bridge
        ├── follower.ts   # Follower: proxies to leader via HTTP
        ├── node.ts       # Dynamic leader/follower role switching
        ├── election.ts   # Leader election & health monitoring
        ├── tools.ts      # Core MCP tool definitions
        ├── tools-advanced.ts # Advanced MCP tools (measurement, styles, components, variables)
        └── types.ts      # Shared types
```

The plugin keeps the request handlers split by concern: `code.ts` holds the core
switch, and `advanced-read.ts`, `advanced-write.ts`, `advanced-design.ts`, and
`advanced-shared.ts` implement the advanced surface behind
`handleAdvancedRequest()`.

## How it works

There are two main components to the Figma MCP Bridge:

### 1. The Figma Plugin

The Figma plugin is the user interface for the Figma MCP Bridge. You run this inside the Figma file you want to use the MCP server for, and its responsible for getting you all the information you need.

### 2. The MCP Server

The MCP server is the core of the Figma MCP Bridge. It maintains a registry of WebSocket connections keyed by `fileKey`, so multiple Figma files can be connected simultaneously. The server is responsible for:

- Handling WebSocket connections from one or more Figma plugin instances
- Routing tool calls to the correct file based on `fileKey`
- Forwarding responses back to the AI client
- Handling leader election (as we can have only one WS connection to an MCP server at a time)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FIGMA (Desktop app)                               │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                         Figma Plugin                                  │  │
│  │                    (TypeScript/React)                                 │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ WebSocket
                                      │ (ws://localhost:1994/ws)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          PRIMARY MCP SERVER                                 │
│                         (Leader on :1994)                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  Bridge                                    Endpoints:               │    │
│  │  • Manages WebSocket conn                  • /ws    (plugin)        │    │
│  │  • Forwards requests to plugin             • /ping  (health)        │    │
│  │  • Routes responses back                   • /rpc   (followers)     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                           ▲                              ▲
                           │ HTTP /rpc                    │ HTTP /rpc
                           │ POST requests                │ POST requests
                           │                              │
         ┌─────────────────┴───────────┐    ┌─────────────┴───────────────┐
         │    FOLLOWER MCP SERVER 1    │    │    FOLLOWER MCP SERVER 2    │
         │                             │    │                             │
         │  • Pings leader /ping       │    │  • Pings leader /ping       │
         │  • Forwards tool calls      │    │  • Forwards tool calls      │
         │    via HTTP /rpc            │    │    via HTTP /rpc            │
         │  • If leader dies →         │    │  • If leader dies →         │
         │    attempts takeover        │    │    attempts takeover        │
         └─────────────────────────────┘    └─────────────────────────────┘
                    ▲                                      ▲
                    │                                      │
                    │ MCP Protocol                         │ MCP Protocol
                    │ (stdio)                              │ (stdio)
                    ▼                                      ▼
         ┌─────────────────────────────┐    ┌─────────────────────────────┐
         │      AI Tool / IDE 1        │    │      AI Tool / IDE 2        │
         │      (e.g., Cursor)         │    │      (e.g., Cursor)         │
         └─────────────────────────────┘    └─────────────────────────────┘
```
