/**
 * Read-only advanced tools: deep inspection, measurement, search, components,
 * image data and variable bindings. These work in the design editor, Dev Mode
 * and FigJam (where the underlying API allows it).
 */
import { serializeNode, serializePaints } from "./serializer";
import { scanPrototype } from "./prototype";
import {
  absoluteRect,
  anyNodeById,
  clamp,
  firstNodeId,
  optionalNumber,
  pageNodeById,
  requireString,
  sceneNodeById,
  serializeBoundVariables,
  serializeVariableValue,
  unionRects,
  type AdvancedRequest,
  type Params,
  type Rect,
} from "./advanced-shared";

type Json = Record<string, unknown>;

interface DetailOptions {
  depth: number;
  maxChildren: number;
  includePrototype: boolean;
  includeTextSegments: boolean;
  includeHidden: boolean;
}

const pageOf = (node: BaseNode): PageNode | null => {
  let current: BaseNode | null = node;
  while (current) {
    if (current.type === "PAGE") return current;
    current = current.parent;
  }
  return null;
};

const styleIdsOf = (node: SceneNode): Json | undefined => {
  const ids: Json = {};
  for (const field of [
    "fillStyleId",
    "strokeStyleId",
    "effectStyleId",
    "gridStyleId",
    "textStyleId",
    "backgroundStyleId",
  ] as const) {
    if (field in node) {
      const value = (node as unknown as Record<string, unknown>)[field];
      if (typeof value === "string" && value.length > 0) ids[field] = value;
    }
  }
  return Object.keys(ids).length > 0 ? ids : undefined;
};

const layoutOf = (node: SceneNode): Json | undefined => {
  const layout: Json = {};
  for (const field of [
    "layoutSizingHorizontal",
    "layoutSizingVertical",
    "layoutAlign",
    "layoutGrow",
    "layoutPositioning",
    "gridRowSpan",
    "gridColumnSpan",
    "itemReverseZIndex",
    "strokesIncludedInLayout",
    "minWidth",
    "maxWidth",
    "minHeight",
    "maxHeight",
    "widthAuto",
    "heightAuto",
  ] as const) {
    if (field in node) {
      layout[field] = (node as unknown as Record<string, unknown>)[field];
    }
  }
  return Object.keys(layout).length > 0 ? layout : undefined;
};

const componentOf = async (node: SceneNode): Promise<Json | undefined> => {
  const info: Json = {};
  if ("componentProperties" in node) {
    info.componentProperties = node.componentProperties;
  }
  if ("variantProperties" in node) {
    info.variantProperties = node.variantProperties;
  }
  if ("componentPropertyDefinitions" in node) {
    info.componentPropertyDefinitions = node.componentPropertyDefinitions;
  }
  if (node.type === "INSTANCE") {
    const main = await node.getMainComponentAsync();
    if (main) {
      info.mainComponent = { id: main.id, name: main.name, key: main.key };
      if (main.parent && main.parent.type === "COMPONENT_SET") {
        info.componentSet = { id: main.parent.id, name: main.parent.name };
      }
    }
  }
  return Object.keys(info).length > 0 ? info : undefined;
};

const textOf = async (node: SceneNode, options: DetailOptions): Promise<Json | undefined> => {
  if (node.type !== "TEXT") return undefined;
  const info: Json = {
    textCase: node.textCase,
    textDecoration: node.textDecoration,
    paragraphSpacing: node.paragraphSpacing,
    paragraphIndent: node.paragraphIndent,
    textTruncation: node.textTruncation,
    hyperlink: node.hyperlink,
    autoRename: node.autoRename,
  };
  if (options.includeTextSegments && node.characters.length > 0) {
    try {
      info.segments = node
        .getStyledTextSegments([
          "fontName",
          "fontSize",
          "fontWeight",
          "fontStyle",
          "textDecoration",
          "textCase",
          "lineHeight",
          "letterSpacing",
          "fills",
          "fillStyleId",
          "textStyleId",
          "paragraphIndent",
          "paragraphSpacing",
          "hyperlink",
        ])
        .map((segment) => ({
          start: segment.start,
          end: segment.end,
          characters: segment.characters,
          fontName: segment.fontName,
          fontSize: segment.fontSize,
          fontWeight: segment.fontWeight,
          fontStyle: segment.fontStyle,
          textDecoration: segment.textDecoration,
          textCase: segment.textCase,
          lineHeight: segment.lineHeight,
          letterSpacing: segment.letterSpacing,
          fills: serializePaints(segment.fills),
          fillStyleId: segment.fillStyleId || undefined,
          textStyleId: segment.textStyleId || undefined,
          paragraphIndent: segment.paragraphIndent,
          paragraphSpacing: segment.paragraphSpacing,
          hyperlink: segment.hyperlink,
        }));
    } catch (error) {
      info.segmentsError = error instanceof Error ? error.message : String(error);
    }
  }
  return info;
};

