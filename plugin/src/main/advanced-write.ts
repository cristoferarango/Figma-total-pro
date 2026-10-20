/**
 * Write tools for appearance, layout, export settings, style references,
 * z-order, alignment, image fills and advanced text styling.
 */
import {
  absoluteRect,
  assertRange,
  ensureFont,
  firstNodeId,
  isTextCase,
  isTextDecoration,
  loadFontsForText,
  optionalNumber,
  rectFromBox,
  requireDesign,
  requireString,
  sceneNodeById,
  solidPaint,
  supportsInsertChild,
  unionRects,
  type AdvancedRequest,
  type Params,
  type Rect,
} from "./advanced-shared";

type Json = Record<string, unknown>;

const setter = async (
  node: SceneNode,
  property: string,
  asyncMethod: string,
  value: string | null | undefined
): Promise<string | undefined> => {
  if (value === undefined) return undefined;
  const target = value === null ? "" : value;
  const record = node as unknown as Record<string, unknown>;
  const method = record[asyncMethod];
  if (typeof method === "function") {
    await (method as (styleId: string) => Promise<void>).call(node, target);
    return typeof record[property] === "string" ? (record[property] as string) : target;
  }
  if (property in record) {
    record[property] = target;
    return target;
  }
  throw new Error(`Node does not support ${property}: ${node.id}`);
};

/* ------------------------------------------------------------- appearance */

async function setNodeAppearance(request: AdvancedRequest, params: Params): Promise<unknown> {
  const nodeIds = request.nodeIds;
  if (!nodeIds || nodeIds.length === 0) throw new Error("nodeIds is required");
  const nodes = await Promise.all(nodeIds.map((id) => sceneNodeById(id)));
  const results: Json[] = [];

  for (const node of nodes) {
    const applied: Json = {};

    if (typeof params.name === "string") {
      node.name = params.name;
      applied.name = node.name;
    }
    if (typeof params.visible === "boolean") {
      node.visible = params.visible;
      applied.visible = node.visible;
    }
    if (typeof params.locked === "boolean") {
      node.locked = params.locked;
      applied.locked = node.locked;
    }
    if (typeof params.opacity === "number") {
      if (!("opacity" in node)) throw new Error(`Node does not support opacity: ${node.id}`);
      node.opacity = Math.max(0, Math.min(1, params.opacity));
      applied.opacity = node.opacity;
    }
    if (typeof params.blendMode === "string") {
      if (!("blendMode" in node)) throw new Error(`Node does not support blendMode: ${node.id}`);
      node.blendMode = params.blendMode as BlendMode;
      applied.blendMode = node.blendMode;
    }
    if (typeof params.isMask === "boolean") {
      if (!("isMask" in node)) throw new Error(`Node does not support isMask: ${node.id}`);
      node.isMask = params.isMask;
      applied.isMask = node.isMask;
    }
    if (typeof params.maskType === "string") {
      if (!("maskType" in node)) throw new Error(`Node does not support maskType: ${node.id}`);
      node.maskType = params.maskType as MaskType;
      applied.maskType = node.maskType;
    }
    if (typeof params.clipsContent === "boolean") {
      if (!("clipsContent" in node))
        throw new Error(`Node does not support clipsContent: ${node.id}`);
      node.clipsContent = params.clipsContent;
      applied.clipsContent = node.clipsContent;
    }
    if (params.constraints && typeof params.constraints === "object") {
      if (!("constraints" in node))
        throw new Error(`Node does not support constraints: ${node.id}`);
      const raw = params.constraints as { horizontal?: unknown; vertical?: unknown };
      if (typeof raw.horizontal !== "string" || typeof raw.vertical !== "string") {
        throw new Error("constraints requires horizontal and vertical strings");
      }
      node.constraints = {
        horizontal: raw.horizontal as ConstraintType,
        vertical: raw.vertical as ConstraintType,
      };
      applied.constraints = node.constraints;
    }
    if (typeof params.cornerRadius === "number") {
      if (!("cornerRadius" in node))
        throw new Error(`Node does not support cornerRadius: ${node.id}`);
      (node as SceneNode & CornerMixin).cornerRadius = params.cornerRadius;
      applied.cornerRadius = (node as SceneNode & CornerMixin).cornerRadius;
    }
    if (params.cornerRadii && typeof params.cornerRadii === "object") {
      if (!("topLeftRadius" in node))
        throw new Error(`Node does not support cornerRadii: ${node.id}`);
      const raw = params.cornerRadii as Record<string, unknown>;
      const geometry = node as SceneNode & {
        topLeftRadius: number;
        topRightRadius: number;
        bottomRightRadius: number;
        bottomLeftRadius: number;
      };
      for (const [key, field] of [
        ["topLeft", "topLeftRadius"],
        ["topRight", "topRightRadius"],
        ["bottomRight", "bottomRightRadius"],
        ["bottomLeft", "bottomLeftRadius"],
      ] as const) {
        if (typeof raw[key] === "number") geometry[field] = raw[key] as number;
      }
      applied.cornerRadii = {
        topLeft: geometry.topLeftRadius,
        topRight: geometry.topRightRadius,
        bottomRight: geometry.bottomRightRadius,
        bottomLeft: geometry.bottomLeftRadius,
      };
    }
    if (typeof params.cornerSmoothing === "number") {
      if (!("cornerSmoothing" in node)) {
        throw new Error(`Node does not support cornerSmoothing: ${node.id}`);
      }
      (node as SceneNode & CornerMixin).cornerSmoothing = params.cornerSmoothing;
      applied.cornerSmoothing = (node as SceneNode & CornerMixin).cornerSmoothing;
    }

    for (const field of ["minWidth", "maxWidth", "minHeight", "maxHeight"] as const) {
      if (typeof params[field] === "number") {
        if (!(field in node)) throw new Error(`Node does not support ${field}: ${node.id}`);
        (node as unknown as Record<string, unknown>)[field] = params[field];
        applied[field] = params[field];
      }
    }

    for (const field of [
      "layoutSizingHorizontal",
      "layoutSizingVertical",
      "layoutAlign",
      "layoutGrow",
      "layoutPositioning",
      "strokesIncludedInLayout",
      "gridRowSpan",
      "gridColumnSpan",
    ] as const) {
      if (params[field] === undefined) continue;
      if (!(field in node)) throw new Error(`Node does not support ${field}: ${node.id}`);
      (node as unknown as Record<string, unknown>)[field] = params[field];
      applied[field] = (node as unknown as Record<string, unknown>)[field];
    }

    results.push({ nodeId: node.id, nodeName: node.name, applied });
  }

  return results.length === 1 ? results[0] : { updatedCount: results.length, results };
}

