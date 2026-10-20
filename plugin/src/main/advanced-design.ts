/**
 * Design-system tools: components and instances, boolean/vector operations,
 * local styles, variables, prototype reactions and page management.
 */
import { serializePaints } from "./serializer";
import {
  anyNodeById,
  appendToParent,
  colorToHex,
  describeStyle,
  effectInputToEffect,
  ensureFont,
  firstNodeId,
  isFigJam,
  optionalNumber,
  pageNodeById,
  paintInputToPaint,
  parentNodeById,
  parseColorValue,
  requireDesign,
  requireString,
  resolveComponentNode,
  sceneNodeById,
  serializeBoundVariables,
  serializeVariableValue,
  solidPaint,
  supportsChildren,
  type AdvancedRequest,
  type EffectInput,
  type PaintInput,
  type Params,
} from "./advanced-shared";

type Json = Record<string, unknown>;

const nodeSummary = (node: SceneNode): Json => ({
  nodeId: node.id,
  nodeName: node.name,
  nodeType: node.type,
  parentId: node.parent?.id ?? null,
  x: "x" in node ? node.x : undefined,
  y: "y" in node ? node.y : undefined,
  width: "width" in node ? node.width : undefined,
  height: "height" in node ? node.height : undefined,
});

/* ------------------------------------------------------------- components */

async function createComponent(request: AdvancedRequest, params: Params): Promise<unknown> {
  const sourceId =
    request.nodeIds?.[0] ?? (typeof params.nodeId === "string" ? params.nodeId : undefined);
  let component: ComponentNode;

  if (sourceId) {
    const source = await sceneNodeById(sourceId);
    component = figma.createComponentFromNode(source);
    if (typeof params.width === "number" || typeof params.height === "number") {
      component.resize(
        typeof params.width === "number" ? params.width : component.width,
        typeof params.height === "number" ? params.height : component.height
      );
    }
    await appendToParent(component, params.parentId);
    if (typeof params.x === "number") component.x = params.x;
    if (typeof params.y === "number") component.y = params.y;
  } else {
    component = figma.createComponent();
    const width = optionalNumber(params, "width") ?? 100;
    const height = optionalNumber(params, "height") ?? 100;
    component.resize(Math.max(width, 0.01), Math.max(height, 0.01));
    if (typeof params.fillHex === "string") {
      component.fills = [solidPaint(params.fillHex, optionalNumber(params, "fillOpacity"))];
    }
    await appendToParent(component, params.parentId);
    if (typeof params.x === "number") component.x = params.x;
    if (typeof params.y === "number") component.y = params.y;
  }

  if (typeof params.name === "string") component.name = params.name;
  if (typeof params.description === "string") component.description = params.description;

  return {
    ...nodeSummary(component),
    componentKey: component.key,
    componentPropertyDefinitions: component.componentPropertyDefinitions,
  };
}

async function createComponentSet(request: AdvancedRequest, params: Params): Promise<unknown> {
  const nodeIds = request.nodeIds;
  if (!nodeIds || nodeIds.length < 2) {
    throw new Error("create_component_set requires at least 2 COMPONENT nodes");
  }
  const nodes = await Promise.all(nodeIds.map((id) => sceneNodeById(id)));
  for (const node of nodes) {
    if (node.type !== "COMPONENT") {
      throw new Error(
        `create_component_set only accepts COMPONENT nodes (got ${node.type}: ${node.id})`
      );
    }
  }

  let parent: (BaseNode & ChildrenMixin) | undefined;
  if (typeof params.parentId === "string") {
    parent = await parentNodeById(params.parentId);
  } else {
    const parents = new Set(nodes.map((node) => node.parent?.id));
    if (parents.size !== 1) {
      throw new Error("Components must share a parent, or pass parentId explicitly");
    }
    const shared = nodes[0].parent;
    if (!shared || !supportsChildren(shared)) {
      throw new Error("Shared parent does not support children");
    }
    parent = shared;
  }

  const set = figma.combineAsVariants(nodes as ComponentNode[], parent);
  if (typeof params.name === "string") set.name = params.name;
  if (typeof params.description === "string") set.description = params.description;

  return {
    ...nodeSummary(set),
    variantCount: set.children.length,
    variantGroupProperties: set.variantGroupProperties,
    componentPropertyDefinitions: set.componentPropertyDefinitions,
  };
}

async function createInstance(params: Params): Promise<unknown> {
  const componentId = requireString(params, "componentId");
  const component = await resolveComponentNode(componentId);
  const instance = component.createInstance();

  if (typeof params.name === "string") instance.name = params.name;
  await appendToParent(instance, params.parentId);
  if (typeof params.x === "number") instance.x = params.x;
  if (typeof params.y === "number") instance.y = params.y;
  // Properties/variants can change the instance size, so apply them before an
  // explicit resize.
  if (params.properties && typeof params.properties === "object") {
    instance.setProperties(params.properties as { [name: string]: string | boolean });
  }
  if (typeof params.width === "number" || typeof params.height === "number") {
    instance.resize(
      typeof params.width === "number" ? params.width : instance.width,
      typeof params.height === "number" ? params.height : instance.height
    );
  }

  return {
    ...nodeSummary(instance),
    mainComponentId: component.id,
    mainComponentName: component.name,
    componentProperties: instance.componentProperties,
  };
}

