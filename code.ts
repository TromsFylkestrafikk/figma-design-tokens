/**
 *
 * Main export code based on code by `jake-figma`
 * https://github.com/jake-figma/figma-token-json
 *
 */
console.clear();
console.log('------------------- Console cleared by Export Design Tokens (W3C) -------------------');

figma.showUI(__html__);

const KEY_PREFIX_COLLECTION = '';

type DesignTokenType = 'color' | 'number'
interface CompositeToken { [key: string]: DesignToken["value"] }
type DesignToken = {
  type: DesignTokenType
  value: string | number | boolean | RGB | CompositeToken
}

type Tree = DesignToken | { [key: string]: Tree };
type Node = Exclude<Tree, DesignToken>

/**
 * Converts an RGB(a) value to HEX
 *
 * @param color Color in RGB(a) format
 * @returns Color in HEX format
 */
function rgbToHex({
  r, g, b, a,
}: RGBA) {
  const toHex = (value: number) => {
    const hex = Math.round(value * 255).toString(16);
    return hex.length === 1 ? `0${hex}` : hex;
  };

  const hex = [toHex(r), toHex(g), toHex(b)];
  if (a !== 1) {
    hex.push(toHex(a));
  }
  return `#${hex.join('')}`;
}

/**
 * Cleans the name of a variable according to Design Token (W3C) standard
 *
 * @param name Name of a variable
 * @returns Name trimmed and snake_case
 */
function sanitizeName(name: string) {
  return name
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .replace(/^ +/, '')
    .replace(/ +$/, '')
    .replace(/ +/g, '_')
    .toLowerCase();
}

/**
 * Checks if the name of a collection, group or variable is private.
 *
 * @param group Name of group
 * @returns True if private
 */
function isPrivate(group: string) {
  return group.startsWith('_');
}

/**
 * Map Figma ids to names of variables and collections
 *
 * @param nodesWithNames Collection of variables
 * @param idKey The key of the id in the `nodesWithNames` parameter
 * @param prefix If names should be prefixed
 * @returns Functions that map from id to name and back
 */
function uniqueKeyIdMaps<T extends Pick<VariableCollection, 'name'>, K extends keyof T, F extends T[K] &(string | number | symbol)>(nodesWithNames: T[], idKey: K, prefix = '') {
  const idToKey: Record<F, string> = {} as Record<F, string>;
  const keyToId: Record<string, T[K]> = {};
  nodesWithNames.forEach((node) => {
    const key = sanitizeName(node.name);
    let int = 2;
    let uniqueKey = `${prefix}${key}`;
    while (keyToId[uniqueKey]) {
      uniqueKey = `${prefix}${key}_${int}`;
      int += 1;
    }
    keyToId[uniqueKey] = node[idKey];
    idToKey[node[idKey] as F] = uniqueKey;
  });
  return { idToKey, keyToId };
}

/**
 * Convert single variable to Design Token (W3C) standard
 *
 * @param value Value of the current variable
 * @param resolvedType Type of current variable
 * @returns Value of the variable in Design Token (W3C) standard
 */
async function valueToJSON(
  value: VariableValue,
  resolvedType: VariableResolvedDataType,
) {
  const isAlias = (
    v: VariableValue,
  ): v is VariableAlias => !!(v as VariableAlias).type && !!(v as VariableAlias).id;

  const isForeground = (
    { name }: Variable
  ): Boolean => !!name.match(/^Foreground\/(Dark|Light)\/Primary$/)

  const isColorPalette = (
    { name }: Variable
  ): Boolean => !!name.match(/^[A-Za-z]+\/\d+\/Background$/)

  if (isAlias(value)) {
    const variable = (await figma.variables.getVariableByIdAsync(value.id))!;
    const alias = `{${variable.name.replace(/\//g, '.')}}`

    // Create composite token for foreground colors
    if (isForeground(variable)) {
      return {
        Primary: alias,
        Secondary: alias.replace('Primary', 'Secondary'),
        Disabled: alias.replace('Primary', 'Disabled')
      } as CompositeToken
    }

    // Create composite token for color palette
    if (isColorPalette(variable)) {
      const alias = `{${variable.name.replace(/\//g, '.')}}`

      return {
        Background: alias,
        Foreground: alias.replace('Background', 'Foreground')
      } as CompositeToken
    }

    return alias;
  }

  return resolvedType === 'COLOR' ? rgbToHex(value as RGBA) : value;
}

/**
 * Converts collection to Design Token (W3C) standard
 *
 * @param collection The variable collection to export
 * @returns The collection in the Design Token (W3C) format
 */
async function collectionAsJSON(
  { modes, variableIds }: VariableCollection,
) {
  const collection: Record<string, Tree> = {};
  const { idToKey, keyToId } = uniqueKeyIdMaps(modes, 'modeId');
  const modeKeys = Object.values(idToKey);

  modeKeys.forEach((mode: string) => {
    collection[mode] = collection[mode] || {};
  });

  variables: for (const variableId of variableIds) {
    const {
      name,
      resolvedType,
      valuesByMode,
    } = (await figma.variables.getVariableByIdAsync(variableId))!;

    for (const mode of modeKeys) {
      let obj = collection[mode];
      const value = valuesByMode[keyToId[mode]];

      if (value !== undefined && ['COLOR', 'FLOAT'].includes(resolvedType)) {
        const groups = name.split('/');
        if (groups.some((group) => isPrivate(group))) continue variables;

        groups.forEach((groupName) => {
          obj = obj as Node;
          obj[groupName] = obj[groupName] || {};
          obj = obj[groupName];
        });

        obj.type = resolvedType === 'COLOR' ? 'color' : 'number';
        obj.value = await valueToJSON(value, resolvedType);
      }
    }
  }
  return collection;
}

/**
 * Exports generated files to .zip
 *
 * Takes a tree of design tokens, split is up by collection and mode
 * and generates a file structure that is send to a .zip file.
 *
 * The generated structure is as follows, which is send to the front-end for download.
 *
 * ```
 * {
 *   [collection].[mode].json: json_content,
 *   ...
 * }
 * ```
 *
 * @param tree A design token tree
 */
function exportFiles(tree: Tree) {
  const collections = Object.keys(tree);

  type FileName = string
  const zipContent: Record<FileName, string> = {};

  collections.forEach((collection) => {
    const modes = Object.keys((tree as Node)[collection]);

    const isSingleMode = modes.length === 1;

    modes.forEach((mode) => {
      const fileName = `${collection}${isSingleMode ? '' : `.${mode}`}.json`;
      const content = JSON.stringify(((tree as Node)[collection] as Node)[mode], null, 2);
      zipContent[fileName] = content;
    });
  });

  figma.ui.postMessage({
    type: 'download-zip',
    contents: zipContent,
    raw: JSON.stringify(tree, null, 2),
  });
}

/**
 * Exports all collections to a .zip file and triggers a download.
 */
async function exportToJSON() {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const tree: Tree = {};
  const { idToKey } = uniqueKeyIdMaps(collections, 'id', KEY_PREFIX_COLLECTION);

  for (const collection of collections) {
    const name = idToKey[collection.id];

    // Skip this collection if private
    if (isPrivate(name)) continue;

    tree[name] = await collectionAsJSON(collection);
  }

  exportFiles(tree);
}

exportToJSON();