const describeExtras = async (node: SceneNode, options: DetailOptions): Promise<Json> => {
  const page = pageOf(node);
  const extras: Json = {
    pageId: page?.id,
    pageName: page?.name,
    parentId: node.parent?.id ?? null,
    parentName: node.parent && "name" in node.parent ? node.parent.name : null,
    absoluteBoundingBox: node.absoluteBoundingBox,
    absoluteRenderBounds: "absoluteRenderBounds" in node ? node.absoluteRenderBounds : null,
    absoluteTransform: node.absoluteTransform,
    relativeTransform: node.relativeTransform,
    x: "x" in node ? node.x : undefined,
    y: "y" in node ? node.y : undefined,
    width: "width" in node ? node.width : undefined,
    height: "height" in node ? node.height : undefined,
    rotation: "rotation" in node ? node.rotation : undefined,
    isMask: "isMask" in node ? node.isMask : undefined,
    maskType: "maskType" in node ? node.maskType : undefined,
    layout: layoutOf(node),
    styleIds: styleIdsOf(node),
    exportSettings: "exportSettings" in node ? node.exportSettings : undefined,
    layoutGrids: "layoutGrids" in node ? node.layoutGrids : undefined,
    boundVariables: serializeBoundVariables(node.boundVariables),
    variableModes: {
      explicit: node.explicitVariableModes,
      resolved: node.resolvedVariableModes,
    },
    component: await componentOf(node),
    text: await textOf(node, options),
    vectorPaths: "vectorPaths" in node ? node.vectorPaths : undefined,
  };

  if (options.includePrototype) {
    try {
      extras.prototype = await scanPrototype(node);
    } catch (error) {
      extras.prototypeError = error instanceof Error ? error.message : String(error);
    }
  }

  for (const key of Object.keys(extras)) {
    if (extras[key] === undefined) delete extras[key];
  }
  return extras;
};

async function describeNodeDeep(
  node: SceneNode,
  remainingDepth: number,
  options: DetailOptions
): Promise<Json> {
  const base = serializeNode(node) as unknown as Json;
  const result: Json = { ...base, ...(await describeExtras(node, options)) };

  if ("children" in node) {
    const children = node.children.filter(
      (child) => options.includeHidden || child.visible !== false
    );
    result.childCount = children.length;
    if (remainingDepth > 0) {
      const limited = children.slice(0, options.maxChildren);
      result.children = await Promise.all(
        limited.map((child) => describeNodeDeep(child, remainingDepth - 1, options))
      );
      if (children.length > limited.length)
        result.truncatedChildren = children.length - limited.length;
    } else {
      delete result.children;
    }
  }
  return result;
}

/* --------------------------------------------------------------- handlers */

