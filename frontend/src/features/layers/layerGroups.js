const BASE_LAYER_GROUP_KEY = 'Sin DG';
const BASE_LAYER_GROUP_LABEL = 'Cartografía base';

function getLayerGroupKey(value) {
  const raw = String(value || '').trim();
  return raw || BASE_LAYER_GROUP_KEY;
}

function getLayerGroupLabel(value) {
  const groupKey = getLayerGroupKey(value);
  return groupKey === BASE_LAYER_GROUP_KEY
    ? BASE_LAYER_GROUP_LABEL
    : groupKey;
}

function compareLayerGroupNames(left, right) {
  const leftKey = getLayerGroupKey(left);
  const rightKey = getLayerGroupKey(right);
  const leftIsBase = leftKey === BASE_LAYER_GROUP_KEY;
  const rightIsBase = rightKey === BASE_LAYER_GROUP_KEY;

  if (leftIsBase !== rightIsBase) {
    return leftIsBase ? 1 : -1;
  }

  return getLayerGroupLabel(leftKey).localeCompare(
    getLayerGroupLabel(rightKey),
    'es'
  );
}

function orderLayerGroupEntries(entries) {
  return [...entries].sort(([left], [right]) =>
    compareLayerGroupNames(left, right)
  );
}

function getOrderedLayerGroups(layers) {
  const groups = new Map();

  layers.forEach((layer) => {
    const groupKey = getLayerGroupKey(layer.dg);
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(layer);
  });

  return orderLayerGroupEntries(Array.from(groups.entries()));
}

export {
  BASE_LAYER_GROUP_KEY,
  BASE_LAYER_GROUP_LABEL,
  compareLayerGroupNames,
  getLayerGroupKey,
  getLayerGroupLabel,
  getOrderedLayerGroups,
  orderLayerGroupEntries,
};