/* ------------------------------------------------------------ layout grids */

async function setLayoutGrids(request: AdvancedRequest, params: Params): Promise<unknown> {
  const node = await sceneNodeById(firstNodeId(request));
  if (!("layoutGrids" in node)) throw new Error(`Node does not support layoutGrids: ${node.id}`);
  if (!Array.isArray(params.layoutGrids)) {
    throw new Error("layoutGrids must be an array (pass [] to clear)");
  }
  const grids = params.layoutGrids as LayoutGrid[];
  (node as SceneNode & { layoutGrids: ReadonlyArray<LayoutGrid> }).layoutGrids = grids;
  return {
    nodeId: node.id,
    nodeName: node.name,
    count: grids.length,
    layoutGrids: (node as SceneNode & { layoutGrids: ReadonlyArray<LayoutGrid> }).layoutGrids,
  };
}

/* --------------------------------------------------------- export settings */

async function setExportSettings(request: AdvancedRequest, params: Params): Promise<unknown> {
  const node = await sceneNodeById(firstNodeId(request));
  const nodeId = node.id;
  if (!("exportSettings" in node))
    throw new Error(`Node does not support exportSettings: ${nodeId}`);
  if (!Array.isArray(params.exportSettings)) {
    throw new Error("exportSettings must be an array (pass [] to clear)");
  }
  const settings = params.exportSettings as ExportSettings[];
  settings.forEach((setting, index) => {
    if (!setting || typeof setting !== "object" || typeof setting.format !== "string") {
      throw new Error(`exportSettings[${index}] must have a format`);
    }
  });
  node.exportSettings = settings;
  return { nodeId: node.id, nodeName: node.name, exportSettings: node.exportSettings };
}

/* --------------------------------------------------------- style references */