async function getNodeDetails(request: AdvancedRequest, params: Params): Promise<unknown> {
  const node = await anyNodeById(firstNodeId(request));
  const options: DetailOptions = {
    depth: clamp(optionalNumber(params, "depth") ?? 0, 0, 20),
    maxChildren: clamp(optionalNumber(params, "maxChildren") ?? 200, 1, 2000),
    includePrototype: params.includePrototype === true,
    includeTextSegments: params.includeTextSegments !== false,
    includeHidden: params.includeHidden === true,
  };
  if (node.type === "DOCUMENT") {
    throw new Error("get_node_details requires a page or scene node");
  }
  if (node.type === "PAGE") {
    await node.loadAsync();
    return {
      id: node.id,
      name: node.name,
      type: node.type,
      pageId: node.id,
      pageName: node.name,
      childCount: node.children.length,
      children:
        options.depth > 0
          ? await Promise.all(
              node.children
                .filter((child) => options.includeHidden || child.visible !== false)
                .slice(0, options.maxChildren)
                .map((child) => describeNodeDeep(child, options.depth - 1, options))
            )
          : undefined,
      backgrounds: serializePaints(node.backgrounds),
      prototypeBackgrounds: serializePaints(node.prototypeBackgrounds),
      flowStartingPoints: node.flowStartingPoints,
      isCurrentPage: figma.currentPage.id === node.id,
      pageCount: figma.root.children.length,
    };
  }
  return describeNodeDeep(node as SceneNode, options.depth, options);
}

interface MeasureNode {
  id: string;
  name: string;
  type: string;
  rect: Rect;
  local: { x: number; y: number; width: number; height: number; rotation: number };
  parentId: string | null;
  constraints?: { horizontal: string; vertical: string };
  autoLayout?: { layoutMode: string; itemSpacing: number; padding: unknown };
}

const measureNode = (node: SceneNode): MeasureNode => ({
  id: node.id,
  name: node.name,
  type: node.type,
  rect: absoluteRect(node),
  local: {
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    rotation: "rotation" in node ? node.rotation : 0,
  },
  parentId: node.parent?.id ?? null,
  constraints: "constraints" in node ? node.constraints : undefined,
  autoLayout:
    "layoutMode" in node
      ? {
          layoutMode: node.layoutMode,
          itemSpacing: (node as FrameNode).itemSpacing,
          padding: {
            top: (node as FrameNode).paddingTop,
            right: (node as FrameNode).paddingRight,
            bottom: (node as FrameNode).paddingBottom,
            left: (node as FrameNode).paddingLeft,
          },
        }
      : undefined,
});

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number): number =>
  Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));

async function measureNodes(request: AdvancedRequest, params: Params): Promise<unknown> {
  const nodeIds = request.nodeIds;
  if (!nodeIds || nodeIds.length === 0) throw new Error("nodeIds is required");
  const tolerance = optionalNumber(params, "tolerance") ?? 0.5;
  const includePairs = params.includePairs !== false;
  const nodes = await Promise.all(nodeIds.map((id) => sceneNodeById(id)));
  const measured = nodes.map(measureNode);
  const union = unionRects(measured.map((entry) => entry.rect));

  // Pairwise output is O(n²); keep a runaway call from freezing the plugin.
  if (includePairs && measured.length > 200) {
    throw new Error(
      "includePairs supports at most 200 nodes; pass includePairs: false for larger sets"
    );
  }

  const pairs: Json[] = [];
  if (includePairs) {
    for (let i = 0; i < measured.length; i++) {
      for (let j = i + 1; j < measured.length; j++) {
        const a = measured[i].rect;
        const b = measured[j].rect;
        const horizontalGap = b.x - a.right;
        const verticalGap = b.y - a.bottom;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        // Signed separation per axis: positive when the boxes are apart,
        // negative when they overlap (then it is the penetration depth).
        const horizontalSeparation = Math.max(b.x - a.right, a.x - b.right);
        const verticalSeparation = Math.max(b.y - a.bottom, a.y - b.bottom);
        const distance =
          horizontalSeparation > 0 && verticalSeparation > 0
            ? Math.hypot(horizontalSeparation, verticalSeparation)
            : horizontalSeparation > 0
              ? horizontalSeparation
              : verticalSeparation > 0
                ? verticalSeparation
                : -Math.min(-horizontalSeparation, -verticalSeparation);
        const near = (left: number, right: number) => Math.abs(left - right) <= tolerance;
        pairs.push({
          a: measured[i].id,
          b: measured[j].id,
          dx,
          dy,
          centerDelta: { x: b.cx - a.cx, y: b.cy - a.cy },
          horizontalGap,
          verticalGap,
          gap: {
            horizontal: horizontalGap,
            vertical: verticalGap,
            // Real distance between the closest edges in px (negative = the
            // boxes overlap by that many pixels).
            distance,
            closest: distance,
            // Space to each side of A, measured to B (negative = overlap).
            left: a.x - b.right,
            right: b.x - a.right,
            top: a.y - b.bottom,
            bottom: b.y - a.bottom,
          },
          overlap: {
            x: overlaps(a.x, a.right, b.x, b.right),
            y: overlaps(a.y, a.bottom, b.y, b.bottom),
            area: overlaps(a.x, a.right, b.x, b.right) * overlaps(a.y, a.bottom, b.y, b.bottom),
          },
          aligned: {
            left: near(a.x, b.x),
            right: near(a.right, b.right),
            top: near(a.y, b.y),
            bottom: near(a.bottom, b.bottom),
            centerX: near(a.cx, b.cx),
            centerY: near(a.cy, b.cy),
          },
          contains: {
            aInB: a.x >= b.x && a.y >= b.y && a.right <= b.right && a.bottom <= b.bottom,
            bInA: b.x >= a.x && b.y >= a.y && b.right <= a.right && b.bottom <= a.bottom,
          },
        });
      }
    }
  }

  return {
    coordinateSpace: "document-absolute (rotation-aware bounding boxes)",
    tolerance,
    union,
    nodes: measured,
    pairs,
  };
}