async function updateInstance(request: AdvancedRequest, params: Params): Promise<unknown> {
  const node = await sceneNodeById(firstNodeId(request));
  if (node.type !== "INSTANCE") {
    throw new Error(`update_instance requires an INSTANCE node (got ${node.type}: ${node.id})`);
  }
  const applied: Json = {};

  if (typeof params.swapComponentId === "string") {
    const component = await resolveComponentNode(params.swapComponentId);
    if (params.preserveOverrides === false) {
      node.mainComponent = component;
    } else {
      node.swapComponent(component);
    }
    applied.swapComponentId = component.id;
  }

  if (params.properties && typeof params.properties === "object") {
    node.setProperties(params.properties as { [name: string]: string | boolean });
    applied.properties = node.componentProperties;
  }

  if (params.resetOverrides === true) {
    node.resetOverrides();
    applied.resetOverrides = true;
  }

  if (params.detach === true) {
    const detached = node.detachInstance();
    return {
      detached: true,
      ...nodeSummary(detached),
      applied,
    };
  }

  const main = await node.getMainComponentAsync();
  return {
    ...nodeSummary(node),
    mainComponentId: main?.id ?? null,
    mainComponentName: main?.name ?? null,
    componentProperties: node.componentProperties,
    applied,
  };
}

async function addComponentProperty(params: Params): Promise<unknown> {
  const componentId = requireString(params, "componentId");
  const name = requireString(params, "name");
  const type = requireString(params, "type").toUpperCase();
  if (
    type !== "BOOLEAN" &&
    type !== "TEXT" &&
    type !== "INSTANCE_SWAP" &&
    type !== "VARIANT" &&
    type !== "SLOT"
  ) {
    throw new Error("type must be BOOLEAN, TEXT, INSTANCE_SWAP, VARIANT, or SLOT");
  }
  const defaultValue = params.defaultValue;
  if (typeof defaultValue !== "string" && typeof defaultValue !== "boolean") {
    throw new Error("defaultValue must be a string or boolean");
  }

  const node = await anyNodeById(componentId);
  if (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") {
    throw new Error(`componentId must be a COMPONENT or COMPONENT_SET (got ${node.type})`);
  }
  const propertyId = node.addComponentProperty(name, type, defaultValue);
  return {
    componentId: node.id,
    componentName: node.name,
    propertyId,
    componentPropertyDefinitions: node.componentPropertyDefinitions,
  };
}

async function deleteComponentProperty(params: Params): Promise<unknown> {
  if (params.confirm !== true) throw new Error("delete_component_property requires confirm: true");
  const componentId = requireString(params, "componentId");
  const propertyName = requireString(params, "propertyName");
  const node = await anyNodeById(componentId);
  if (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") {
    throw new Error(`componentId must be a COMPONENT or COMPONENT_SET (got ${node.type})`);
  }
  const definitions = node.componentPropertyDefinitions;
  if (!(propertyName in definitions)) {
    throw new Error(`Component has no property named ${propertyName}`);
  }
  const definition = definitions[propertyName];
  node.deleteComponentProperty(propertyName);
  return {
    deleted: true,
    componentId: node.id,
    componentName: node.name,
    propertyName,
    propertyType: definition.type,
    componentPropertyDefinitions: node.componentPropertyDefinitions,
  };
}

async function editComponentProperty(params: Params): Promise<unknown> {
  const componentId = requireString(params, "componentId");
  const propertyName = requireString(params, "propertyName");
  const node = await anyNodeById(componentId);
  if (node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") {
    throw new Error(`componentId must be a COMPONENT or COMPONENT_SET (got ${node.type})`);
  }

  const newValue: {
    name?: string;
    defaultValue?: string | boolean;
    preferredValues?: InstanceSwapPreferredValue[];
    description?: string;
  } = {};
  if (typeof params.name === "string") newValue.name = params.name;
  if (typeof params.defaultValue === "string" || typeof params.defaultValue === "boolean") {
    newValue.defaultValue = params.defaultValue;
  }
  if (Array.isArray(params.preferredValues)) {
    newValue.preferredValues = (params.preferredValues as unknown[]).map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        throw new Error(`preferredValues[${index}] must be an object`);
      }
      const raw = entry as { type?: unknown; key?: unknown };
      if (
        (raw.type !== "COMPONENT" && raw.type !== "COMPONENT_SET") ||
        typeof raw.key !== "string"
      ) {
        throw new Error(`preferredValues[${index}] requires type COMPONENT|COMPONENT_SET and key`);
      }
      return { type: raw.type, key: raw.key };
    });
  }
  if (typeof params.description === "string") newValue.description = params.description;
  if (Object.keys(newValue).length === 0) {
    throw new Error(
      "At least one of name, defaultValue, preferredValues, or description is required"
    );
  }

  const propertyId = node.editComponentProperty(propertyName, newValue);
  return {
    componentId: node.id,
    componentName: node.name,
    propertyName,
    propertyId,
    componentPropertyDefinitions: node.componentPropertyDefinitions,
  };
}

/* -------------------------------------------------------- boolean/vector */