const STYLE_FIELDS = [
  ["fillStyleId", "setFillStyleIdAsync"],
  ["strokeStyleId", "setStrokeStyleIdAsync"],
  ["effectStyleId", "setEffectStyleIdAsync"],
  ["gridStyleId", "setGridStyleIdAsync"],
  ["textStyleId", "setTextStyleIdAsync"],
  ["backgroundStyleId", "setBackgroundStyleIdAsync"],
] as const;

async function setStyleReference(request: AdvancedRequest, params: Params): Promise<unknown> {
  const node = await sceneNodeById(firstNodeId(request));
  const applied: Json = {};
  for (const [property, method] of STYLE_FIELDS) {
    if (!(property in params)) continue;
    const value = params[property];
    if (value !== null && typeof value !== "string") {
      throw new Error(`${property} must be a style ID string or null to clear it`);
    }
    applied[property] = await setter(node, property, method, value as string | null);
  }
  if (Object.keys(applied).length === 0) {
    throw new Error(
      "At least one of fillStyleId, strokeStyleId, effectStyleId, gridStyleId, textStyleId, backgroundStyleId is required"
    );
  }
  return { nodeId: node.id, nodeName: node.name, applied };
}

/* ---------------------------------------------------------------- z-order */

async function reorderNodes(request: AdvancedRequest, params: Params): Promise<unknown> {
  const nodeIds = request.nodeIds;
  if (!nodeIds || nodeIds.length === 0) throw new Error("nodeIds is required");
  const mode = requireString(params, "mode").toUpperCase();
  const indexParam = optionalNumber(params, "index");
  const referenceId = typeof params.referenceId === "string" ? params.referenceId : undefined;
  if ((mode === "BEFORE" || mode === "AFTER") && !referenceId) {
    throw new Error("referenceId is required for BEFORE/AFTER");
  }
  if (mode === "INDEX" && indexParam === undefined) throw new Error("index is required for INDEX");

  const results: Json[] = [];
  for (const nodeId of nodeIds) {
    const node = await sceneNodeById(nodeId);
    const parent = node.parent;
    if (!parent || !supportsInsertChild(parent)) {
      throw new Error(`Node has no reorderable parent: ${nodeId}`);
    }
    const siblings = parent.children.filter((child) => child.id !== node.id);
    let target: number;

    if (mode === "FRONT") {
      target = siblings.length;
    } else if (mode === "BACK") {
      target = 0;
    } else if (mode === "INDEX") {
      target = Math.round(indexParam as number);
    } else if (mode === "FORWARD" || mode === "BACKWARD") {
      const currentIndex = parent.children.findIndex((child) => child.id === node.id);
      target = mode === "FORWARD" ? currentIndex + 1 : currentIndex - 1;
    } else if (mode === "BEFORE" || mode === "AFTER") {
      const reference = await sceneNodeById(referenceId as string);
      if (reference.parent?.id !== parent.id) {
        throw new Error(`referenceId must be a sibling of the node to reorder: ${referenceId}`);
      }
      const refIndex = siblings.findIndex((child) => child.id === reference.id);
      target = mode === "BEFORE" ? refIndex : refIndex + 1;
    } else {
      throw new Error(
        `Unsupported mode: ${mode} (use FRONT, BACK, FORWARD, BACKWARD, INDEX, BEFORE, AFTER)`
      );
    }

    const clamped = Math.max(0, Math.min(Math.round(target), siblings.length));
    parent.insertChild(clamped, node);
    const newIndex = parent.children.findIndex((child) => child.id === node.id);
    results.push({ nodeId: node.id, nodeName: node.name, parentId: parent.id, index: newIndex });
  }

  return results.length === 1 ? results[0] : { reorderedCount: results.length, results };
}

/* ------------------------------------------------------------- align nodes */

const ALIGNMENTS = [
  "LEFT",
  "RIGHT",
  "TOP",
  "BOTTOM",
  "CENTER_HORIZONTAL",
  "CENTER_VERTICAL",
] as const;

/**
 * Moves a node by an absolute (document-space) delta. `node.x`/`node.y` are
 * expressed in the parent's coordinate space, so when the parent is rotated or
 * scaled the delta has to be mapped through the inverse parent transform — the
 * naive `node.x += dx` drifts for anything inside a rotated frame or group.
 */