interface FindOptions {
  root: PageNode | SceneNode;
  query: string | undefined;
  match: "contains" | "exact" | "regex";
  types: string[];
  includeHidden: boolean;
  maxResults: number;
  includeBounds: boolean;
}

const nameMatches = (name: string, options: FindOptions): boolean => {
  if (options.query === undefined) return true;
  if (options.match === "exact") return name === options.query;
  if (options.match === "regex") {
    try {
      return new RegExp(options.query, "i").test(name);
    } catch {
      throw new Error(`Invalid regular expression: ${options.query}`);
    }
  }
  return name.toLowerCase().includes(options.query.toLowerCase());
};

async function findNodes(params: Params): Promise<unknown> {
  const match = params.match === "exact" || params.match === "regex" ? params.match : "contains";
  const types = Array.isArray(params.types)
    ? (params.types as unknown[])
        .filter((type): type is string => typeof type === "string")
        .map((type) => type.toUpperCase())
    : [];
  const query = typeof params.query === "string" ? params.query : undefined;
  const includeHidden = params.includeHidden === true;
  const maxResults = clamp(optionalNumber(params, "maxResults") ?? 100, 1, 5000);
  const includeBounds = params.includeBounds !== false;

  let root: PageNode | SceneNode;
  if (typeof params.rootId === "string") {
    const node = await anyNodeById(params.rootId);
    if (node.type === "DOCUMENT") throw new Error("rootId must be a page or scene node");
    root = node.type === "PAGE" ? await pageNodeById(node.id) : (node as SceneNode);
  } else {
    root = figma.currentPage;
  }

  const options: FindOptions = {
    root,
    query,
    match,
    types,
    includeHidden,
    maxResults,
    includeBounds,
  };

  const matches: Json[] = [];
  let scanned = 0;
  let truncated = false;

  const visit = (node: SceneNode, path: string[]): void => {
    if (matches.length >= maxResults) {
      truncated = true;
      return;
    }
    scanned++;
    if (!includeHidden && node.visible === false) return;
    const typeMatches = types.length === 0 || types.includes(node.type);
    if (typeMatches && nameMatches(node.name, options)) {
      matches.push({
        id: node.id,
        name: node.name,
        type: node.type,
        path,
        ...(includeBounds
          ? {
              bounds: absoluteRect(node),
              local: { x: node.x, y: node.y, width: node.width, height: node.height },
            }
          : {}),
      });
      if (matches.length >= maxResults) {
        truncated = true;
        return;
      }
    }
    if ("children" in node) {
      for (const child of node.children) visit(child, [...path, node.name]);
    }
  };

  if ("children" in root) {
    const startPath = root.type === "PAGE" ? [] : [root.name];
    for (const child of root.children) visit(child, startPath);
  }

  return {
    rootId: root.id,
    rootName: root.name,
    scanned,
    count: matches.length,
    truncated,
    matches,
  };
}

