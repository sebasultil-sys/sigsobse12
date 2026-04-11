import React from 'react';
import L from 'leaflet';
import { createGeoJsonLayer } from './GeoJsonLayer';
import { fitVisibleLayers } from './FitVisibleLayers';

const DEFAULT_CENTER = [19.4326, -99.1332];
const DEFAULT_ZOOM = 11;

function buildVisibleSignature(layers) {
  return layers
    .filter((layer) => layer.visible)
    .map(
      (layer) =>
        `${layer.id}:${layer.data?.features?.length || 0}:${layer.visible}`
    )
    .join('|');
}

function MapViewport({
  layers,
  layerCount,
  visibleLayerCount,
  activeBaseMap,
  baseMaps,
  onChangeBaseMap,
  selectedLayerId,
  onSelectLayer,
}) {
  const mapNodeRef = React.useRef(null);
  const mapRef = React.useRef(null);
  const baseLayerRef = React.useRef(null);
  const overlayGroupRef = React.useRef(null);
  const layersRef = React.useRef(layers);

  const selectedLayer =
    layers.find((layer) => layer.id === selectedLayerId) || null;
  const visibleLayerNames = layers
    .filter((layer) => layer.visible)
    .map((layer) => layer.name);
  const visibleSignature = React.useMemo(
    () => buildVisibleSignature(layers),
    [layers]
  );

  React.useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

  React.useEffect(() => {
    if (!mapNodeRef.current || mapRef.current) return undefined;

    const map = L.map(mapNodeRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: false,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);
    const overlayGroup = L.layerGroup().addTo(map);
    const handleResize = () => map.invalidateSize();

    mapRef.current = map;
    overlayGroupRef.current = overlayGroup;

    window.addEventListener('resize', handleResize);
    requestAnimationFrame(handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      overlayGroup.clearLayers();
      map.remove();
      mapRef.current = null;
      baseLayerRef.current = null;
      overlayGroupRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (baseLayerRef.current) {
      baseLayerRef.current.remove();
    }

    baseLayerRef.current = L.tileLayer(activeBaseMap.url, {
      attribution: activeBaseMap.attribution,
    }).addTo(map);
  }, [activeBaseMap.attribution, activeBaseMap.url]);

  React.useEffect(() => {
    const overlayGroup = overlayGroupRef.current;
    if (!overlayGroup) return;

    overlayGroup.clearLayers();

    layers
      .filter((layer) => layer.visible && layer.data?.features?.length)
      .forEach((layer) => {
        const geoJsonLayer = createGeoJsonLayer({
          layer,
          isSelected: layer.id === selectedLayerId,
          onSelectLayer,
        });

        geoJsonLayer.addTo(overlayGroup);
      });
  }, [layers, onSelectLayer, selectedLayerId]);

  React.useEffect(() => {
    fitVisibleLayers(mapRef.current, layersRef.current);
  }, [visibleSignature]);

  return (
    <section className="panel-card map-stage">
      <div className="panel-card__header">
        <div>
          <h2 className="panel-card__title">Mapa</h2>
          <div className="panel-card__meta">
            Preparado para conectar el visualizador nuevo.
          </div>
        </div>
      </div>

      <div className="map-stage__body">
        <div className="map-stage__canvas">
          <div className="map-stage__overlay">
            <span className="map-stage__eyebrow">Mapa conectado</span>
            <h3 className="map-stage__title">Visor Leaflet ya integrado</h3>
            <p className="map-stage__text">
              Esta base ya no es una maqueta. El mapa está conectado con una
              primera selección de capas reales y curadas del proyecto.
            </p>
          </div>

          <div className="map-stage__leaflet-shell">
            <div className="sig-map" ref={mapNodeRef} />

            {visibleLayerCount === 0 ? (
              <div className="map-stage__empty">
                <strong>No hay capas visibles.</strong>
                <span>Activa alguna capa del panel izquierdo.</span>
              </div>
            ) : null}
          </div>
        </div>

        <aside className="map-stage__notes">
          <h3>Vista actual</h3>
          <p>
            El mapa ya consume capas locales curadas, con estilos por geometría
            y popups básicos de propiedades.
          </p>

          <label className="map-stage__field">
            <span>Mapa base</span>
            <select
              className="map-stage__select"
              onChange={(event) => onChangeBaseMap(event.target.value)}
              value={activeBaseMap.id}
            >
              {baseMaps.map((baseMap) => (
                <option key={baseMap.id} value={baseMap.id}>
                  {baseMap.name}
                </option>
              ))}
            </select>
          </label>

          <div className="map-stage__footer">
            <div className="map-stage__metric">
              <span className="map-stage__metric-label">Capas registradas</span>
              <span className="map-stage__metric-value">{layerCount}</span>
            </div>
            <div className="map-stage__metric">
              <span className="map-stage__metric-label">Capas visibles</span>
              <span className="map-stage__metric-value">
                {visibleLayerCount}
              </span>
            </div>
            <div className="map-stage__metric">
              <span className="map-stage__metric-label">Mapa base</span>
              <span className="map-stage__metric-value">
                {activeBaseMap.name}
              </span>
            </div>
          </div>

          <div className="map-stage__detail-card">
            <span className="mini-card__label">Capa seleccionada</span>
            <strong className="map-stage__detail-title">
              {selectedLayer ? selectedLayer.name : 'Sin selección'}
            </strong>
            <p className="map-stage__detail-text">
              {selectedLayer
                ? `${selectedLayer.source} · ${selectedLayer.geometryType} · ${
                    selectedLayer.data?.features?.length || 0
                  } elementos`
                : 'Haz clic en una capa o en una geometría para inspeccionarla.'}
            </p>
          </div>

          <div className="map-stage__chip-list">
            {visibleLayerNames.map((layerName) => (
              <span className="map-stage__chip" key={layerName}>
                {layerName}
              </span>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}

export default MapViewport;
