/**
 * 
 * Main export code based on code by `jake-figma`
 * https://github.com/jake-figma/figma-token-json
 * 
 */
console.clear()
console.log("------------------- Console cleared by Export Design Tokens (W3C) -------------------")

figma.showUI(__html__)

const KEY_PREFIX_COLLECTION = ``;

type DesignTokenType = "color" | "number"
type DesignToken = {
  $type: DesignTokenType
  $value: any
}

type Tree = DesignToken | { [key: string]: Tree };
type Node = Exclude<Tree, DesignToken>

exportToJSON();

/**
 * Exports all collections to a .zip file and triggers a download.
 */
async function exportToJSON() {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const object: Tree = {};
  const { idToKey } = uniqueKeyIdMaps(collections, "id", KEY_PREFIX_COLLECTION);

  for (const collection of collections) {
    object[idToKey[collection.id]] = await collectionAsJSON(idToKey, collection)
  }

  exportFiles(object)
}

/**
 * Takes a tree of design tokens, split is up by collection and mode and generates a file structure that is send to a .zip file.
 * 
 * The generated structure is as follows:
 * 
 * ```
 * {
 *   [collection].[mode].json: json_content,
 *   ...
 * }
 * ```
 * 
 * @param object A design token tree
 */
function exportFiles(object: Tree) {
  const collections = Object.keys(object)

  type FileName = string
  const zipContent: Record<FileName, string> = {}

  collections.forEach(collection => {
    const modes = Object.keys((object as Node)[collection])

    const isSingleMode = modes.length === 1

    modes.forEach(mode => {
      const fileName = `${collection}${isSingleMode ? `` : `.${mode}`}.json`
      const content =  JSON.stringify(((object as Node)[collection] as Node)[mode], null, 2)
      zipContent[fileName] = content
    })
  });

  figma.ui.postMessage({
    type: 'download-zip',
    contents: zipContent,
    raw: JSON.stringify(object, null, 2)
  });
}

/**
 * JSONifies a Figma variables collection.
 */
async function collectionAsJSON(collectionIdToKeyMap: Record<string, string>, { modes, variableIds }: VariableCollection) {
  let collection: Record<string, Tree> = {};
  const { idToKey, keyToId } = uniqueKeyIdMaps(modes, "modeId");
  const modeKeys = Object.values(idToKey);

  modeKeys.forEach((mode: string) => {
    collection[mode] = collection[mode] || {}
  });

  for (const variableId of variableIds) {
    const { name, resolvedType, valuesByMode } = (await figma.variables.getVariableByIdAsync(variableId))!;

    for (const mode of modeKeys) {
      let obj = collection[mode];
      const value = valuesByMode[keyToId[mode]];
      
      if (value !== undefined && ["COLOR", "FLOAT"].includes(resolvedType)) {
        name.split("/").forEach((groupName) => {
          obj = obj as Node
          obj[groupName] = obj[groupName] || {};
          obj = obj[groupName];
        });

        obj.$type = resolvedType === "COLOR" ? "color" : "number";
        obj.$value = await valueToJSON(value, resolvedType, collectionIdToKeyMap);
      }
    }
  }
  return collection;
}

/**
 * Converts a single variable to JSON
 */
async function valueToJSON(value: VariableValue, resolvedType: VariableResolvedDataType, collectionIdToKeyMap: Record<string, string>) {
  const isAlias = (value: VariableValue): value is VariableAlias => !!(value as VariableAlias).type && !!(value as VariableAlias).id

  if (isAlias(value)) {
    const variable = (await figma.variables.getVariableByIdAsync(value.id))!;
    const prefix = collectionIdToKeyMap[variable.variableCollectionId];
    return `{${prefix}.${variable.name.replace(/\//g, ".")}}`;
  }
  return resolvedType === "COLOR" ? rgbToHex(value as RGBA) : value;
}

/**
 * Maps internal Figma id's to the names of variables and collections.
 */
function uniqueKeyIdMaps<T extends Pick<VariableCollection, "name">, K extends keyof T, F extends T[K] & (string | number | symbol)>(nodesWithNames: T[], idKey: K, prefix = "") {
  const idToKey: Record<F, string> = {} as Record<F, string>;
  const keyToId: Record<string, T[K]> = {};
  nodesWithNames.forEach((node) => {
    const key = sanitizeName(node.name);
    let int = 2;
    let uniqueKey = `${prefix}${key}`;
    while (keyToId[uniqueKey]) {
      uniqueKey = `${prefix}${key}_${int}`;
      int++;
    }
    keyToId[uniqueKey] = node[idKey];
    idToKey[node[idKey] as F] = uniqueKey;
  });
  return { idToKey, keyToId };
}

/**
 * Trims and turns the name into `snake_case`
 */
function sanitizeName(name: string) {
  return name
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .replace(/^ +/, "")
    .replace(/ +$/, "")
    .replace(/ +/g, "_")
    .toLowerCase();
}

/**
 * Converts an RGB(a) value to HEX.
 */
function rgbToHex({ r, g, b, a }: RGBA) {
  const toHex = (value: number) => {
    const hex = Math.round(value * 255).toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  };

  const hex = [toHex(r), toHex(g), toHex(b)];
  if (a !== 1) {
    hex.push(toHex(a));
  }
  return `#${hex.join("")}`;
}