const moveByAbsoluteDelta = (node: SceneNode, dx: number, dy: number): void => {
  if (dx === 0 && dy === 0) return;
  const parent = node.parent;
  if (parent && "absoluteTransform" in parent) {
    const transform = parent.absoluteTransform;
    const [[a, b], [c, d]] = transform;
    const determinant = a * d - b * c;
    if (Math.abs(determinant) > 1e-9) {
      node.x += (d * dx - b * dy) / determinant;
      node.y += (-c * dx + a * dy) / determinant;
      return;
    }
  }
  node.x += dx;
  node.y += dy;
};

async function alignNodes(request: AdvancedRequest, params: Params): Promise<unknown> {
  const nodeIds = request.nodeIds;
  if (!nodeIds || nodeIds.length === 0) throw new Error("nodeIds is required");
  const align = requireString(params, "align").toUpperCase();
  if (!(ALIGNMENTS as readonly string[]).includes(align)) {
    throw new Error(`align must be one of ${ALIGNMENTS.join(", ")}`);
  }
  const nodes = await Promise.all(nodeIds.map((id) => sceneNodeById(id)));
  const relativeTo = typeof params.relativeTo === "string" ? params.relativeTo : "union";

  let target: Rect | null = null;
  if (relativeTo === "union") {
    target = unionRects(nodes.map((node) => absoluteRect(node)));
  } else if (relativeTo === "parent") {
    const parent = nodes[0].parent;
    if (!parent || parent.type === "PAGE" || parent.type === "DOCUMENT") {
      throw new Error("Nodes have no measurable parent; use relativeTo: 'union' or 'node'");
    }
    const box = parent.absoluteBoundingBox;
    if (!box) throw new Error(`Parent has no bounds: ${parent.id}`);
    target = rectFromBox(box);
  } else if (relativeTo === "node") {
    const referenceId = requireString(params, "relativeToId");
    target = absoluteRect(await sceneNodeById(referenceId));
  } else {
    throw new Error("relativeTo must be 'union', 'parent', or 'node'");
  }

  if (!target) throw new Error("Could not resolve an alignment target");

  const results: Json[] = [];
  for (const node of nodes) {
    const rect = absoluteRect(node);
    let dx = 0;
    let dy = 0;
    if (align === "LEFT") dx = target.x - rect.x;
    else if (align === "RIGHT") dx = target.right - rect.right;
    else if (align === "CENTER_HORIZONTAL") dx = target.cx - rect.cx;
    else if (align === "TOP") dy = target.y - rect.y;
    else if (align === "BOTTOM") dy = target.bottom - rect.bottom;
    else if (align === "CENTER_VERTICAL") dy = target.cy - rect.cy;

    if (dx !== 0 || dy !== 0) moveByAbsoluteDelta(node, dx, dy);
    results.push({
      nodeId: node.id,
      nodeName: node.name,
      x: node.x,
      y: node.y,
      dx,
      dy,
    });
  }

  return {
    align,
    relativeTo,
    target,
    movedCount: results.length,
    results,
  };
}

/* ------------------------------------------------------------- image fills */