async function getComponents(params: Params): Promise<unknown> {
  const pages =
    typeof params.pageId === "string"
      ? [await pageNodeById(params.pageId)]
      : [...figma.root.children];

  const components: Json[] = [];
  const componentSets: Json[] = [];

  for (const page of pages) {
    await page.loadAsync();
    const found = page.findAllWithCriteria({ types: ["COMPONENT", "COMPONENT_SET"] });
    for (const node of found) {
      const bounds = node.absoluteBoundingBox;
      if (node.type === "COMPONENT_SET") {
        const set = node as ComponentSetNode;
        componentSets.push({
          id: set.id,
          name: set.name,
          key: set.key,
          description: set.description,
          pageId: page.id,
          pageName: page.name,
          bounds,
          variantCount: set.children.length,
          variantGroupProperties: set.variantGroupProperties,
          componentPropertyDefinitions: set.componentPropertyDefinitions,
        });
        continue;
      }
      const component = node as ComponentNode;
      components.push({
        id: component.id,
        name: component.name,
        key: component.key,
        description: component.description,
        pageId: page.id,
        pageName: page.name,
        bounds,
        parentId: component.parent?.id ?? null,
        componentSetId: component.parent?.type === "COMPONENT_SET" ? component.parent.id : null,
        variantProperties: component.variantProperties,
        componentPropertyDefinitions: component.componentPropertyDefinitions,
      });
    }
  }

  return {
    count: components.length,
    componentSetCount: componentSets.length,
    components,
    componentSets,
  };
}

async function getImageData(request: AdvancedRequest, params: Params): Promise<unknown> {
  const imageHashParam = typeof params.imageHash === "string" ? params.imageHash : undefined;
  const includeBase64 = params.includeBase64 !== false;
  const nodeId = request.nodeIds?.[0];

  const hashes: Array<{ hash: string; source: Json }> = [];
  if (imageHashParam) {
    hashes.push({ hash: imageHashParam, source: { imageHash: imageHashParam } });
  } else if (nodeId) {
    const node = await sceneNodeById(nodeId);
    const inspect = (paints: readonly Paint[] | symbol, kind: "fill" | "stroke") => {
      if (!Array.isArray(paints)) return;
      paints.forEach((paint, index) => {
        if (paint.type === "IMAGE" && paint.imageHash) {
          hashes.push({
            hash: paint.imageHash,
            source: {
              nodeId: node.id,
              nodeName: node.name,
              kind,
              index,
              scaleMode: paint.scaleMode,
              imageTransform: paint.imageTransform,
              opacity: paint.opacity,
              visible: paint.visible !== false,
            },
          });
        }
      });
    };
    if ("fills" in node) inspect(node.fills, "fill");
    if ("strokes" in node) inspect(node.strokes, "stroke");
    if (hashes.length === 0) throw new Error(`Node has no IMAGE paint: ${nodeId}`);
  } else {
    throw new Error("nodeId or imageHash is required");
  }

  const images: Json[] = [];
  for (const entry of hashes) {
    const image = figma.getImageByHash(entry.hash);
    if (!image) {
      images.push({ ...entry.source, imageHash: entry.hash, error: "Image not found" });
      continue;
    }
    const size = await image.getSizeAsync();
    const result: Json = {
      ...entry.source,
      imageHash: entry.hash,
      width: size.width,
      height: size.height,
    };
    if (includeBase64) {
      const bytes = await image.getBytesAsync();
      result.base64 = figma.base64Encode(bytes);
      result.byteLength = bytes.length;
    }
    images.push(result);
  }

  return { count: images.length, images };
}