async function resolveOperationParent(
  nodes: SceneNode[],
  params: Params
): Promise<BaseNode & ChildrenMixin> {
  if (typeof params.parentId === "string") return parentNodeById(params.parentId);
  const parents = new Set(nodes.map((node) => node.parent?.id));
  if (parents.size !== 1) {
    throw new Error("Nodes must share a parent, or pass parentId explicitly");
  }
  const shared = nodes[0].parent;
  if (!shared || !supportsChildren(shared)) {
    throw new Error("Shared parent does not support children");
  }
  return shared;
}

async function booleanOperation(request: AdvancedRequest, params: Params): Promise<unknown> {
  const nodeIds = request.nodeIds;
  if (!nodeIds || nodeIds.length < 2) throw new Error("nodeIds requires at least 2 nodes");
  const operation = requireString(params, "operation").toUpperCase();
  const nodes = await Promise.all(nodeIds.map((id) => sceneNodeById(id)));
  const parent = await resolveOperationParent(nodes, params);

  let result: BooleanOperationNode;
  if (operation === "UNION") result = figma.union(nodes, parent);
  else if (operation === "SUBTRACT") result = figma.subtract(nodes, parent);
  else if (operation === "INTERSECT") result = figma.intersect(nodes, parent);
  else if (operation === "EXCLUDE") result = figma.exclude(nodes, parent);
  else throw new Error("operation must be UNION, SUBTRACT, INTERSECT, or EXCLUDE");

  if (typeof params.name === "string") result.name = params.name;
  return {
    ...nodeSummary(result),
    operation: result.booleanOperation,
    childIds: result.children.map((child) => child.id),
    fills: serializePaints("fills" in result ? result.fills : undefined),
  };
}

async function flattenNodes(request: AdvancedRequest, params: Params): Promise<unknown> {
  const nodeIds = request.nodeIds;
  if (!nodeIds || nodeIds.length === 0) throw new Error("nodeIds is required");
  const nodes = await Promise.all(nodeIds.map((id) => sceneNodeById(id)));
  const parent = await resolveOperationParent(nodes, params);
  const vector = figma.flatten(nodes, parent);
  if (typeof params.name === "string") vector.name = params.name;
  return {
    ...nodeSummary(vector),
    vectorPathCount: vector.vectorPaths.length,
    fills: serializePaints(vector.fills),
  };
}

async function outlineStroke(request: AdvancedRequest, params: Params): Promise<unknown> {
  const node = await sceneNodeById(firstNodeId(request));
  if (!("outlineStroke" in node) || typeof node.outlineStroke !== "function") {
    throw new Error(`Node does not support outlineStroke: ${node.id}`);
  }
  const vector = node.outlineStroke();
  if (!vector) {
    return {
      nodeId: node.id,
      outlined: false,
      reason: "Figma returned no outline (node has no stroke)",
    };
  }
  if (typeof params.name === "string") vector.name = params.name;
  return { nodeId: node.id, outlined: true, ...nodeSummary(vector) };
}

const VECTOR_WINDING = new Set(["NONZERO", "EVENODD"]);

const normalizeVectorPaths = (value: unknown): VectorPaths => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("vectorPaths must be a non-empty array of { windingRule?, data }");
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`vectorPaths[${index}] must be an object`);
    }
    const raw = entry as { windingRule?: unknown; data?: unknown };
    if (typeof raw.data !== "string" || raw.data.length === 0) {
      throw new Error(`vectorPaths[${index}].data is required (SVG path data)`);
    }
    const windingRule =
      typeof raw.windingRule === "string" && VECTOR_WINDING.has(raw.windingRule.toUpperCase())
        ? (raw.windingRule.toUpperCase() as WindingRule)
        : "NONZERO";
    return { windingRule, data: raw.data };
  });
};

const applyVectorPaints = (vector: VectorNode, params: Params): void => {
  if (typeof params.fillHex === "string") {
    vector.fills = [solidPaint(params.fillHex, optionalNumber(params, "fillOpacity"))];
  } else if (params.fills === null) {
    vector.fills = [];
  }
  if (typeof params.strokeHex === "string") {
    vector.strokes = [solidPaint(params.strokeHex, optionalNumber(params, "strokeOpacity"))];
    if (typeof params.strokeWeight === "number") vector.strokeWeight = params.strokeWeight;
  } else if (params.strokes === null) {
    vector.strokes = [];
  }
};

async function createVector(params: Params): Promise<unknown> {
  const vector = figma.createVector();
  vector.vectorPaths = normalizeVectorPaths(params.vectorPaths);
  if (typeof params.width === "number" || typeof params.height === "number") {
    vector.resize(
      typeof params.width === "number" ? params.width : vector.width,
      typeof params.height === "number" ? params.height : vector.height
    );
  }
  if (typeof params.name === "string") vector.name = params.name;
  applyVectorPaints(vector, params);
  await appendToParent(vector, params.parentId);
  if (typeof params.x === "number") vector.x = params.x;
  if (typeof params.y === "number") vector.y = params.y;
  if (typeof params.rotation === "number") vector.rotation = params.rotation;

  return {
    ...nodeSummary(vector),
    vectorPathCount: vector.vectorPaths.length,
    fills: serializePaints(vector.fills),
    strokes: serializePaints(vector.strokes),
  };
}