async function setImageFill(request: AdvancedRequest, params: Params): Promise<unknown> {
  const node = await sceneNodeById(firstNodeId(request));
  const target = params.target === "stroke" ? "stroke" : "fill";
  if (target === "fill" && !("fills" in node))
    throw new Error(`Node does not support fills: ${node.id}`);
  if (target === "stroke" && !("strokes" in node)) {
    throw new Error(`Node does not support strokes: ${node.id}`);
  }

  let imageHash: string;
  if (typeof params.imageBase64 === "string" && params.imageBase64.length > 0) {
    const image = figma.createImage(figma.base64Decode(params.imageBase64));
    imageHash = image.hash;
  } else if (typeof params.imageHash === "string" && params.imageHash.length > 0) {
    imageHash = params.imageHash;
  } else {
    throw new Error("imageBase64 or imageHash is required");
  }

  const scaleMode =
    params.scaleMode === "FIT" ||
    params.scaleMode === "CROP" ||
    params.scaleMode === "TILE" ||
    params.scaleMode === "FILL"
      ? params.scaleMode
      : "FILL";

  const paint: ImagePaint = {
    type: "IMAGE",
    imageHash,
    scaleMode,
    opacity: typeof params.opacity === "number" ? params.opacity : 1,
    visible: params.visible === undefined ? true : Boolean(params.visible),
    ...(Array.isArray(params.imageTransform) && params.imageTransform.length === 2
      ? { imageTransform: params.imageTransform as Transform }
      : {}),
  };

  const geometry = node as SceneNode & {
    fills: ReadonlyArray<Paint>;
    strokes: ReadonlyArray<Paint>;
  };
  const existing = target === "fill" ? geometry.fills : geometry.strokes;
  if (params.append === true && !Array.isArray(existing)) {
    throw new Error(
      `Node has mixed ${target} paints; pass append: false to replace them with this image`
    );
  }
  const paints = Array.isArray(existing) ? [...existing] : [];
  if (params.append === true) paints.push(paint);
  else paints.splice(0, paints.length, paint);
  if (target === "fill") geometry.fills = paints;
  else geometry.strokes = paints;

  const image = figma.getImageByHash(imageHash);
  const size = image ? await image.getSizeAsync() : null;
  return {
    nodeId: node.id,
    nodeName: node.name,
    target,
    imageHash,
    scaleMode,
    imageSize: size,
    paintCount: target === "fill" ? geometry.fills.length : geometry.strokes.length,
  };
}

/* ------------------------------------------------------------- text styling */

async function setTextAdvanced(request: AdvancedRequest, params: Params): Promise<unknown> {
  const node = await sceneNodeById(firstNodeId(request));
  if (node.type !== "TEXT") {
    throw new Error(`set_text_advanced requires a TEXT node (got ${node.type}: ${node.id})`);
  }

  // Replacing the whole text ignores `range`, and must work on empty text
  // nodes too — assertRange would reject the 0..0 range those have.
  if (typeof params.characters === "string") {
    await loadFontsForText(node);
    const before = node.characters;
    node.characters = params.characters;
    return {
      nodeId: node.id,
      nodeName: node.name,
      applied: {
        characters: node.characters,
        previousCharacters: before,
        range: { start: 0, end: node.characters.length },
      },
    };
  }

  const range = params.range as { start?: unknown; end?: unknown } | undefined;
  const start = typeof range?.start === "number" ? range.start : 0;
  const end = typeof range?.end === "number" ? range.end : node.characters.length;
  assertRange(node, start, end);

  const applied: Json = { range: { start, end } };

  // The text style is the base layer: applying it last would clobber every
  // range-level override set above, so attach it first and reload the fonts it
  // may have introduced before touching character ranges.
  if (typeof params.textStyleId === "string" || params.textStyleId === null) {
    const styleId = params.textStyleId === null ? "" : params.textStyleId;
    await node.setTextStyleIdAsync(styleId);
    applied.textStyleId = node.textStyleId;
  }

  await loadFontsForText(node, start, end);

  if (typeof params.fontFamily === "string" || typeof params.fontStyle === "string") {
    const current = node.getRangeFontName(start, Math.max(start + 1, end));
    const family =
      typeof params.fontFamily === "string"
        ? params.fontFamily
        : typeof current !== "symbol"
          ? current.family
          : "Inter";
    const style =
      typeof params.fontStyle === "string"
        ? params.fontStyle
        : typeof current !== "symbol"
          ? current.style
          : "Regular";
    const font = await ensureFont(family, style);
    node.setRangeFontName(start, end, font);
    applied.fontName = font;
  }

  if (typeof params.fontSize === "number") {
    node.setRangeFontSize(start, end, params.fontSize);
    applied.fontSize = params.fontSize;
  }

  if (typeof params.fillHex === "string") {
    node.setRangeFills(start, end, [
      solidPaint(
        params.fillHex,
        typeof params.fillOpacity === "number" ? params.fillOpacity : undefined
      ),
    ]);
    applied.fillHex = params.fillHex;
  }

  if (typeof params.letterSpacingPx === "number") {
    node.setRangeLetterSpacing(start, end, {
      unit: "PIXELS",
      value: params.letterSpacingPx,
    });
    applied.letterSpacing = node.getRangeLetterSpacing(start, Math.max(start + 1, end));
  }

  if (
    typeof params.lineHeightPx === "number" ||
    (typeof params.lineHeightValue === "number" && typeof params.lineHeightUnit === "string")
  ) {
    const lineHeight: LineHeight =
      typeof params.lineHeightPx === "number"
        ? { unit: "PIXELS", value: params.lineHeightPx }
        : {
            unit: params.lineHeightUnit as "PIXELS" | "PERCENT" | "AUTO",
            value: params.lineHeightValue as number,
          };
    node.setRangeLineHeight(start, end, lineHeight);
    applied.lineHeight = lineHeight;
  }

  if (isTextCase(params.textCase)) {
    node.setRangeTextCase(start, end, params.textCase);
    applied.textCase = params.textCase;
  }

  if (isTextDecoration(params.textDecoration)) {
    node.setRangeTextDecoration(start, end, params.textDecoration);
    applied.textDecoration = params.textDecoration;
  }

  if (typeof params.paragraphSpacing === "number") {
    node.setRangeParagraphSpacing(start, end, params.paragraphSpacing);
    applied.paragraphSpacing = params.paragraphSpacing;
  }
  if (typeof params.paragraphIndent === "number") {
    node.setRangeParagraphIndent(start, end, params.paragraphIndent);
    applied.paragraphIndent = params.paragraphIndent;
  }

  if (params.hyperlink === null) {
    node.setRangeHyperlink(start, end, null);
    applied.hyperlink = null;
  } else if (typeof params.hyperlink === "string") {
    const hyperlink: HyperlinkTarget = { type: "URL", value: params.hyperlink };
    node.setRangeHyperlink(start, end, hyperlink);
    applied.hyperlink = hyperlink;
  }

  // Node-level (non-range) properties.
  if (
    params.textAlignHorizontal === "LEFT" ||
    params.textAlignHorizontal === "CENTER" ||
    params.textAlignHorizontal === "RIGHT" ||
    params.textAlignHorizontal === "JUSTIFIED"
  ) {
    node.textAlignHorizontal = params.textAlignHorizontal;
    applied.textAlignHorizontal = node.textAlignHorizontal;
  }
  if (
    params.textAlignVertical === "TOP" ||
    params.textAlignVertical === "CENTER" ||
    params.textAlignVertical === "BOTTOM"
  ) {
    node.textAlignVertical = params.textAlignVertical;
    applied.textAlignVertical = node.textAlignVertical;
  }
  if (
    params.textAutoResize === "NONE" ||
    params.textAutoResize === "WIDTH_AND_HEIGHT" ||
    params.textAutoResize === "HEIGHT" ||
    params.textAutoResize === "TRUNCATE"
  ) {
    node.textAutoResize = params.textAutoResize;
    applied.textAutoResize = node.textAutoResize;
  }
  if (params.textTruncation === "ENDING" || params.textTruncation === "DISABLED") {
    node.textTruncation = params.textTruncation;
    applied.textTruncation = node.textTruncation;
  }

  return { nodeId: node.id, nodeName: node.name, applied };
}

