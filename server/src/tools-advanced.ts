/**
 * Advanced Figma tools: deep inspection/measurement and complete control over
 * appearance, layout, text, components, vectors, styles, variables, prototypes
 * and pages.
 *
 * Every tool forwards to the plugin over the same WebSocket bridge as the core
 * tools, so nothing here depends on the Figma REST API or its rate limits.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Node } from "./node.js";
import type { BridgeResponse } from "./types.js";
import { loadImageSourceAsBase64 } from "./tools.js";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

const NODE_ID_PATTERN = /^(\d+:\d+|I\d+:\d+(;\d+:\d+)+)$/;

const nodeIdField = (description: string) =>
  z.string().regex(NODE_ID_PATTERN, description).describe(description);

const nodeIdsField = (description: string, min = 1) =>
  z.array(nodeIdField(description)).min(min).describe(description);

const fileKeyField = z
  .string()
  .optional()
  .describe(
    "The fileKey of the Figma file to query. Required when multiple files are connected. Use list_files to see connected files."
  );

const hexField = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Color must be a hex value like '#FFAA00'");

const colorValue = z.union([
  hexField,
  z.object({
    r: z.number(),
    g: z.number(),
    b: z.number(),
    a: z.number().optional(),
  }),
  z.object({ hex: hexField, a: z.number().optional() }),
]);

const vectorPathsField = z
  .array(
    z.object({
      windingRule: z.enum(["NONZERO", "EVENODD"]).optional(),
      data: z.string().min(1).describe("SVG path data, e.g. 'M 0 0 L 100 0 L 50 80 Z'"),
    })
  )
  .min(1)
  .describe("Vector paths to write");

const paintObject = z
  .object({
    type: z.string().optional(),
    visible: z.boolean().optional(),
    opacity: z.number().min(0).max(1).optional(),
    hex: hexField.optional(),
    color: z
      .union([hexField, z.object({ r: z.number(), g: z.number(), b: z.number() })])
      .optional(),
    gradientStops: z
      .array(
        z.object({
          position: z.number().min(0).max(1),
          hex: hexField.optional(),
          color: z
            .union([hexField, z.object({ r: z.number(), g: z.number(), b: z.number() })])
            .optional(),
          opacity: z.number().min(0).max(1).optional(),
        })
      )
      .optional(),
    gradientTransform: z.array(z.array(z.number()).length(3)).length(2).optional(),
    imageHash: z.string().optional(),
    scaleMode: z.enum(["FILL", "FIT", "CROP", "TILE"]).optional(),
    imageTransform: z.array(z.array(z.number()).length(3)).length(2).optional(),
  })
  .describe("Paint in the same shape returned by get_node / get_node_details");

const effectObject = z
  .object({
    type: z.enum(["DROP_SHADOW", "INNER_SHADOW", "LAYER_BLUR", "BACKGROUND_BLUR"]),
    visible: z.boolean().optional(),
    hex: hexField.optional(),
    color: z
      .union([hexField, z.object({ r: z.number(), g: z.number(), b: z.number() })])
      .optional(),
    opacity: z.number().min(0).max(1).optional(),
    offset: z.object({ x: z.number(), y: z.number() }).optional(),
    radius: z.number().min(0),
    spread: z.number().optional(),
    blendMode: z.string().optional(),
  })
  .describe("Effect in the same shape returned by get_node / get_node_details");

const lineHeightUnit = z.enum(["PIXELS", "PERCENT", "AUTO"]);

async function respond(fn: () => Promise<BridgeResponse>): Promise<ToolResult> {
  try {
    const response = await fn();
    if (response.error) return { content: [{ type: "text", text: response.error }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(response.data) }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
      isError: true,
    };
  }
}

const errorResult = (message: string): ToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

/**
 * Registers the advanced tool surface on the MCP server.
 * @param server - MCP server instance.
 * @param node - Leader/follower coordinator used to reach the plugin.
 */