async function setVectorPaths(request: AdvancedRequest, params: Params): Promise<unknown> {
  const node = await sceneNodeById(firstNodeId(request));
  const nodeId = node.id;
  if (!("vectorPaths" in node)) throw new Error(`Node does not support vectorPaths: ${nodeId}`);
  const vector = node as SceneNode & { vectorPaths: VectorPaths };
  vector.vectorPaths = normalizeVectorPaths(params.vectorPaths);
  if (typeof params.width === "number" || typeof params.height === "number") {
    const resizable = node as SceneNode & { resize(width: number, height: number): void };
    if (typeof resizable.resize !== "function") {
      throw new Error(`Node does not support resize: ${nodeId}`);
    }
    resizable.resize(
      typeof params.width === "number" ? params.width : node.width,
      typeof params.height === "number" ? params.height : node.height
    );
  }
  applyVectorPaints(vector as unknown as VectorNode, params);
  return {
    ...nodeSummary(node),
    vectorPathCount: vector.vectorPaths.length,
    vectorPaths: vector.vectorPaths,
  };
}

/* ----------------------------------------------------------------- styles */

const paintList = (value: unknown, field: string): Paint[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${field} must be a non-empty array of paints`);
  }
  return value.map((entry, index) => paintInputToPaint(entry as PaintInput, `${field}[${index}]`));
};

const effectList = (value: unknown, field: string): Effect[] => {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array of effects`);
  return value.map((entry, index) =>
    effectInputToEffect(entry as EffectInput, `${field}[${index}]`)
  );
};

const applyTextStyleDefinition = async (
  style: TextStyle,
  params: Params
): Promise<Record<string, unknown>> => {
  const applied: Json = {};
  if (typeof params.fontFamily === "string" || typeof params.fontStyle === "string") {
    const family =
      typeof params.fontFamily === "string" ? params.fontFamily : style.fontName.family;
    const fontStyle =
      typeof params.fontStyle === "string" ? params.fontStyle : style.fontName.style;
    style.fontName = await ensureFont(family, fontStyle);
    applied.fontName = style.fontName;
  }
  if (typeof params.fontSize === "number") {
    style.fontSize = params.fontSize;
    applied.fontSize = style.fontSize;
  }
  if (typeof params.textDecoration === "string") {
    style.textDecoration = params.textDecoration as TextDecoration;
    applied.textDecoration = style.textDecoration;
  }
  if (typeof params.textCase === "string") {
    style.textCase = params.textCase as TextCase;
    applied.textCase = style.textCase;
  }
  if (typeof params.letterSpacingPx === "number") {
    style.letterSpacing = { unit: "PIXELS", value: params.letterSpacingPx };
    applied.letterSpacing = style.letterSpacing;
  }
  if (typeof params.lineHeightPx === "number") {
    style.lineHeight = { unit: "PIXELS", value: params.lineHeightPx };
    applied.lineHeight = style.lineHeight;
  }
  if (typeof params.paragraphSpacing === "number") {
    style.paragraphSpacing = params.paragraphSpacing;
    applied.paragraphSpacing = style.paragraphSpacing;
  }
  if (typeof params.paragraphIndent === "number") {
    style.paragraphIndent = params.paragraphIndent;
    applied.paragraphIndent = style.paragraphIndent;
  }
  return applied;
};

async function createStyle(params: Params): Promise<unknown> {
  const type = requireString(params, "styleType").toUpperCase();
  const name = requireString(params, "name");
  const description = typeof params.description === "string" ? params.description : undefined;
  const definition = (params.definition ?? {}) as Params;

  if (type === "PAINT") {
    const style = figma.createPaintStyle();
    style.name = name;
    if (description) style.description = description;
    style.paints = paintList(definition.paints, "definition.paints");
    return { ...describeStyle(style), paints: serializePaints(style.paints) };
  }

  if (type === "TEXT") {
    const style = figma.createTextStyle();
    style.name = name;
    if (description) style.description = description;
    const applied = await applyTextStyleDefinition(style, definition);
    return { ...describeStyle(style), applied };
  }

  if (type === "EFFECT") {
    const style = figma.createEffectStyle();
    style.name = name;
    if (description) style.description = description;
    style.effects = effectList(definition.effects, "definition.effects");
    return { ...describeStyle(style), effects: style.effects };
  }

  if (type === "GRID") {
    const style = figma.createGridStyle();
    style.name = name;
    if (description) style.description = description;
    if (!Array.isArray(definition.layoutGrids)) {
      throw new Error("definition.layoutGrids must be an array");
    }
    style.layoutGrids = definition.layoutGrids as LayoutGrid[];
    return { ...describeStyle(style), layoutGrids: style.layoutGrids };
  }

  throw new Error("styleType must be PAINT, TEXT, EFFECT, or GRID");
}