/* -------------------------------------------------------------- dispatch */

export async function handleWriteRequest(request: AdvancedRequest): Promise<unknown | undefined> {
  const params = request.params ?? {};
  switch (request.type) {
    case "set_node_appearance":
      requireDesign(request.type);
      return setNodeAppearance(request, params);
    case "set_layout_grids":
      requireDesign(request.type);
      return setLayoutGrids(request, params);
    case "set_export_settings":
      requireDesign(request.type);
      return setExportSettings(request, params);
    case "set_style_reference":
      requireDesign(request.type);
      return setStyleReference(request, params);
    case "reorder_nodes":
      requireDesign(request.type);
      return reorderNodes(request, params);
    case "align_nodes":
      requireDesign(request.type);
      return alignNodes(request, params);
    case "set_image_fill":
      requireDesign(request.type);
      return setImageFill(request, params);
    case "set_text_advanced":
      requireDesign(request.type);
      return setTextAdvanced(request, params);
    default:
      return undefined;
  }
}

export const ADVANCED_WRITE_REQUEST_TYPES = [
  "set_node_appearance",
  "set_layout_grids",
  "set_export_settings",
  "set_style_reference",
  "reorder_nodes",
  "align_nodes",
  "set_image_fill",
  "set_text_advanced",
] as const;

export type AdvancedWriteRequestType = (typeof ADVANCED_WRITE_REQUEST_TYPES)[number];
