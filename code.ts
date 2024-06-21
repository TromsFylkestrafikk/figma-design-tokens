/**
 *
 * Main export code based on code by `jake-figma`
 * https://github.com/jake-figma/figma-token-json
 *
 */
console.clear();
console.log('------------------- Console cleared by Design Tokens (W3C) Export -------------------');

figma.showUI(__html__);

const KEY_PREFIX_COLLECTION = '';

type DesignTokenType = 'color' | 'number'
type DesignToken = {
  type: DesignTokenType
  value: string | number | boolean | RGB | CompositeToken
  }
interface CompositeToken { [key: string]: DesignToken['value'] }
type Token = DesignToken | CompositeToken

type Tree = Token | { [key: string]: Tree };
type Node = Exclude<Tree, Token>

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
 * @param collection Name of the collection
 * @returns True if private
 */
function isPrivate(collection: string) {
  return collection.startsWith('_');
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
 * @param name Name of the current variable
 * @param value Value of the current variable
 * @param type Type of current variable
 * @returns Value of the variable in Design Token (W3C) standard
 */
async function valueToJSON(
  name: string,
  value: VariableValue,
  type: VariableResolvedDataType,
): Promise<DesignToken['value']> {
  const isAlias = (
    v: VariableValue,
  ): v is VariableAlias => !!(v as VariableAlias).type && !!(v as VariableAlias).id;

  const isForeground = (
    { name: _name }: Variable,
  ): boolean => !!_name.match(/^Foreground\/(Dark|Light)\/(Primary|Secondary|Disabled)$/);

  const isColorPalette = (
    { name: _name }: Variable,
  ): boolean => !!_name.match(/^[A-Za-z]+\/\d+\/Background$/);

  let _value: DesignToken['value'];

  // If the variable is a reference to another variable
  if (isAlias(value)) {
    // Get the referenced variable
    const variable = (await figma.variables.getVariableByIdAsync(value.id))!;
    const alias = `{${variable.name.replace(/\//g, '.')}}`;

    _value = alias;

    // Expand the referenced variable if it is a foreground variable
    if (isForeground(variable)) {
      _value = {
        Primary: alias,
        Secondary: alias.replace('Primary', 'Secondary'),
        Disabled: alias.replace('Primary', 'Disabled'),
      };
    }

    // Expand the referenced variable if it is a reference to the color palette
    // If the current variable is a foreground color, do not expand it to avoid circular references
    if (isColorPalette(variable) && !isForeground({ name } as Variable)) {
      _value = {
        Background: alias,
        Foreground: alias.replace('Background', 'Foreground'),
      };
    }
  } else {
    // Return an actual value if the variable is not a reference
    _value = type === 'COLOR' ? rgbToHex(value as RGBA) : value as string;
  }

  return _value;
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

        obj.value = await valueToJSON(name, value, resolvedType);
        obj.type = (resolvedType === 'COLOR' ? 'color' : 'number') as DesignTokenType;
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