async function updateStyle(params: Params): Promise<unknown> {
  const styleId = requireString(params, "styleId");
  const style = await figma.getStyleByIdAsync(styleId);
  if (!style) throw new Error(`Style not found: ${styleId}`);
  if (style.remote) throw new Error(`Style is from a library and is read-only: ${styleId}`);

  if (typeof params.name === "string") style.name = params.name;
  if (typeof params.description === "string") style.description = params.description;
  const definition = (params.definition ?? {}) as Params;

  if (style.type === "PAINT") {
    if (definition.paints !== undefined)
      style.paints = paintList(definition.paints, "definition.paints");
    return { ...describeStyle(style), paints: serializePaints(style.paints) };
  }
  if (style.type === "TEXT") {
    const applied = await applyTextStyleDefinition(style, definition);
    return { ...describeStyle(style), applied };
  }
  if (style.type === "EFFECT") {
    if (definition.effects !== undefined) {
      style.effects = effectList(definition.effects, "definition.effects");
    }
    return { ...describeStyle(style), effects: style.effects };
  }
  if (style.type === "GRID") {
    if (definition.layoutGrids !== undefined) {
      if (!Array.isArray(definition.layoutGrids)) {
        throw new Error("definition.layoutGrids must be an array");
      }
      style.layoutGrids = definition.layoutGrids as LayoutGrid[];
    }
    return { ...describeStyle(style), layoutGrids: style.layoutGrids };
  }
  throw new Error(`Unsupported style type: ${style.type}`);
}

async function deleteStyle(params: Params): Promise<unknown> {
  if (params.confirm !== true) throw new Error("delete_style requires confirm: true");
  const styleId = requireString(params, "styleId");
  const style = await figma.getStyleByIdAsync(styleId);
  if (!style) throw new Error(`Style not found: ${styleId}`);
  if (style.remote) throw new Error(`Style is from a library and cannot be deleted: ${styleId}`);
  const summary = describeStyle(style);
  style.remove();
  return { deleted: true, ...summary };
}

/* -------------------------------------------------------------- variables */

const variableValue = (
  value: unknown,
  resolvedType: VariableResolvedDataType,
  field: string
): VariableValue => {
  if (resolvedType === "COLOR") return parseColorValue(value, field);
  if (resolvedType === "FLOAT") {
    if (typeof value !== "number") throw new Error(`${field} must be a number for FLOAT variables`);
    return value;
  }
  if (resolvedType === "STRING") {
    if (typeof value !== "string")
      throw new Error(`${field} must be a string for STRING variables`);
    return value;
  }
  if (resolvedType === "BOOLEAN") {
    if (typeof value !== "boolean")
      throw new Error(`${field} must be a boolean for BOOLEAN variables`);
    return value;
  }
  throw new Error(`Unsupported variable resolvedType: ${resolvedType}`);
};

async function createVariableCollection(params: Params): Promise<unknown> {
  const name = requireString(params, "name");
  const collection = figma.variables.createVariableCollection(name);
  const defaultModeId = collection.defaultModeId;

  if (typeof params.defaultModeName === "string") {
    collection.renameMode(defaultModeId, params.defaultModeName);
  }
  const extraModes = Array.isArray(params.modes)
    ? (params.modes as unknown[]).filter((mode): mode is string => typeof mode === "string")
    : [];
  for (const mode of extraModes) collection.addMode(mode);
  if (typeof params.hiddenFromPublishing === "boolean") {
    collection.hiddenFromPublishing = params.hiddenFromPublishing;
  }

  return {
    collectionId: collection.id,
    name: collection.name,
    defaultModeId: collection.defaultModeId,
    modes: collection.modes,
    hiddenFromPublishing: collection.hiddenFromPublishing,
  };
}

async function createVariable(params: Params): Promise<unknown> {
  const collectionId = requireString(params, "collectionId");
  const name = requireString(params, "name");
  const resolvedType = requireString(params, "resolvedType").toUpperCase();
  if (
    resolvedType !== "COLOR" &&
    resolvedType !== "FLOAT" &&
    resolvedType !== "STRING" &&
    resolvedType !== "BOOLEAN"
  ) {
    throw new Error("resolvedType must be COLOR, FLOAT, STRING, or BOOLEAN");
  }
  const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
  if (!collection) throw new Error(`Variable collection not found: ${collectionId}`);

  const variable = figma.variables.createVariable(
    name,
    collection,
    resolvedType as VariableResolvedDataType
  );

  if (params.value !== undefined) {
    variable.setValueForMode(
      collection.defaultModeId,
      variableValue(params.value, variable.resolvedType, "value")
    );
  }
  if (params.valuesByMode && typeof params.valuesByMode === "object") {
    for (const [modeId, value] of Object.entries(params.valuesByMode as Params)) {
      const mode = collection.modes.find((entry) => entry.modeId === modeId);
      if (!mode) throw new Error(`Mode not found in collection: ${modeId}`);
      variable.setValueForMode(
        modeId,
        variableValue(value, variable.resolvedType, `valuesByMode.${modeId}`)
      );
    }
  }
  if (typeof params.description === "string") variable.description = params.description;
  if (Array.isArray(params.scopes)) variable.scopes = params.scopes as VariableScope[];
  if (typeof params.hiddenFromPublishing === "boolean") {
    variable.hiddenFromPublishing = params.hiddenFromPublishing;
  }

  return {
    variableId: variable.id,
    name: variable.name,
    resolvedType: variable.resolvedType,
    collectionId: variable.variableCollectionId,
    valuesByMode: Object.fromEntries(
      Object.entries(variable.valuesByMode).map(([modeId, value]) => [
        modeId,
        serializeVariableValue(value),
      ])
    ),
    scopes: variable.scopes,
  };
}

