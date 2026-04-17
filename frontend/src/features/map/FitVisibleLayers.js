import L from 'leaflet';

const DEFAULT_CENTER = [19.4326, -99.1332];
const DEFAULT_ZOOM = 11;

function collectCoordinatePairs(coordinates, pairs = []) {
  if (!Array.isArray(coordinates)) return pairs;

  if (
    coordinates.length >= 2 &&
    !Array.isArray(coordinates[0]) &&
    !Array.isArray(coordinates[1])
  ) {
    pairs.push([coordinates[0], coordinates[1]]);
    return pairs;
  }

  coordinates.forEach((entry) => collectCoordinatePairs(entry, pairs));
  return pairs;
}

function hasValidGeometryForFit(geometry) {
  if (!geometry || typeof geometry !== 'object') return false;

  if (geometry.type === 'GeometryCollection') {
    const geometries = Array.isArray(geometry.geometries) ? geometry.geometries : [];
    if (!geometries.length) return false;
    return geometries.every((entry) => hasValidGeometryForFit(entry));
  }

  const coordinatePairs = collectCoordinatePairs(geometry.coordinates, []);
  if (!coordinatePairs.length) return false;

  return coordinatePairs.every((pair) => {
    const lng = Number(pair?.[0]);
    const lat = Number(pair?.[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
    if (Math.abs(lng) <= 1e-9 && Math.abs(lat) <= 1e-9) return false;
    if (lng < -180 || lng > 180) return false;
    if (lat < -90 || lat > 90) return false;
    return true;
  });
}

export function fitVisibleLayers(map, layers) {
  if (!map || !map._loaded) return;

  const visibleLayers = layers
    .map((layer) => {
      const features = (layer?.data?.features || []).filter((feature) =>
        hasValidGeometryForFit(feature?.geometry)
      );
      return {
        ...layer,
        data: {
          ...(layer?.data || {}),
          features,
        },
      };
    })
    .filter(
      (layer) => layer.visible && layer.data?.features?.length
    );

  const layersForFit = visibleLayers.filter(
    (layer) => layer.visible && layer.data?.features?.length
  );

  if (!layersForFit.length) {
    try {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    } catch (e) {
      console.warn('[fitVisibleLayers] setView error', e);
    }
    return;
  }

  try {
    const featureGroup = L.featureGroup(
      layersForFit.map((layer) => L.geoJSON(layer.data))
    );
    const bounds = featureGroup.getBounds();

    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.18), { maxZoom: 13 });
    }
  } catch (e) {
    console.warn('[fitVisibleLayers] fitBounds error', e);
  }
}