export function registerAdvancedTools(server: McpServer, node: Node): void {
  /* ------------------------------------------------------------ read/measure */

  server.tool(
    "get_node_details",
    "Deep, read-only inspection of one node or page: geometry (absolute/local bounds, transforms, rotation), fills/strokes/effects as hex colors, opacity, blend mode, constraints, corner radii, auto-layout, padding, layout grids, export settings, style IDs, bound variables and modes, component/instance properties, text properties with per-character styled segments, and vector paths. Pages return backgrounds, prototype backgrounds, flow starting points, and page metadata. Set depth > 0 to include descendants. Works in Figma, Dev Mode, and FigJam. Specify fileKey when multiple files are connected.",
    {
      nodeId: nodeIdField("The node or page ID to inspect"),
      depth: z
        .number()
        .int()
        .min(0)
        .max(20)
        .optional()
        .describe("How many levels of descendants to include (default 0 = the node only)"),
      maxChildren: z
        .number()
        .int()
        .min(1)
        .max(2000)
        .optional()
        .describe("Maximum children per level when depth > 0 (default 200)"),
      includePrototype: z
        .boolean()
        .optional()
        .describe("Include the node's prototype interactions and reactions"),
      includeTextSegments: z
        .boolean()
        .optional()
        .describe("Include per-character styled text segments for TEXT nodes (default true)"),
      includeHidden: z
        .boolean()
        .optional()
        .describe("Include hidden children when recursing (default false)"),
      fileKey: fileKeyField,
    },
    async ({ nodeId, fileKey, ...params }) =>
      respond(() => node.sendWithParams("get_node_details", [nodeId], params, fileKey))
  );

  server.tool(
    "measure_nodes",
    "Measure one or more nodes in pixels: absolute bounding boxes in document coordinates, local x/y/width/height, rotation, constraints, auto-layout, plus pairwise distances, per-side gaps (left/right/top/bottom), the closest-edge distance, overlap area (negative distance = overlap), containment, and edge/center alignment. Use it to verify spacing, alignment, and overlaps without screenshots. Specify fileKey when multiple files are connected.",
    {
      nodeIds: nodeIdsField("Nodes to measure"),
      tolerance: z
        .number()
        .min(0)
        .optional()
        .describe("Pixel tolerance used for alignment flags (default 0.5)"),
      includePairs: z
        .boolean()
        .optional()
        .describe("Calculate pairwise distances/alignment (default true)"),
      fileKey: fileKeyField,
    },
    async ({ nodeIds, fileKey, ...params }) =>
      respond(() => node.sendWithParams("measure_nodes", nodeIds, params, fileKey))
  );

  server.tool(
    "find_nodes",
    "Search a page or subtree by name and/or node type and return each match with its ID, type, layer path, and bounds. Supports contains (default), exact, and regex name matching, hidden nodes, and a result cap. Specify fileKey when multiple files are connected.",
    {
      query: z.string().optional().describe("Name query (contains by default)"),
      match: z
        .enum(["contains", "exact", "regex"])
        .optional()
        .describe("How to compare the query against node names (default contains)"),
      types: z
        .array(z.string())
        .optional()
        .describe("Node types to include, e.g. ['FRAME','TEXT','COMPONENT']"),
      rootId: z
        .string()
        .optional()
        .describe("Page or scene node to search inside (default: current page)"),
      includeHidden: z.boolean().optional().describe("Include hidden nodes (default false)"),
      includeBounds: z
        .boolean()
        .optional()
        .describe("Include absolute/local bounds for each match (default true)"),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(5000)
        .optional()
        .describe("Maximum number of matches (default 100)"),
      fileKey: fileKeyField,
    },
    async ({ fileKey, ...params }) =>
      respond(() => node.sendWithParams("find_nodes", undefined, params, fileKey))
  );

  server.tool(
    "get_components",
    "List all local components and component sets in the file (or on one page) with IDs, keys, descriptions, bounds, variant properties, and component property definitions. Use the returned IDs with create_instance / update_instance. Specify fileKey when multiple files are connected.",
    {
      pageId: z.string().optional().describe("Limit the listing to one page"),
      fileKey: fileKeyField,
    },
    async ({ fileKey, ...params }) =>
      respond(() => node.sendWithParams("get_components", undefined, params, fileKey))
  );

  server.tool(
    "get_image_data",
    "Read the image behind an IMAGE fill/stroke of a node, or fetch an image by hash. Returns image dimensions and, by default, the raw bytes as base64. Useful to inspect or re-use images that already exist in the file. Specify fileKey when multiple files are connected.",
    {
      nodeId: z.string().optional().describe("Scene node whose IMAGE paints should be read"),
      imageHash: z.string().optional().describe("Image hash to fetch directly"),
      includeBase64: z
        .boolean()
        .optional()
        .describe("Include base64 bytes in the response (default true)"),
      fileKey: fileKeyField,
    },
    async ({ nodeId, imageHash, fileKey, ...params }) => {
      if (!nodeId && !imageHash) return errorResult("nodeId or imageHash is required");
      return respond(() =>
        node.sendWithParams(
          "get_image_data",
          nodeId ? [nodeId] : undefined,
          { ...params, imageHash },
          fileKey
        )
      );
    }
  );

  server.tool(
    "get_node_variables",
    "Read every variable bound to a node (fills, strokes, effects, layout grids, spacing, size, visibility, text fields, etc.) with the variable name, collection, values per mode, and the value resolved for that node. Also returns explicit and resolved variable modes. Set includeInferred to also return variables Figma infers from raw values. Specify fileKey when multiple files are connected.",
    {
      nodeId: nodeIdField("The node ID to inspect"),
      includeInferred: z
        .boolean()
        .optional()
        .describe("Also include inferred (unbound but matching) variables"),
      fileKey: fileKeyField,
    },
    async ({ nodeId, fileKey, ...params }) =>
      respond(() => node.sendWithParams("get_node_variables", [nodeId], params, fileKey))
  );

  /* ------------------------------------------------------ appearance/layout */

  server.tool(
    "set_node_appearance",
    "Patch visual and structural properties on one or many nodes in one call: name, visibility, lock, opacity, blend mode, mask, clipsContent, constraints, corner radius (uniform or per corner), corner smoothing, min/max size, layout sizing/align/grow/positioning, strokes-in-layout and grid spans. Works in Figma and FigJam (where the property exists); requires the design editor. Specify fileKey when multiple files are connected.",
    {
      nodeIds: nodeIdsField("Nodes to update"),
      name: z.string().optional(),
      visible: z.boolean().optional(),
      locked: z.boolean().optional(),
      opacity: z.number().min(0).max(1).optional(),
      blendMode: z
        .string()
        .optional()
        .describe("Figma blend mode, e.g. NORMAL, MULTIPLY, SCREEN, OVERLAY, ..."),
      isMask: z.boolean().optional(),
      maskType: z.enum(["ALPHA", "VECTOR", "LUMINANCE"]).optional(),
      clipsContent: z.boolean().optional(),
      constraints: z
        .object({
          horizontal: z.enum(["MIN", "CENTER", "MAX", "STRETCH", "SCALE"]),
          vertical: z.enum(["MIN", "CENTER", "MAX", "STRETCH", "SCALE"]),
        })
        .optional(),
      cornerRadius: z.number().min(0).optional(),
      cornerRadii: z
        .object({
          topLeft: z.number().min(0).optional(),
          topRight: z.number().min(0).optional(),
          bottomRight: z.number().min(0).optional(),
          bottomLeft: z.number().min(0).optional(),
        })
        .optional(),
      cornerSmoothing: z.number().min(0).max(1).optional(),
      minWidth: z.number().optional(),
      maxWidth: z.number().optional(),
      minHeight: z.number().optional(),
      maxHeight: z.number().optional(),
      layoutSizingHorizontal: z.enum(["FIXED", "HUG", "FILL"]).optional(),
      layoutSizingVertical: z.enum(["FIXED", "HUG", "FILL"]).optional(),
      layoutAlign: z.enum(["INHERIT", "STRETCH"]).optional(),
      layoutGrow: z.number().min(0).max(1).optional(),
      layoutPositioning: z.enum(["AUTO", "ABSOLUTE"]).optional(),
      strokesIncludedInLayout: z.boolean().optional(),
      gridRowSpan: z.number().int().min(1).optional(),
      gridColumnSpan: z.number().int().min(1).optional(),
      fileKey: fileKeyField,
    },
    async ({ nodeIds, fileKey, ...params }) =>
      respond(() => node.sendWithParams("set_node_appearance", nodeIds, params, fileKey))
  );

  server.tool(
    "set_layout_grids",
    "Replace a frame's layout grids. Pass the same shape Figma returns in get_node_details (pattern GRID/COLUMNS/ROWS, sectionSize, count, offset, gutterSize, alignment, color/opacity). Pass [] to remove every grid. Requires the design editor. Specify fileKey when multiple files are connected.",
    {
      nodeId: nodeIdField("The frame whose layout grids are replaced"),
      layoutGrids: z
        .array(z.record(z.unknown()))
        .describe("Full layout-grid list (empty array clears it)"),
      fileKey: fileKeyField,
    },
    async ({ nodeId, fileKey, ...params }) =>
      respond(() => node.sendWithParams("set_layout_grids", [nodeId], params, fileKey))
  );

  server.tool(
    "set_export_settings",
    "Replace a node's export settings (PNG/JPG/SVG/PDF, scale/width/height constraints, suffix, SVG options). Pass [] to clear them. Requires the design editor. Specify fileKey when multiple files are connected.",
    {
      nodeId: nodeIdField("The node whose export settings are replaced"),
      exportSettings: z
        .array(z.record(z.unknown()))
        .describe("Full exportSettings list (empty array clears it)"),
      fileKey: fileKeyField,
    },
    async ({ nodeId, fileKey, ...params }) =>
      respond(() => node.sendWithParams("set_export_settings", [nodeId], params, fileKey))
  );

  server.tool(
    "set_style_reference",
    "Attach or clear local styles on a node: fillStyleId, strokeStyleId, effectStyleId, gridStyleId, textStyleId, backgroundStyleId. Use null to detach a style. Requires the design editor. Specify fileKey when multiple files are connected.",
    {
      nodeId: nodeIdField("The node to update"),
      fillStyleId: z.string().nullable().optional(),
      strokeStyleId: z.string().nullable().optional(),
      effectStyleId: z.string().nullable().optional(),
      gridStyleId: z.string().nullable().optional(),
      textStyleId: z.string().nullable().optional(),
      backgroundStyleId: z.string().nullable().optional(),
      fileKey: fileKeyField,
    },
    async ({ nodeId, fileKey, ...params }) => {
      if (Object.keys(params).length === 0) {
        return errorResult("At least one style ID (or null) is required");
      }
      return respond(() => node.sendWithParams("set_style_reference", [nodeId], params, fileKey));
    }
  );

  server.tool(
    "reorder_nodes",
    "Change the paint/layer order of one or more nodes inside their parent: FRONT, BACK, FORWARD, BACKWARD, INDEX (explicit index), BEFORE or AFTER a sibling (referenceId). Returns the resulting index for each node. Requires the design editor. Specify fileKey when multiple files are connected.",
    {
      nodeIds: nodeIdsField("Nodes to reorder"),
      mode: z.enum(["FRONT", "BACK", "FORWARD", "BACKWARD", "INDEX", "BEFORE", "AFTER"]),
      index: z.number().int().min(0).optional().describe("Target index for mode=INDEX"),
      referenceId: z.string().optional().describe("Sibling node ID for mode=BEFORE/AFTER"),
      fileKey: fileKeyField,
    },
    async ({ nodeIds, fileKey, ...params }) =>
      respond(() => node.sendWithParams("reorder_nodes", nodeIds, params, fileKey))
  );

  server.tool(
    "align_nodes",
    "Align one or more nodes to the union bounds (default), their parent, or an explicit reference node. Supports LEFT, RIGHT, TOP, BOTTOM, CENTER_HORIZONTAL, CENTER_VERTICAL and returns the applied deltas. Requires the design editor. Specify fileKey when multiple files are connected.",
    {
      nodeIds: nodeIdsField("Nodes to align"),
      align: z.enum(["LEFT", "RIGHT", "TOP", "BOTTOM", "CENTER_HORIZONTAL", "CENTER_VERTICAL"]),
      relativeTo: z
        .enum(["union", "parent", "node"])
        .optional()
        .describe("Reference bounds (default union)"),
      relativeToId: z.string().optional().describe("Reference node ID when relativeTo='node'"),
      fileKey: fileKeyField,
    },
    async ({ nodeIds, fileKey, ...params }) =>
      respond(() => node.sendWithParams("align_nodes", nodeIds, params, fileKey))
  );

  server.tool(
    "set_image_fill",
    "Apply an image fill or stroke to an existing node from a local path, remote URL, data URI, or an existing imageHash. Supports FILL/FIT/CROP/TILE scale modes, a 2x3 imageTransform, opacity, and appending instead of replacing paints. Requires the design editor. Specify fileKey when multiple files are connected.",
    {
      nodeId: nodeIdField("The node to update"),
      source: z
        .string()
        .optional()
        .describe("Local path, http(s) URL, or data URI (resolved by the MCP server)"),
      imageHash: z.string().optional().describe("Reuse an image already in the file"),
      scaleMode: z.enum(["FILL", "FIT", "CROP", "TILE"]).optional(),
      imageTransform: z.array(z.array(z.number()).length(3)).length(2).optional(),
      opacity: z.number().min(0).max(1).optional(),
      visible: z.boolean().optional(),
      target: z.enum(["fill", "stroke"]).optional(),
      append: z
        .boolean()
        .optional()
        .describe("Append to existing paints instead of replacing them"),
      fileKey: fileKeyField,
    },
    async ({ nodeId, source, fileKey, ...params }) => {
      if (!source && !params.imageHash) return errorResult("source or imageHash is required");
      try {
        const payload: Record<string, unknown> = { ...params };
        if (source) payload.imageBase64 = await loadImageSourceAsBase64(source, process.cwd());
        return await respond(() =>
          node.sendWithParams("set_image_fill", [nodeId], payload, fileKey)
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    }
  );

  /* ------------------------------------------------------------------ text */

  server.tool(
    "set_text_advanced",
    "Advanced text editing on TEXT nodes: replace characters, set font family/style/size, fill color, letter spacing, line height (px/percent/auto), text case, decoration, hyperlink, paragraph spacing/indent on a character range (or the whole node), and node-level style ID, alignment, auto-resize and truncation. Fonts are loaded automatically before editing. Requires the design editor. Specify fileKey when multiple files are connected.",
    {
      nodeId: nodeIdField("The TEXT node to edit"),
      range: z
        .object({
          start: z.number().int().min(0),
          end: z.number().int().min(0),
        })
        .optional()
        .describe("Character range [start, end); defaults to the whole text"),
      characters: z.string().optional().describe("Replacement text (ignores range)"),
      fontFamily: z.string().optional(),
      fontStyle: z.string().optional(),
      fontSize: z.number().positive().optional(),
      fillHex: hexField.optional(),
      fillOpacity: z.number().min(0).max(1).optional(),
      letterSpacingPx: z.number().optional(),
      lineHeightPx: z.number().min(0).optional(),
      lineHeightValue: z.number().min(0).optional(),
      lineHeightUnit: lineHeightUnit.optional(),
      textCase: z
        .enum(["ORIGINAL", "UPPER", "LOWER", "TITLE", "SMALL_CAPS", "SMALL_CAPS_FORCED"])
        .optional(),
      textDecoration: z.enum(["NONE", "UNDERLINE", "STRIKETHROUGH"]).optional(),
      paragraphSpacing: z.number().min(0).optional(),
      paragraphIndent: z.number().min(0).optional(),
      hyperlink: z.string().nullable().optional().describe("URL to link, or null to clear it"),
      textStyleId: z.string().nullable().optional(),
      textAlignHorizontal: z.enum(["LEFT", "CENTER", "RIGHT", "JUSTIFIED"]).optional(),
      textAlignVertical: z.enum(["TOP", "CENTER", "BOTTOM"]).optional(),
      textAutoResize: z.enum(["NONE", "WIDTH_AND_HEIGHT", "HEIGHT", "TRUNCATE"]).optional(),
      textTruncation: z.enum(["DISABLED", "ENDING"]).optional(),
      fileKey: fileKeyField,
    },
    async ({ nodeId, fileKey, ...params }) =>
      respond(() => node.sendWithParams("set_text_advanced", [nodeId], params, fileKey))
  );

  /* ------------------------------------------------------------ components */

  server.tool(
    "create_component",
    "Create a main component. Pass nodeId to convert an existing frame/group into a component in place, or omit it to create a new component (with optional size, fill, parent, and position). Requires the design editor. Specify fileKey when multiple files are connected.",
    {
      nodeId: z.string().optional().describe("Existing node to convert into a component"),
      name: z.string().optional(),
      description: z.string().optional(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      parentId: z.string().optional(),
      fillHex: hexField.optional(),
      fillOpacity: z.number().min(0).max(1).optional(),
      fileKey: fileKeyField,
    },
    async ({ nodeId, fileKey, ...params }) =>
      respond(() =>
        node.sendWithParams("create_component", nodeId ? [nodeId] : undefined, params, fileKey)
      )
  );

  server.tool(
    "create_component_set",
    "Combine two or more COMPONENT nodes into a component set (variant group), optionally naming it. All components must share a parent or you must pass parentId. Requires the design editor. Specify fileKey when multiple files are connected.",
    {
      nodeIds: nodeIdsField("Component node IDs to combine", 2),
      name: z.string().optional(),
      description: z.string().optional(),
      parentId: z.string().optional(),
      fileKey: fileKeyField,
    },
    async ({ nodeIds, fileKey, ...params }) =>
      respond(() => node.sendWithParams("create_component_set", nodeIds, params, fileKey))
  );

  server.tool(
    "create_instance",
    "Create an instance of a component or component set (component sets use their default variant). Supports name, parent, position, size, and component properties/variants via the properties map. Requires the design editor. Specify fileKey when multiple files are connected.",
    {
      componentId: nodeIdField("Component, component set, or instance to instantiate"),
      name: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      parentId: z.string().optional(),
      properties: z
        .record(z.union([z.string(), z.boolean()]))
        .optional()
        .describe("Component properties / variant values, keyed by property name"),
      fileKey: fileKeyField,
    },
    async ({ fileKey, ...params }) =>
      respond(() => node.sendWithParams("create_instance", undefined, params, fileKey))
  );

  server.tool(
    "update_instance",
    "Update an existing instance: set component properties/variants, swap its main component (preserving overrides by default), reset overrides, or detach it into a frame. Requires the design editor. Specify fileKey when multiple files are connected.",
    {
      nodeId: nodeIdField("The INSTANCE node to update"),
      properties: z.record(z.union([z.string(), z.boolean()])).optional(),
      swapComponentId: z.string().optional(),
      preserveOverrides: z
        .boolean()
        .optional()
        .describe("Keep overrides when swapping (default true)"),
      resetOverrides: z.boolean().optional(),
      detach: z.boolean().optional().describe("Detach the instance into a frame"),
      fileKey: fileKeyField,
    },
    async ({ nodeId, fileKey, ...params }) =>
      respond(() => node.sendWithParams("update_instance", [nodeId], params, fileKey))
  );

  server.tool(
    "add_component_property",
    "Add a component property (BOOLEAN, TEXT, INSTANCE_SWAP, VARIANT, SLOT) to a component or component set, with a default value. Requires the design editor. Specify fileKey when multiple files are connected.",
    {
      componentId: nodeIdField("Component or component set"),
      name: z.string().min(1),
      type: z.enum(["BOOLEAN", "TEXT", "INSTANCE_SWAP", "VARIANT", "SLOT"]),
      defaultValue: z.union([z.string(), z.boolean()]),
      fileKey: fileKeyField,
    },
    async ({ fileKey, ...params }) =>
      respond(() => node.sendWithParams("add_component_property", undefined, params, fileKey))
  );

  server.tool(
    "delete_component_property",
    "Delete a component property (BOOLEAN, TEXT, INSTANCE_SWAP, or SLOT) from a component or component set. Requires confirm: true. Requires the design editor. Specify fileKey when multiple files are connected.",
    {
      componentId: nodeIdField("Component or component set"),
      propertyName: z
        .string()
        .min(1)
        .describe("Property name as shown in componentPropertyDefinitions"),
      confirm: z.boolean().describe("Must be true to confirm deletion"),
      fileKey: fileKeyField,
    },
    async ({ fileKey, ...params }) =>
      respond(() => node.sendWithParams("delete_component_property", undefined, params, fileKey))
  );

  server.tool(
    "edit_component_property",
    "Rename or reconfigure a component property: new name, default value (BOOLEAN/TEXT/INSTANCE_SWAP), preferred values (INSTANCE_SWAP/SLOT), and description (SLOT). Requires the design editor. Specify fileKey when multiple files are connected.",
    {
      componentId: nodeIdField("Component or component set"),
      propertyName: z.string().min(1).describe("Existing property name"),
      name: z.string().min(1).optional().describe("New property name"),
      defaultValue: z.union([z.string(), z.boolean()]).optional(),
      preferredValues: z
        .array(
          z.object({
            type: z.enum(["COMPONENT", "COMPONENT_SET"]),
            key: z.string().min(1),
          })
        )
        .optional(),
      description: z.string().optional(),
      fileKey: fileKeyField,
    },
    async ({ fileKey, ...params }) =>
      respond(() => node.sendWithParams("edit_component_property", undefined, params, fileKey))
  );

  /* ------------------------------------------------------ boolean / vector */

  server.tool(
    "boolean_operation",
    "Combine two or more nodes with a Figma boolean operation: UNION, SUBTRACT (first node minus the rest), INTERSECT, or EXCLUDE. Nodes must share a parent or you must pass parentId. Requires the design editor. Specify fileKey when multiple files are connected.",
    {
      nodeIds: nodeIdsField("Nodes to combine, base node first for SUBTRACT", 2),
      operation: z.enum(["UNION", "SUBTRACT", "INTERSECT", "EXCLUDE"]),
      name: z.string().optional(),
      parentId: z.string().optional(),
      fileKey: fileKeyField,
    },
    async ({ nodeIds, fileKey, ...params }) =>
      respond(() => node.sendWithParams("boolean_operation", nodeIds, params, fileKey))
  );

  server.tool(
    "flatten_nodes",
    "Flatten one or more nodes into a single editable vector (Figma's Flatten). Requires the design editor. Specify fileKey when multiple files are connected.",
    {
      nodeIds: nodeIdsField("Nodes to flatten"),
      name: z.string().optional(),
      parentId: z.string().optional(),
      fileKey: fileKeyField,
    },
    async ({ nodeIds, fileKey, ...params }) =>
      respond(() => node.sendWithParams("flatten_nodes", nodeIds, params, fileKey))
  );

  server.tool(
    "outline_stroke",
    "Convert a node's stroke into an editable vector outline (Figma's Outline stroke). Requires the design editor. Specify fileKey when multiple files are connected.",
    {
      nodeId: nodeIdField("Node whose stroke becomes an outline"),
      name: z.string().optional(),
      fileKey: fileKeyField,
    },
    async ({ nodeId, fileKey, ...params }) =>
      respond(() => node.sendWithParams("outline_stroke", [nodeId], params, fileKey))
  );

  server.tool(
    "create_vector",
    "Create an editable vector node from one or more SVG paths ({ windingRule, data }). Supports name, parent, position, rotation, size, solid fill and stroke. Requires the design editor. Specify fileKey when multiple files are connected.",
    {
      vectorPaths: vectorPathsField,
      name: z.string().optional(),
      parentId: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      rotation: z.number().optional(),
      fillHex: hexField.optional(),
      fillOpacity: z.number().min(0).max(1).optional(),
      strokeHex: hexField.optional(),
      strokeOpacity: z.number().min(0).max(1).optional(),
      strokeWeight: z.number().min(0).optional(),
      fileKey: fileKeyField,
    },
    async ({ fileKey, ...params }) =>
      respond(() => node.sendWithParams("create_vector", undefined, params, fileKey))
  );

  server.tool(
    "set_vector_paths",
    "Replace the geometry of an existing vector (or path-bearing node) with new SVG paths, optionally resize it and set solid fill/stroke. Requires the design editor. Specify fileKey when multiple files are connected.",
    {
      nodeId: nodeIdField("Vector node to rewrite"),
      vectorPaths: vectorPathsField,
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      fillHex: hexField.optional(),
      fillOpacity: z.number().min(0).max(1).optional(),
      strokeHex: hexField.optional(),
      strokeOpacity: z.number().min(0).max(1).optional(),
      strokeWeight: z.number().min(0).optional(),
      fileKey: fileKeyField,
    },
    async ({ nodeId, fileKey, ...params }) =>
      respond(() => node.sendWithParams("set_vector_paths", [nodeId], params, fileKey))
  );

  /* ---------------------------------------------------------------- styles */

  server.tool(
    "create_style",
    "Create a local paint, text, effect, or grid style. definition uses the same shapes as get_node_details: { paints } for PAINT, { effects } for EFFECT, { layoutGrids } for GRID, and font/text fields for TEXT. Requires the design editor. Specify fileKey when multiple files are connected.",
    {
      styleType: z.enum(["PAINT", "TEXT", "EFFECT", "GRID"]),
      name: z.string().min(1),
      description: z.string().optional(),
      definition: z.record(z.unknown()),
      fileKey: fileKeyField,
    },
    async ({ fileKey, ...params }) =>
      respond(() => node.sendWithParams("create_style", undefined, params, fileKey))
  );

  server.tool(
    "update_style",
    "Update a local style's name, description, and definition (paints for PAINT, effects for EFFECT, layoutGrids for GRID, font/text fields for TEXT). Library styles are read-only. Requires the design editor. Specify fileKey when multiple files are connected.",
    {
      styleId: z.string().min(1),
      name: z.string().optional(),
      description: z.string().optional(),
      definition: z.record(z.unknown()).optional(),
      fileKey: fileKeyField,
    },
    async ({ fileKey, ...params }) =>
      respond(() => node.sendWithParams("update_style", undefined, params, fileKey))
  );

  server.tool(
    "delete_style",
    "Delete a local style. Requires confirm: true. Library styles cannot be deleted. Specify fileKey when multiple files are connected.",
    {
      styleId: z.string().min(1),
      confirm: z.boolean().describe("Must be true to confirm deletion"),
      fileKey: fileKeyField,
    },
    async ({ fileKey, ...params }) =>
      respond(() => node.sendWithParams("delete_style", undefined, params, fileKey))
  );

  /* ------------------------------------------------------------- variables */

  server.tool(
    "create_variable_collection",
    "Create a variable collection (design-token group) with an optional default mode name and extra modes. Requires the design editor. Specify fileKey when multiple files are connected.",
    {
      name: z.string().min(1),
      defaultModeName: z.string().optional(),
      modes: z.array(z.string()).optional().describe("Additional modes to create"),
      hiddenFromPublishing: z.boolean().optional(),
      fileKey: fileKeyField,
    },
    async ({ fileKey, ...params }) =>
      respond(() => node.sendWithParams("create_variable_collection", undefined, params, fileKey))
  );

  server.tool(
    "create_variable",
    "Create a design-token variable (COLOR, FLOAT, STRING, BOOLEAN) inside a collection. Set the default mode value, per-mode values, description, scopes, and publishing visibility. COLOR values accept hex or {r,g,b,a}. Requires the design editor. Specify fileKey when multiple files are connected.",
    {
      collectionId: z.string().min(1),
      name: z.string().min(1),
      resolvedType: z.enum(["COLOR", "FLOAT", "STRING", "BOOLEAN"]),
      value: z
        .union([z.string(), z.number(), z.boolean(), colorValue])
        .optional()
        .describe("Value for the collection's default mode"),
      valuesByMode: z
        .record(z.union([z.string(), z.number(), z.boolean(), colorValue]))
        .optional()
        .describe("Values keyed by mode ID"),
      description: z.string().optional(),
      scopes: z.array(z.string()).optional(),
      hiddenFromPublishing: z.boolean().optional(),
      fileKey: fileKeyField,
    },
    async ({ fileKey, ...params }) =>
      respond(() => node.sendWithParams("create_variable", undefined, params, fileKey))
  );

  server.tool(
    "set_variable_value",
    "Set a variable's value for a mode (defaults to the collection's default mode). COLOR values accept hex or {r,g,b,a}. Requires the design editor. Specify fileKey when multiple files are connected.",
    {
      variableId: z.string().min(1),
      modeId: z.string().optional(),
      value: z.union([z.string(), z.number(), z.boolean(), colorValue]),
      fileKey: fileKeyField,
    },
    async ({ fileKey, ...params }) =>
      respond(() => node.sendWithParams("set_variable_value", undefined, params, fileKey))
  );

  server.tool(
    "bind_variable",
    "Bind a variable to a node field (width, height, opacity, visible, corner radii, spacing, padding, stroke weight, text fields, ...), or to the color of a specific fill/stroke paint via field='fills'|'strokes' plus paintIndex. Pass variableId: null to unbind. Requires the design editor. Specify fileKey when multiple files are connected.",
    {
      nodeId: nodeIdField("Node to bind"),
      field: z
        .string()
        .min(1)
        .describe(
          "Bindable field, e.g. fills, strokes, opacity, width, cornerRadius, itemSpacing, fontSize"
        ),
      variableId: z.string().nullable(),
      paintIndex: z.number().int().min(0).optional().describe("Paint index for fills/strokes"),
      fileKey: fileKeyField,
    },
    async ({ nodeId, fileKey, ...params }) =>
      respond(() => node.sendWithParams("bind_variable", [nodeId], params, fileKey))
  );

  server.tool(
    "set_variable_mode",
    "Set or clear the explicit variable mode of a node for a collection (pass modeId: null to inherit). Requires the design editor. Specify fileKey when multiple files are connected.",
    {
      nodeId: nodeIdField("Node whose mode is set"),
      collectionId: z.string().min(1),
      modeId: z.string().nullable(),
      fileKey: fileKeyField,
    },
    async ({ nodeId, fileKey, ...params }) =>
      respond(() => node.sendWithParams("set_variable_mode", [nodeId], params, fileKey))
  );

  server.tool(
    "update_variable",
    "Update a local variable: name, description, scopes, publishing visibility, and per-mode values. COLOR values accept hex or {r,g,b,a}. Requires the design editor. Specify fileKey when multiple files are connected.",
    {
      variableId: z.string().min(1),
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      scopes: z.array(z.string()).optional(),
      hiddenFromPublishing: z.boolean().optional(),
      valuesByMode: z
        .record(z.union([z.string(), z.number(), z.boolean(), colorValue]))
        .optional()
        .describe("Values keyed by mode ID"),
      fileKey: fileKeyField,
    },
    async ({ fileKey, ...params }) =>
      respond(() => node.sendWithParams("update_variable", undefined, params, fileKey))
  );

  server.tool(
    "delete_variable",
    "Delete a local variable. Requires confirm: true. Library variables cannot be deleted. Requires the design editor. Specify fileKey when multiple files are connected.",
    {
      variableId: z.string().min(1),
      confirm: z.boolean().describe("Must be true to confirm deletion"),
      fileKey: fileKeyField,
    },
    async ({ fileKey, ...params }) =>
      respond(() => node.sendWithParams("delete_variable", undefined, params, fileKey))
  );

  server.tool(
    "update_variable_collection",
    "Update a local variable collection: rename it, change publishing visibility, add modes, rename modes ({ modeId: newName }), or remove modes (the default mode cannot be removed). Requires the design editor. Specify fileKey when multiple files are connected.",
    {
      collectionId: z.string().min(1),
      name: z.string().min(1).optional(),
      hiddenFromPublishing: z.boolean().optional(),
      addModes: z.array(z.string().min(1)).optional(),
      renameModes: z.record(z.string().min(1)).optional().describe("Map of modeId -> new name"),
      removeModes: z.array(z.string().min(1)).optional().describe("Mode IDs to remove"),
      fileKey: fileKeyField,
    },
    async ({ fileKey, ...params }) =>
      respond(() => node.sendWithParams("update_variable_collection", undefined, params, fileKey))
  );

  server.tool(
    "delete_variable_collection",
    "Delete a local variable collection and every variable inside it. Requires confirm: true. Library collections cannot be deleted. Requires the design editor. Specify fileKey when multiple files are connected.",
    {
      collectionId: z.string().min(1),
      confirm: z.boolean().describe("Must be true to confirm deletion"),
      fileKey: fileKeyField,
    },
    async ({ fileKey, ...params }) =>
      respond(() => node.sendWithParams("delete_variable_collection", undefined, params, fileKey))
  );

  /* ------------------------------------------------------ prototype/pages */

  server.tool(
    "set_reactions",
    "Write prototype interactions on a node using Figma's own Reaction array (triggers, actions, destinations, variables). Pass [] to clear all reactions. Not available in FigJam. Requires the design editor. Specify fileKey when multiple files are connected.",
    {
      nodeId: nodeIdField("Node whose reactions are replaced"),
      reactions: z.array(z.record(z.unknown())).describe("Full Reaction list (empty clears it)"),
      fileKey: fileKeyField,
    },
    async ({ nodeId, fileKey, ...params }) =>
      respond(() => node.sendWithParams("set_reactions", [nodeId], params, fileKey))
  );

  server.tool(
    "update_page",
    "Update a page (default: current page): rename it, set it as the current page, replace canvas/prototype background paints, and define flow starting points ({ nodeId, name }). Set delete: true with confirm: true to delete the page. Requires the design editor. Specify fileKey when multiple files are connected.",
    {
      pageId: z.string().optional(),
      name: z.string().optional(),
      setAsCurrent: z.boolean().optional(),
      backgrounds: z.array(paintObject).optional(),
      prototypeBackgrounds: z.array(paintObject).optional(),
      flowStartingPoints: z
        .array(z.object({ nodeId: z.string(), name: z.string().optional() }))
        .optional(),
      delete: z.boolean().optional(),
      confirm: z.boolean().optional(),
      fileKey: fileKeyField,
    },
    async ({ fileKey, ...params }) =>
      respond(() => node.sendWithParams("update_page", undefined, params, fileKey))
  );
}