async function setVariableValue(params: Params): Promise<unknown> {
  const variableId = requireString(params, "variableId");
  const variable = await figma.variables.getVariableByIdAsync(variableId);
  if (!variable) throw new Error(`Variable not found: ${variableId}`);
  const collection = await figma.variables.getVariableCollectionByIdAsync(
    variable.variableCollectionId
  );
  if (!collection) throw new Error(`Collection not found for variable: ${variableId}`);
  const modeId = typeof params.modeId === "string" ? params.modeId : collection.defaultModeId;
  const mode = collection.modes.find((entry) => entry.modeId === modeId);
  if (!mode) throw new Error(`Mode not found: ${modeId}`);
  if (params.value === undefined) throw new Error("value is required");

  variable.setValueForMode(modeId, variableValue(params.value, variable.resolvedType, "value"));
  return {
    variableId: variable.id,
    name: variable.name,
    modeId,
    modeName: mode.name,
    valuesByMode: Object.fromEntries(
      Object.entries(variable.valuesByMode).map(([id, value]) => [
        id,
        serializeVariableValue(value),
      ])
    ),
  };
}

async function bindVariable(request: AdvancedRequest, params: Params): Promise<unknown> {
  const node = await sceneNodeById(firstNodeId(request));
  const field = requireString(params, "field");
  const variableId = typeof params.variableId === "string" ? params.variableId : null;
  const variable = variableId ? await figma.variables.getVariableByIdAsync(variableId) : null;
  if (variableId && !variable) throw new Error(`Variable not found: ${variableId}`);

  if (field === "fills" || field === "strokes") {
    const target = field === "fills" ? "fills" : "strokes";
    if (!(target in node)) throw new Error(`Node does not support ${target}: ${node.id}`);
    const geometry = node as SceneNode & {
      fills: ReadonlyArray<Paint>;
      strokes: ReadonlyArray<Paint>;
    };
    const current = geometry[target];
    if (!Array.isArray(current)) {
      throw new Error(
        `Node has mixed ${target} paints; make them uniform before binding a color variable`
      );
    }
    const paints = [...current];
    const index = optionalNumber(params, "paintIndex") ?? 0;
    if (index < 0 || index >= paints.length) {
      throw new Error(`paintIndex ${index} is outside ${target} (0..${paints.length - 1})`);
    }
    const paint = paints[index];
    if (paint.type !== "SOLID") {
      throw new Error(`Only SOLID paints can bind a color variable (got ${paint.type})`);
    }
    paints[index] = figma.variables.setBoundVariableForPaint(
      paint as SolidPaint,
      "color",
      variable
    );
    geometry[target] = paints;
  } else {
    node.setBoundVariable(field as VariableBindableNodeField, variable);
  }

  return {
    nodeId: node.id,
    nodeName: node.name,
    field,
    variableId: variable?.id ?? null,
    variableName: variable?.name ?? null,
    boundVariables: serializeBoundVariables(node.boundVariables),
  };
}

async function setVariableMode(request: AdvancedRequest, params: Params): Promise<unknown> {
  const node = await sceneNodeById(firstNodeId(request));
  const collectionId = requireString(params, "collectionId");
  const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
  if (!collection) throw new Error(`Variable collection not found: ${collectionId}`);
  const modeId = typeof params.modeId === "string" ? params.modeId : null;

  if (modeId === null) {
    node.clearExplicitVariableModeForCollection(collection);
  } else {
    const mode = collection.modes.find((entry) => entry.modeId === modeId);
    if (!mode) throw new Error(`Mode not found: ${modeId}`);
    node.setExplicitVariableModeForCollection(collection, modeId);
  }

  return {
    nodeId: node.id,
    nodeName: node.name,
    collectionId,
    collectionName: collection.name,
    modeId,
    explicitVariableModes: node.explicitVariableModes,
    resolvedVariableModes: node.resolvedVariableModes,
  };
}

async function updateVariable(params: Params): Promise<unknown> {
  const variableId = requireString(params, "variableId");
  const variable = await figma.variables.getVariableByIdAsync(variableId);
  if (!variable) throw new Error(`Variable not found: ${variableId}`);
  if (variable.remote)
    throw new Error(`Variable is from a library and is read-only: ${variableId}`);
  const collection = await figma.variables.getVariableCollectionByIdAsync(
    variable.variableCollectionId
  );

  if (typeof params.name === "string") variable.name = params.name;
  if (typeof params.description === "string") variable.description = params.description;
  if (Array.isArray(params.scopes)) variable.scopes = params.scopes as VariableScope[];
  if (typeof params.hiddenFromPublishing === "boolean") {
    variable.hiddenFromPublishing = params.hiddenFromPublishing;
  }
  if (params.valuesByMode && typeof params.valuesByMode === "object") {
    if (!collection) {
      throw new Error(`Collection not found for variable: ${variableId}`);
    }
    for (const [modeId, value] of Object.entries(params.valuesByMode as Params)) {
      const mode = collection.modes.find((entry) => entry.modeId === modeId);
      if (!mode) throw new Error(`Mode not found in collection: ${modeId}`);
      variable.setValueForMode(
        modeId,
        variableValue(value, variable.resolvedType, `valuesByMode.${modeId}`)
      );
    }
  }

  return {
    variableId: variable.id,
    name: variable.name,
    description: variable.description,
    resolvedType: variable.resolvedType,
    collectionId: variable.variableCollectionId,
    valuesByMode: Object.fromEntries(
      Object.entries(variable.valuesByMode).map(([modeId, value]) => [
        modeId,
        serializeVariableValue(value),
      ])
    ),
    scopes: variable.scopes,
    hiddenFromPublishing: variable.hiddenFromPublishing,
  };
}