const describeVariableAlias = async (consumer: SceneNode, alias: VariableAlias): Promise<Json> => {
  const variable = await figma.variables.getVariableByIdAsync(alias.id);
  if (!variable) return { id: alias.id, error: "Variable not found" };
  const collection = await figma.variables.getVariableCollectionByIdAsync(
    variable.variableCollectionId
  );
  let resolved: Json | undefined;
  try {
    const forConsumer = variable.resolveForConsumer(consumer);
    resolved = {
      value: serializeVariableValue(forConsumer.value),
      resolvedType: forConsumer.resolvedType,
    };
  } catch (error) {
    resolved = { error: error instanceof Error ? error.message : String(error) };
  }
  return {
    id: variable.id,
    name: variable.name,
    resolvedType: variable.resolvedType,
    collectionId: variable.variableCollectionId,
    collectionName: collection?.name,
    valuesByMode: Object.fromEntries(
      Object.entries(variable.valuesByMode).map(([modeId, value]) => [
        modeId,
        serializeVariableValue(value),
      ])
    ),
    resolved,
  };
};

async function getNodeVariables(request: AdvancedRequest, params: Params): Promise<unknown> {
  const node = await sceneNodeById(firstNodeId(request));
  const bindings: Json[] = [];

  const addAlias = async (field: string, alias: VariableAlias, paintIndex?: number) => {
    bindings.push({
      field,
      ...(paintIndex === undefined ? {} : { paintIndex }),
      ...(await describeVariableAlias(node, alias)),
    });
  };

  const bound = node.boundVariables;
  if (bound) {
    for (const [field, alias] of Object.entries(bound)) {
      if (Array.isArray(alias)) {
        for (let index = 0; index < alias.length; index++) {
          const entry = alias[index] as VariableAlias | undefined;
          if (entry) await addAlias(field, entry, index);
        }
      } else if (alias) {
        await addAlias(field, alias as VariableAlias);
      }
    }
  }

  const modes: Json[] = [];
  const explicit = node.explicitVariableModes;
  const resolved = node.resolvedVariableModes;
  const collectionIds = new Set([...Object.keys(explicit), ...Object.keys(resolved)]);
  for (const collectionId of collectionIds) {
    const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
    const explicitModeId = explicit[collectionId];
    const resolvedModeId = resolved[collectionId];
    modes.push({
      collectionId,
      collectionName: collection?.name,
      explicitModeId: explicitModeId ?? null,
      explicitModeName:
        collection?.modes.find((mode) => mode.modeId === explicitModeId)?.name ?? null,
      resolvedModeId: resolvedModeId ?? null,
      resolvedModeName:
        collection?.modes.find((mode) => mode.modeId === resolvedModeId)?.name ?? null,
    });
  }

  const output: Json = {
    nodeId: node.id,
    nodeName: node.name,
    boundVariableCount: bindings.length,
    bindings,
    modes,
  };

  if (params.includeInferred === true && node.inferredVariables) {
    const inferred: Json[] = [];
    for (const [field, alias] of Object.entries(node.inferredVariables)) {
      if (!alias) continue;
      if (Array.isArray(alias) && alias.length > 0 && Array.isArray(alias[0])) {
        const nested = alias as unknown as VariableAlias[][];
        for (let index = 0; index < nested.length; index++) {
          for (const entry of nested[index]) {
            inferred.push({
              field,
              paintIndex: index,
              ...(await describeVariableAlias(node, entry)),
            });
          }
        }
      } else {
        for (const entry of alias as VariableAlias[]) {
          if (entry) inferred.push({ field, ...(await describeVariableAlias(node, entry)) });
        }
      }
    }
    output.inferred = inferred;
  }

  return output;
}

/* -------------------------------------------------------------- dispatch */

export async function handleReadRequest(request: AdvancedRequest): Promise<unknown | undefined> {
  const params = request.params ?? {};
  switch (request.type) {
    case "get_node_details":
      return getNodeDetails(request, params);
    case "measure_nodes":
      return measureNodes(request, params);
    case "find_nodes":
      return findNodes(params);
    case "get_components":
      return getComponents(params);
    case "get_image_data":
      return getImageData(request, params);
    case "get_node_variables":
      return getNodeVariables(request, params);
    default:
      return undefined;
  }
}

export const ADVANCED_READ_REQUEST_TYPES = [
  "get_node_details",
  "measure_nodes",
  "find_nodes",
  "get_components",
  "get_image_data",
  "get_node_variables",
] as const;

export type AdvancedReadRequestType = (typeof ADVANCED_READ_REQUEST_TYPES)[number];
