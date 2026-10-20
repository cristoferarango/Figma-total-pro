/**
 * Shared helpers for the advanced tool surface (measurement, styling,
 * components, vectors, styles, variables and pages).
 *
 * The advanced handlers live in their own modules so the original code.ts
 * switch stays readable. Everything in here is deliberately dependency-free
 * apart from the plugin typings and the serializer.
 */
import type { SerializedPaint } from "./serializer";
import { toHex } from "./serializer";

export type Params = Record<string, unknown>;

export interface AdvancedRequest {
  type: string;
  requestId: string;
  nodeIds?: string[];
  params?: Params;
}

export const isFigJam = (): boolean => figma.editorType === "figjam";

export const isDevMode = (): boolean => figma.editorType === "dev";

export const requireDesign = (toolName: string): void => {
  if (isDevMode()) {
    throw new Error(
      `${toolName} requires the plugin to be opened in Figma's design editor (Dev Mode is read-only). Switch to the design editor and re-run.`
    );
  }
};

export const firstNodeId = (request: AdvancedRequest): string => {
  const nodeId = request.nodeIds?.[0];
  if (!nodeId) throw new Error("nodeIds is required");
  return nodeId;
};

export const requireString = (params: Params, key: string): string => {
  const value = params[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} is required`);
  }
  return value;
};

export const optionalNumber = (params: Params, key: string): number | undefined =>
  typeof params[key] === "number" && Number.isFinite(params[key])
    ? (params[key] as number)
    : undefined;

export const requireNumber = (params: Params, key: string): number => {
  const value = optionalNumber(params, key);
  if (value === undefined) throw new Error(`${key} is required (a finite number)`);
  return value;
};

export const requireBoolean = (params: Params, key: string): boolean => {
  const value = params[key];
  if (typeof value !== "boolean") throw new Error(`${key} is required (a boolean)`);
  return value;
};

export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/* ------------------------------------------------------------------ nodes */

export async function anyNodeById(nodeId: string): Promise<BaseNode> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node) throw new Error(`Node not found: ${nodeId}`);
  return node;
}

export async function sceneNodeById(nodeId: string): Promise<SceneNode> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node || node.type === "DOCUMENT" || node.type === "PAGE") {
    throw new Error(`Scene node not found: ${nodeId}`);
  }
  return node as SceneNode;
}

export async function pageNodeById(nodeId: string): Promise<PageNode> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (!node || node.type !== "PAGE") throw new Error(`Page not found: ${nodeId}`);
  await node.loadAsync();
  return node;
}

export const supportsChildren = (node: BaseNode): node is BaseNode & ChildrenMixin =>
  "appendChild" in node;

export async function parentNodeById(parentId: string): Promise<BaseNode & ChildrenMixin> {
  const parent = await figma.getNodeByIdAsync(parentId);
  if (!parent || parent.type === "DOCUMENT" || !supportsChildren(parent)) {
    throw new Error(`Parent does not support children: ${parentId}`);
  }
  if (parent.type === "PAGE") await parent.loadAsync();
  return parent;
}

export async function appendToParent(node: SceneNode, parentId: unknown): Promise<void> {
  if (typeof parentId !== "string") return;
  const parent = await parentNodeById(parentId);
  parent.appendChild(node);
}

export const supportsInsertChild = (
  node: BaseNode
): node is BaseNode & ChildrenMixin & { insertChild(index: number, child: SceneNode): void } =>
  "insertChild" in node;

/* ----------------------------------------------------------------- colors */

const HEX_PATTERN = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function hexToRgb(hex: string): RGB {
  const match = hex.trim().match(HEX_PATTERN);
  if (!match) throw new Error(`Invalid hex color: ${hex}`);
  const raw = match[1];
  const expanded =
    raw.length === 3
      ? raw
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : raw;
  return {
    r: parseInt(expanded.slice(0, 2), 16) / 255,
    g: parseInt(expanded.slice(2, 4), 16) / 255,
    b: parseInt(expanded.slice(4, 6), 16) / 255,
  };
}

export function colorToHex(color: RGB): string {
  return toHex(color);
}

/** Accepts '#RRGGBB', { hex }, or { r, g, b, a } with 0..1 channels. */
export function parseColorValue(value: unknown, field: string): RGBA {
  if (typeof value === "string") {
    const rgb = hexToRgb(value);
    return { ...rgb, a: 1 };
  }
  if (value && typeof value === "object") {
    const raw = value as Record<string, unknown>;
    if (typeof raw.hex === "string") {
      const rgb = hexToRgb(raw.hex);
      const alpha =
        typeof raw.a === "number" ? raw.a : typeof raw.opacity === "number" ? raw.opacity : 1;
      return { ...rgb, a: alpha };
    }
    if (typeof raw.r === "number" && typeof raw.g === "number" && typeof raw.b === "number") {
      return {
        r: raw.r,
        g: raw.g,
        b: raw.b,
        a: typeof raw.a === "number" ? raw.a : 1,
      };
    }
  }
  throw new Error(`${field} must be a hex string or { r, g, b, a } color (0..1 channels)`);
}

export function solidPaint(hex: string, opacity?: number): SolidPaint {
  return {
    type: "SOLID",
    color: hexToRgb(hex),
    opacity: opacity ?? 1,
  };
}

/* ---------------------------------------------------------------- paints */

export interface PaintInput {
  type?: string;
  visible?: boolean;
  opacity?: number;
  color?: string | RGB;
  hex?: string;
  gradientStops?: Array<{
    position?: number;
    color?: string | RGB;
    hex?: string;
    opacity?: number;
  }>;
  gradientTransform?: Transform;
  imageHash?: string;
  scaleMode?: string;
  imageTransform?: Transform;
  filters?: unknown;
}

export function paintInputToPaint(raw: PaintInput, field: string): Paint {
  const type = typeof raw.type === "string" ? raw.type : "SOLID";
  const visible = raw.visible === undefined ? true : Boolean(raw.visible);
  const paintOpacity = typeof raw.opacity === "number" ? raw.opacity : 1;

  if (type === "SOLID") {
    const color =
      typeof raw.hex === "string"
        ? hexToRgb(raw.hex)
        : typeof raw.color === "string"
          ? hexToRgb(raw.color)
          : raw.color && typeof raw.color === "object"
            ? (raw.color as RGB)
            : undefined;
    if (!color) throw new Error(`${field}.color (or .hex) is required for SOLID paints`);
    return {
      type: "SOLID",
      color: { r: color.r, g: color.g, b: color.b },
      opacity: paintOpacity,
      visible,
    } as SolidPaint;
  }

  if (
    type === "GRADIENT_LINEAR" ||
    type === "GRADIENT_RADIAL" ||
    type === "GRADIENT_ANGULAR" ||
    type === "GRADIENT_DIAMOND"
  ) {
    if (!Array.isArray(raw.gradientStops) || raw.gradientStops.length < 2) {
      throw new Error(`${field}.gradientStops must have at least 2 entries`);
    }
    const stops = raw.gradientStops.map((stop, index) => {
      if (typeof stop.position !== "number") {
        throw new Error(`${field}.gradientStops[${index}].position must be a number`);
      }
      let rgb: RGB;
      if (typeof stop.hex === "string") rgb = hexToRgb(stop.hex);
      else if (typeof stop.color === "string") rgb = hexToRgb(stop.color);
      else if (stop.color && typeof stop.color === "object") rgb = stop.color as RGB;
      else throw new Error(`${field}.gradientStops[${index}].color is required`);
      return {
        position: stop.position,
        color: { ...rgb, a: typeof stop.opacity === "number" ? stop.opacity : 1 },
      };
    });
    const transform: Transform = raw.gradientTransform ?? [
      [1, 0, 0],
      [0, 1, 0],
    ];
    return {
      type,
      gradientStops: stops,
      gradientTransform: transform,
      opacity: paintOpacity,
      visible,
    } as GradientPaint;
  }

  if (type === "IMAGE") {
    if (typeof raw.imageHash !== "string" || raw.imageHash.length === 0) {
      throw new Error(`${field}.imageHash is required for IMAGE paints`);
    }
    const scaleMode =
      raw.scaleMode === "FIT" ||
      raw.scaleMode === "CROP" ||
      raw.scaleMode === "TILE" ||
      raw.scaleMode === "FILL"
        ? raw.scaleMode
        : "FILL";
    return {
      type: "IMAGE",
      imageHash: raw.imageHash,
      scaleMode,
      imageTransform: raw.imageTransform ?? [
        [1, 0, 0],
        [0, 1, 0],
      ],
      opacity: paintOpacity,
      visible,
    } as ImagePaint;
  }

  throw new Error(`${field}.type is not a supported paint type: ${type}`);
}

export interface EffectInput {
  type?: string;
  visible?: boolean;
  color?: string | RGB;
  hex?: string;
  opacity?: number;
  offset?: { x?: number; y?: number };
  radius?: number;
  spread?: number;
  blendMode?: string;
}

export function effectInputToEffect(raw: EffectInput, field: string): Effect {
  const visible = raw.visible === undefined ? true : Boolean(raw.visible);
  if (raw.type === "LAYER_BLUR" || raw.type === "BACKGROUND_BLUR") {
    if (typeof raw.radius !== "number") throw new Error(`${field}.radius must be a number`);
    return { type: raw.type, radius: raw.radius, visible } as Effect;
  }
  if (raw.type === "DROP_SHADOW" || raw.type === "INNER_SHADOW") {
    const offset = raw.offset;
    if (!offset || typeof offset.x !== "number" || typeof offset.y !== "number") {
      throw new Error(`${field}.offset must be { x, y } numbers`);
    }
    if (typeof raw.radius !== "number") throw new Error(`${field}.radius must be a number`);
    let rgb: RGB;
    if (typeof raw.hex === "string") rgb = hexToRgb(raw.hex);
    else if (typeof raw.color === "string") rgb = hexToRgb(raw.color);
    else if (raw.color && typeof raw.color === "object") rgb = raw.color;
    else throw new Error(`${field}.color is required`);
    const alpha = typeof raw.opacity === "number" ? raw.opacity : 1;
    return {
      type: raw.type,
      color: { ...rgb, a: alpha },
      offset: { x: offset.x, y: offset.y },
      radius: raw.radius,
      spread: typeof raw.spread === "number" ? raw.spread : 0,
      visible,
      blendMode: typeof raw.blendMode === "string" ? (raw.blendMode as BlendMode) : "NORMAL",
    } as DropShadowEffect | InnerShadowEffect;
  }
  throw new Error(`${field}.type is not a supported effect type: ${String(raw.type)}`);
}

/* -------------------------------------------------------------- geometry */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
  cx: number;
  cy: number;
}

export function rectFromBox(box: { x: number; y: number; width: number; height: number }): Rect {
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    right: box.x + box.width,
    bottom: box.y + box.height,
    cx: box.x + box.width / 2,
    cy: box.y + box.height / 2,
  };
}

export function absoluteRect(node: SceneNode): Rect {
  const box = node.absoluteBoundingBox ?? {
    // Hidden or otherwise unbounded nodes can report a null absolute box; the
    // translation column of absoluteTransform is still document-space, unlike
    // node.x/node.y (which are parent-relative).
    x: node.absoluteTransform[0][2],
    y: node.absoluteTransform[1][2],
    width: node.width,
    height: node.height,
  };
  return rectFromBox(box);
}

export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.right);
    maxY = Math.max(maxY, rect.bottom);
  }
  return rectFromBox({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
}

/* ------------------------------------------------------ variables/aliases */

export function serializeVariableValue(value: VariableValue): unknown {
  if (typeof value !== "object" || value === null) return value;
  if ("type" in value && value.type === "VARIABLE_ALIAS") {
    return { type: "VARIABLE_ALIAS", id: value.id };
  }
  if ("r" in value && "g" in value && "b" in value) {
    const color = value as RGBA;
    return { type: "COLOR", hex: toHex(color), r: color.r, g: color.g, b: color.b, a: color.a };
  }
  return value;
}

export function serializeAlias(alias: VariableAlias | undefined): unknown {
  if (!alias) return undefined;
  return { type: "VARIABLE_ALIAS", id: alias.id };
}

export function serializeBoundVariables(
  boundVariables: SceneNode["boundVariables"]
): Record<string, unknown> | undefined {
  if (!boundVariables) return undefined;
  const output: Record<string, unknown> = {};
  for (const [field, alias] of Object.entries(boundVariables)) {
    if (Array.isArray(alias)) {
      output[field] = alias.map((entry) => serializeAlias(entry as VariableAlias));
    } else {
      output[field] = serializeAlias(alias as VariableAlias);
    }
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

/* ------------------------------------------------------------- components */

export async function resolveComponentNode(nodeId: string): Promise<ComponentNode> {
  const node = await anyNodeById(nodeId);
  if (node.type === "COMPONENT") return node;
  if (node.type === "COMPONENT_SET") {
    const variant =
      node.defaultVariant ??
      node.children.find((child): child is ComponentNode => child.type === "COMPONENT");
    if (!variant) throw new Error(`Component set has no variants: ${nodeId}`);
    return variant;
  }
  if (node.type === "INSTANCE") {
    const main = await node.getMainComponentAsync();
    if (main) return main;
  }
  throw new Error(`Node is not a component, component set, or instance: ${nodeId}`);
}

/* ---------------------------------------------------------------- styles */

export function describeStyle(style: BaseStyle): Record<string, unknown> {
  return {
    id: style.id,
    type: style.type,
    name: style.name,
    description: style.description,
    key: style.key,
    remote: style.remote,
  };
}

export function paintSummary(paint: SerializedPaint): Record<string, unknown> {
  if (paint.type === "SOLID")
    return { type: paint.type, color: paint.color, opacity: paint.opacity };
  if (paint.type === "IMAGE") {
    return {
      type: paint.type,
      imageHash: paint.imageHash,
      scaleMode: paint.scaleMode,
      imageTransform: paint.imageTransform,
      opacity: paint.opacity,
    };
  }
  return {
    type: paint.type,
    gradientStops: paint.gradientStops,
    gradientTransform: paint.gradientTransform,
    opacity: paint.opacity,
  };
}

/* ------------------------------------------------------------------ text */

export const TEXT_CASES = [
  "ORIGINAL",
  "UPPER",
  "LOWER",
  "TITLE",
  "SMALL_CAPS",
  "SMALL_CAPS_FORCED",
] as const;

export const TEXT_DECORATIONS = ["NONE", "UNDERLINE", "STRIKETHROUGH"] as const;

export function isTextCase(value: unknown): value is TextCase {
  return typeof value === "string" && (TEXT_CASES as readonly string[]).includes(value);
}

export function isTextDecoration(value: unknown): value is TextDecoration {
  return typeof value === "string" && (TEXT_DECORATIONS as readonly string[]).includes(value);
}

export async function loadFontsForText(
  node: TextNode,
  start?: number,
  end?: number
): Promise<void> {
  const fonts = new Map<string, FontName>();
  const length = node.characters.length;
  const from = start ?? 0;
  const to = end ?? length;
  if (length > 0) {
    for (const font of node.getRangeAllFontNames(Math.max(0, from), Math.min(length, to))) {
      fonts.set(`${font.family}::${font.style}`, font);
    }
  } else if (typeof node.fontName !== "symbol") {
    fonts.set(`${node.fontName.family}::${node.fontName.style}`, node.fontName);
  }
  await Promise.all([...fonts.values()].map((font) => figma.loadFontAsync(font)));
}

export async function ensureFont(family: string, style: string): Promise<FontName> {
  const font: FontName = { family, style };
  await figma.loadFontAsync(font);
  return font;
}

export function assertRange(node: TextNode, start: number, end: number): void {
  const length = node.characters.length;
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new Error("range.start and range.end must be integers");
  }
  if (start < 0 || end > length || start > end) {
    throw new Error(`Range ${start}..${end} is outside the text (0..${length})`);
  }
  if (start === end) throw new Error("Range is empty");
}