async function deleteVariable(params: Params): Promise<unknown> {
  if (params.confirm !== true) throw new Error("delete_variable requires confirm: true");
  const variableId = requireString(params, "variableId");
  const variable = await figma.variables.getVariableByIdAsync(variableId);
  if (!variable) throw new Error(`Variable not found: ${variableId}`);
  if (variable.remote)
    throw new Error(`Variable is from a library and cannot be deleted: ${variableId}`);
  const summary = {
    variableId: variable.id,
    name: variable.name,
    resolvedType: variable.resolvedType,
    collectionId: variable.variableCollectionId,
  };
  variable.remove();
  return { deleted: true, ...summary };
}

async function updateVariableCollection(params: Params): Promise<unknown> {
  const collectionId = requireString(params, "collectionId");
  const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
  if (!collection) throw new Error(`Variable collection not found: ${collectionId}`);
  if (collection.remote) {
    throw new Error(`Variable collection is from a library and is read-only: ${collectionId}`);
  }

  if (typeof params.name === "string") collection.name = params.name;
  if (typeof params.hiddenFromPublishing === "boolean") {
    collection.hiddenFromPublishing = params.hiddenFromPublishing;
  }
  if (Array.isArray(params.addModes)) {
    for (const mode of params.addModes) {
      if (typeof mode !== "string" || mode.length === 0) {
        throw new Error("addModes must be an array of non-empty mode names");
      }
      collection.addMode(mode);
    }
  }
  if (params.renameModes && typeof params.renameModes === "object") {
    for (const [modeId, name] of Object.entries(params.renameModes as Params)) {
      if (typeof name !== "string" || name.length === 0) {
        throw new Error(`renameModes.${modeId} must be a non-empty string`);
      }
      const mode = collection.modes.find((entry) => entry.modeId === modeId);
      if (!mode) throw new Error(`Mode not found in collection: ${modeId}`);
      collection.renameMode(modeId, name);
    }
  }
  if (Array.isArray(params.removeModes)) {
    for (const modeId of params.removeModes) {
      if (typeof modeId !== "string") throw new Error("removeModes must be an array of mode IDs");
      const mode = collection.modes.find((entry) => entry.modeId === modeId);
      if (!mode) throw new Error(`Mode not found in collection: ${modeId}`);
      if (modeId === collection.defaultModeId) {
        throw new Error("Cannot remove the collection's default mode");
      }
      collection.removeMode(modeId);
    }
  }

  return {
    collectionId: collection.id,
    name: collection.name,
    defaultModeId: collection.defaultModeId,
    modes: collection.modes,
    variableCount: collection.variableIds.length,
    hiddenFromPublishing: collection.hiddenFromPublishing,
  };
}

async function deleteVariableCollection(params: Params): Promise<unknown> {
  if (params.confirm !== true) {
    throw new Error("delete_variable_collection requires confirm: true");
  }
  const collectionId = requireString(params, "collectionId");
  const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
  if (!collection) throw new Error(`Variable collection not found: ${collectionId}`);
  if (collection.remote) {
    throw new Error(`Variable collection is from a library and cannot be deleted: ${collectionId}`);
  }
  const summary = {
    collectionId: collection.id,
    name: collection.name,
    variableCount: collection.variableIds.length,
  };
  collection.remove();
  return { deleted: true, ...summary };
}

/* ------------------------------------------------------- prototype/pages */

async function setReactions(request: AdvancedRequest, params: Params): Promise<unknown> {
  if (isFigJam()) throw new Error("set_reactions is not available in FigJam");
  const node = await sceneNodeById(firstNodeId(request));
  if (!Array.isArray(params.reactions)) {
    throw new Error("reactions must be an array (pass [] to clear)");
  }
  if (!("setReactionsAsync" in node)) {
    throw new Error(`Node does not support reactions: ${node.id}`);
  }
  await node.setReactionsAsync(params.reactions as Reaction[]);
  return {
    nodeId: node.id,
    nodeName: node.name,
    reactions: node.reactions,
    flowStartingPoints: figma.currentPage.flowStartingPoints,
  };
}

