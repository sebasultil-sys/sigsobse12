import L from 'leaflet';

const DEFAULT_CENTER = [19.4326, -99.1332];
const DEFAULT_ZOOM = 11;

export function fitVisibleLayers(map, layers) {
  if (!map || !map._loaded) return;

  const visibleLayers = layers.filter(
    (layer) => layer.visible && layer.data?.features?.length
  );

  if (!visibleLayers.length) {
    try {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    } catch (e) {
      console.warn('[fitVisibleLayers] setView error', e);
    }
    return;
  }

  try {
    const featureGroup = L.featureGroup(
      visibleLayers.map((layer) => L.geoJSON(layer.data))
    );
    const bounds = featureGroup.getBounds();

    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.18), { maxZoom: 13 });
    }
  } catch (e) {
    console.warn('[fitVisibleLayers] fitBounds error', e);
  }
}