const pagePaint = (value: unknown, field: string): Paint[] => {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array of paints`);
  return value.map((entry, index) => paintInputToPaint(entry as PaintInput, `${field}[${index}]`));
};

async function updatePage(params: Params): Promise<unknown> {
  const page =
    typeof params.pageId === "string" ? await pageNodeById(params.pageId) : figma.currentPage;

  if (params.delete === true) {
    if (params.confirm !== true) throw new Error("Deleting a page requires confirm: true");
    if (figma.root.children.length <= 1) throw new Error("Cannot delete the only page in the file");
    const summary = { pageId: page.id, pageName: page.name };
    page.remove();
    return { deleted: true, ...summary };
  }

  if (typeof params.name === "string") page.name = params.name;
  if (Array.isArray(params.backgrounds)) {
    page.backgrounds = pagePaint(params.backgrounds, "backgrounds");
  }
  if (Array.isArray(params.prototypeBackgrounds)) {
    page.prototypeBackgrounds = pagePaint(params.prototypeBackgrounds, "prototypeBackgrounds");
  }
  if (Array.isArray(params.flowStartingPoints)) {
    const points = (params.flowStartingPoints as unknown[]).map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        throw new Error(`flowStartingPoints[${index}] must be an object`);
      }
      const raw = entry as { nodeId?: unknown; name?: unknown };
      if (typeof raw.nodeId !== "string") {
        throw new Error(`flowStartingPoints[${index}].nodeId is required`);
      }
      return {
        nodeId: raw.nodeId,
        name: typeof raw.name === "string" ? raw.name : `Flow ${index + 1}`,
      };
    });
    page.flowStartingPoints = points;
  }
  if (params.setAsCurrent === true && figma.currentPage.id !== page.id) {
    await figma.setCurrentPageAsync(page);
  }

  return {
    pageId: page.id,
    pageName: page.name,
    isCurrentPage: figma.currentPage.id === page.id,
    backgrounds: page.backgrounds.map((paint) =>
      paint.type === "SOLID"
        ? { type: paint.type, color: colorToHex(paint.color) }
        : { type: paint.type }
    ),
    prototypeBackgrounds: page.prototypeBackgrounds.map((paint) =>
      paint.type === "SOLID"
        ? { type: paint.type, color: colorToHex(paint.color) }
        : { type: paint.type }
    ),
    flowStartingPoints: page.flowStartingPoints,
    pageCount: figma.root.children.length,
  };
}

/* -------------------------------------------------------------- dispatch */

export async function handleDesignRequest(request: AdvancedRequest): Promise<unknown | undefined> {
  const params = request.params ?? {};
  switch (request.type) {
    case "create_component":
      requireDesign(request.type);
      return createComponent(request, params);
    case "create_component_set":
      requireDesign(request.type);
      return createComponentSet(request, params);
    case "create_instance":
      requireDesign(request.type);
      return createInstance(params);
    case "update_instance":
      requireDesign(request.type);
      return updateInstance(request, params);
    case "add_component_property":
      requireDesign(request.type);
      return addComponentProperty(params);
    case "delete_component_property":
      requireDesign(request.type);
      return deleteComponentProperty(params);
    case "edit_component_property":
      requireDesign(request.type);
      return editComponentProperty(params);
    case "boolean_operation":
      requireDesign(request.type);
      return booleanOperation(request, params);
    case "flatten_nodes":
      requireDesign(request.type);
      return flattenNodes(request, params);
    case "outline_stroke":
      requireDesign(request.type);
      return outlineStroke(request, params);
    case "create_vector":
      requireDesign(request.type);
      return createVector(params);
    case "set_vector_paths":
      requireDesign(request.type);
      return setVectorPaths(request, params);
    case "create_style":
      requireDesign(request.type);
      return createStyle(params);
    case "update_style":
      requireDesign(request.type);
      return updateStyle(params);
    case "delete_style":
      requireDesign(request.type);
      return deleteStyle(params);
    case "create_variable_collection":
      requireDesign(request.type);
      return createVariableCollection(params);
    case "create_variable":
      requireDesign(request.type);
      return createVariable(params);
    case "set_variable_value":
      requireDesign(request.type);
      return setVariableValue(params);
    case "bind_variable":
      requireDesign(request.type);
      return bindVariable(request, params);
    case "set_variable_mode":
      requireDesign(request.type);
      return setVariableMode(request, params);
    case "update_variable":
      requireDesign(request.type);
      return updateVariable(params);
    case "delete_variable":
      requireDesign(request.type);
      return deleteVariable(params);
    case "update_variable_collection":
      requireDesign(request.type);
      return updateVariableCollection(params);
    case "delete_variable_collection":
      requireDesign(request.type);
      return deleteVariableCollection(params);
    case "set_reactions":
      requireDesign(request.type);
      return setReactions(request, params);
    case "update_page":
      requireDesign(request.type);
      return updatePage(params);
    default:
      return undefined;
  }
}

export const ADVANCED_DESIGN_REQUEST_TYPES = [
  "create_component",
  "create_component_set",
  "create_instance",
  "update_instance",
  "add_component_property",
  "delete_component_property",
  "edit_component_property",
  "boolean_operation",
  "flatten_nodes",
  "outline_stroke",
  "create_vector",
  "set_vector_paths",
  "create_style",
  "update_style",
  "delete_style",
  "create_variable_collection",
  "create_variable",
  "set_variable_value",
  "bind_variable",
  "set_variable_mode",
  "update_variable",
  "delete_variable",
  "update_variable_collection",
  "delete_variable_collection",
  "set_reactions",
  "update_page",
] as const;

export type AdvancedDesignRequestType = (typeof ADVANCED_DESIGN_REQUEST_TYPES)[number];
