import React from 'react';
import L from 'leaflet';
import { useGISWorkspace } from '../../app/GISWorkspaceContext';
import {
  buildHotspotBins,
  getHotspotColor,
  getNearestFeatures,
  PopulationEngine,
  resolveLayerForHotspot,
  resolveLayerForProximity,
} from './advancedTools';
import { createGeoJsonLayer, getVisualState } from './GeoJsonLayer';
import { fitVisibleLayers } from './FitVisibleLayers';

const DEFAULT_CENTER = [19.4326, -99.1332];
const DEFAULT_ZOOM = 11;
const METERS_PER_KILOMETER = 1000;
const EARTH_RADIUS = 6378137;
const POPULATION_DATA_URL = `${
  process.env.PUBLIC_URL || ''
}/data/inegi_poblacion_cdmx.geojson`;
const TOOL_ICON_BASE = `${process.env.PUBLIC_URL || ''}/icons/map-tools`;
const EMPTY_DRAW_DRAFT = {
  type: null,
  points: [],
};
const ADVANCED_CLICK_TOOLS = new Set(['analysis']);

function formatDistance(meters) {
  if (meters >= METERS_PER_KILOMETER) {
    return `${(meters / METERS_PER_KILOMETER).toFixed(2)} km`;
  }

  return `${meters.toFixed(0)} m`;
}

function formatArea(squareMeters) {
  if (squareMeters >= 1000000) {
    return `${(squareMeters / 1000000).toFixed(2)} km²`;
  }

  if (squareMeters >= 10000) {
    return `${(squareMeters / 10000).toFixed(2)} ha`;
  }

  return `${squareMeters.toFixed(0)} m²`;
}

function computeDistance(points) {
  if (points.length < 2) return 0;

  return points.slice(1).reduce((total, point, index) => {
    const previous = points[index];
    return total + previous.distanceTo(point);
  }, 0);
}

function computeGeodesicArea(points) {
  if (points.length < 3) return 0;

  let area = 0;

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area +=
      ((next.lng - current.lng) * Math.PI) /
      180 *
      (2 +
        Math.sin((current.lat * Math.PI) / 180) +
        Math.sin((next.lat * Math.PI) / 180));
  }

  return Math.abs((area * EARTH_RADIUS * EARTH_RADIUS) / 2);
}

function buildMeasurementSummary(type, points) {
  if (type === 'measure-distance') {
    return points.length >= 2 ? formatDistance(computeDistance(points)) : null;
  }

  if (type === 'measure-area') {
    return points.length >= 3 ? formatArea(computeGeodesicArea(points)) : null;
  }

  return null;
}

function buildDrawSummary(type, points) {
  if (type === 'draw-line') {
    return points.length >= 2 ? formatDistance(computeDistance(points)) : null;
  }

  if (type === 'draw-polygon') {
    return points.length >= 3 ? formatArea(computeGeodesicArea(points)) : null;
  }

  return type === 'draw-point' ? 'Punto' : null;
}

function refreshMapLayout(map) {
  if (!map) return;

  try {
    map.invalidateSize({ pan: false });
  } catch (e) {
    console.warn('[MapView] invalidateSize error', e);
  }
}

function safeInvalidate(mapRef, delay = 250) {
  setTimeout(() => {
    if (!mapRef.current) return;
    if (!mapRef.current._loaded) return;

    try {
      mapRef.current.invalidateSize({ pan: false });
      requestAnimationFrame(() => {
        if (!mapRef.current || !mapRef.current._loaded) return;
        try {
          mapRef.current.invalidateSize({ pan: false });
        } catch (e) {
          console.warn('[MapView] rAF invalidateSize error', e);
        }
      });
    } catch (e) {
      console.warn('[MapView] invalidateSize error', e);
    }
  }, delay);
}

function buildVisibleSignature(layers) {
  return layers
    .filter((layer) => layer.visible)
    .map(
      (layer) =>
        `${layer.id}:${layer.data?.features?.length || 0}:${layer.visible}:${
          layer.style?.color || layer.color
        }:${layer.style?.opacity || 0}`
    )
    .join('|');
}

function buildDrawItem(type, points) {
  return {
    id: `${type}-${Date.now()}-${Math.round(Math.random() * 1000)}`,
    type,
    points,
    summary: buildDrawSummary(type, points),
  };
}

function isMeasureMode(mode) {
  return mode === 'measure-distance' || mode === 'measure-area';
}

function isDrawMode(mode) {
  return (
    mode === 'draw-point' ||
    mode === 'draw-line' ||
    mode === 'draw-polygon'
  );
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPopulationValue(value) {
  return Number(value || 0).toLocaleString('es-MX');
}

function buildBufferPopup(radiusKm) {
  return `
    <div class="map-popup map-popup--analysis">
      <div class="map-popup__eyebrow">Buffer</div>
      <strong>Área de influencia</strong>
      <table>
        <tr><th>Radio</th><td>${escapeHtml(radiusKm)} km</td></tr>
      </table>
    </div>
  `;
}

function buildPopulationPopup(result, errorMessage) {
  if (errorMessage) {
    return `
      <div class="map-popup map-popup--analysis">
        <div class="map-popup__eyebrow">Población</div>
        <strong>Consulta no disponible</strong>
        <p>${escapeHtml(errorMessage)}</p>
      </div>
    `;
  }

  return `
    <div class="map-popup map-popup--analysis">
      <div class="map-popup__eyebrow">Análisis poblacional</div>
      <strong>Radio ${escapeHtml(result.radiusKm)} km</strong>
      <table>
        <tr><th>Manzanas</th><td>${formatPopulationValue(
          result.featureCount
        )}</td></tr>
        <tr><th>Población total</th><td>${formatPopulationValue(
          result.POBTOT
        )}</td></tr>
        <tr><th>Mujeres</th><td>${formatPopulationValue(result.POBFEM)}</td></tr>
        <tr><th>Hombres</th><td>${formatPopulationValue(result.POBMAS)}</td></tr>
        <tr><th>0-14 años</th><td>${formatPopulationValue(
          result.POB0_14
        )}</td></tr>
        <tr><th>65+ años</th><td>${formatPopulationValue(
          result.POB65_MAS
        )}</td></tr>
      </table>
    </div>
  `;
}

function buildProximityPopup(layerName, results) {
  if (!results.length) {
    return `
      <div class="map-popup map-popup--analysis">
        <div class="map-popup__eyebrow">Proximidad</div>
        <strong>${escapeHtml(layerName)}</strong>
        <p>No se encontraron elementos cercanos o no hay una capa activa visible.</p>
      </div>
    `;
  }

  const rows = results
    .map(
      (item) => `
        <tr>
          <th>${escapeHtml(item.label)}</th>
          <td>${escapeHtml(formatDistance(item.distanceMeters))}</td>
        </tr>
      `
    )
    .join('');

  return `
    <div class="map-popup map-popup--analysis">
      <div class="map-popup__eyebrow">Proximidad</div>
      <strong>${escapeHtml(layerName)}</strong>
      <table>${rows}</table>
    </div>
  `;
}

function AdvancedToolButton({ active, label, onClick, title }) {
  return (
    <button
      aria-label={title}
      className={`map-view__tool-button${active ? ' is-active' : ''}`}
      onClick={onClick}
      title={title}
      type="button"
    >
      <span>{label}</span>
    </button>
  );
}

function BasemapIcon() {
  return (
    <svg
      aria-hidden="true"
      className="map-view__tool-svg"
      fill="none"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M3 6.5 8.5 4l7 2.5L21 4v13.5L15.5 20l-7-2.5L3 20V6.5Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M8.5 4v13.5M15.5 6.5V20"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function ToolIcon({ alt, src }) {
  return <img alt={alt} className="map-view__tool-img" src={src} />;
}

function geomSymbol(geometryType) {
  if (geometryType === 'Point' || geometryType === 'MultiPoint') return '●';
  if (geometryType === 'LineString' || geometryType === 'MultiLineString') return '—';
  return '▭';
}

function LayerToggle({ checked, label, onClick }) {
  return (
    <button
      aria-label={label}
      aria-pressed={checked}
      className={`lp-toggle${checked ? ' is-on' : ''}`}
      onClick={onClick}
      type="button"
    >
      <span className="lp-toggle__box" aria-hidden="true">
        {checked ? (
          <svg
            fill="none"
            height="12"
            viewBox="0 0 12 12"
            width="12"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M2 6.2 4.55 8.75 10 3.25"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
            />
          </svg>
        ) : null}
      </span>
      <span className="lp-toggle__label">{checked ? 'ON' : 'OFF'}</span>
    </button>
  );
}

function AdvancedToolChip({ active, children, onClick }) {
  return (
    <button
      className={`map-view__tool-chip${active ? ' is-active' : ''}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function getBasemapDisplayName(baseMap) {
  if (baseMap.id === 'topographic') return 'Topográfico';
  if (baseMap.id === 'satellite') return 'Satelital';
  if (baseMap.id === 'dark') return 'Dark';
  if (baseMap.id === 'cartographic') return 'OSM';
  return baseMap.name;
}

function MapView({ mode = 'desktop' }) {
  const {
    actions,
    activeBaseMap,
    baseMaps,
    clearSignal,
    drawDraft,
    drawItems,
    filteredFeatureCount,
    filteredLayers,
    focusedLayerId,
    hoveredLayerId,
    isCompactViewport,
    interactionMode,
    layerMetricsById,
    layers,
    measurement,
    mobileSheet,
    selectedFeature,
    selectedLayer,
    selectedLayerId,
    visibleLayerCount,
  } = useGISWorkspace();
  const mapNodeRef = React.useRef(null);
  const mapRef = React.useRef(null);
  const baseLayerRef = React.useRef(null);
  const overlayGroupRef = React.useRef(null);
  const measurementGroupRef = React.useRef(null);
  const drawingGroupRef = React.useRef(null);
  const advancedGroupRef = React.useRef(null);
  const hotspotGroupRef = React.useRef(null);
  const populationEngineRef = React.useRef(
    new PopulationEngine(POPULATION_DATA_URL)
  );
  const filteredLayersRef = React.useRef(filteredLayers);
  const allLayersRef = React.useRef(layers);
  const actionsRef = React.useRef(actions);

  // Tracks all active GeoJSON overlay layers (layerId → { geoJsonLayer, layer })
  const overlayLayersRef = React.useRef(new Map());

  // Always-current volatile state read by GeoJsonLayer style functions.
  // Initialized with nulls — updated synchronously on every render below,
  // after activeFocusLayerId is declared, so Leaflet callbacks always see
  // the latest values without causing extra re-renders.
  const layerStateRef = React.useRef({
    focusedLayerId: null,
    hoveredLayerId: null,
    selectedFeatureKey: null,
  });

  const [mapReadyVersion, setMapReadyVersion] = React.useState(0);
  React.useEffect(() => {
    if (!mapRef.current) return;

    // Forzar recalculo varias veces (clave para evitar glitch)
    const timers = [100, 300, 600].map((delay) =>
      setTimeout(() => {
        safeInvalidate(mapRef, 0);
      }, delay)
    );

    return () => timers.forEach(clearTimeout);
  }, [mapReadyVersion]);


  const [mapMeta, setMapMeta] = React.useState({
    zoom: DEFAULT_ZOOM,
    center: { lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1] },
  });
  const [isFullscreenActive, setIsFullscreenActive] = React.useState(false);
  const [activeTool, setActiveTool] = React.useState(null);
  const [drawToolMode, setDrawToolMode] = React.useState('draw-point');
  const [measureToolMode, setMeasureToolMode] = React.useState(
    'measure-distance'
  );
  const [analysisMode, setAnalysisMode] = React.useState('population');
  const [bufferRadiusKm, setBufferRadiusKm] = React.useState(1);
  const [populationRadiusKm, setPopulationRadiusKm] = React.useState(1);
  const [expandedDGs, setExpandedDGs] = React.useState({});
  React.useEffect(() => {
    if (!mapRef.current) return;

    const handleFullscreenFix = () => {
      safeInvalidate(mapRef, 300);
    };

    document.addEventListener('fullscreenchange', handleFullscreenFix);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenFix);
    };
  }, []);


  const isMobile = mode === 'mobile';
  const visibleSignature = React.useMemo(
    () => buildVisibleSignature(filteredLayers),
    [filteredLayers]
  );
  const activeFocusLayerId = selectedFeature?.layerId || focusedLayerId || null;
  const isFocusMode = Boolean(activeFocusLayerId || hoveredLayerId);

  // Keep layerStateRef in sync with current render values.
  // Placed after activeFocusLayerId is declared so it reads the correct value.
  // Runs on every render before any effect, so Leaflet callbacks always see
  // fresh state without triggering extra re-renders.
  layerStateRef.current = {
    focusedLayerId: activeFocusLayerId,
    hoveredLayerId,
    selectedFeatureKey: selectedFeature?.properties?.__featureKey || null,
  };
  const showAdvancedTools =
    !isMobile && isFullscreenActive && mapReadyVersion > 0;
  const proximityLayer = React.useMemo(
    () => resolveLayerForProximity(filteredLayers, selectedLayerId),
    [filteredLayers, selectedLayerId]
  );
  const hotspotLayer = React.useMemo(
    () => resolveLayerForHotspot(filteredLayers, selectedLayerId),
    [filteredLayers, selectedLayerId]
  );
  const orderedBaseMaps = React.useMemo(() => {
    const priority = {
      topographic: 0,
      satellite: 1,
      dark: 2,
      cartographic: 3,
    };

    return [...baseMaps].sort((left, right) => {
      const leftPriority = priority[left.id] ?? 99;
      const rightPriority = priority[right.id] ?? 99;
      return leftPriority - rightPriority;
    });
  }, [baseMaps]);
  const layersByDG = React.useMemo(() => {
    const groups = new Map();

    layers.forEach((layer) => {
      const dg = layer.dg || 'Sin DG';
      if (!groups.has(dg)) groups.set(dg, []);
      groups.get(dg).push(layer);
    });

    return Array.from(groups.entries()).sort(([left], [right]) =>
      left.localeCompare(right, 'es')
    );
  }, [layers]);

  React.useEffect(() => {
    actionsRef.current = actions;
  }, [actions]);

  React.useEffect(() => {
    filteredLayersRef.current = filteredLayers;
  }, [filteredLayers]);

  React.useEffect(() => {
    allLayersRef.current = layers;
  }, [layers]);

  const clearAdvancedOverlays = React.useCallback(() => {
    advancedGroupRef.current?.clearLayers();
    hotspotGroupRef.current?.clearLayers();
    mapRef.current?.closePopup();
  }, []);

  const handleAdvancedToolToggle = React.useCallback(
    (toolId) => {
      const nextTool = activeTool === toolId ? null : toolId;

      clearAdvancedOverlays();
      setActiveTool(nextTool);

      if (nextTool === 'layers') {
        setExpandedDGs({});
      }

      if (nextTool === 'draw') {
        actions.setInteractionMode(drawToolMode);
        return;
      }

      if (nextTool === 'measure') {
        actions.setInteractionMode(measureToolMode);
        return;
      }

      actions.setInteractionMode('select');
    },
    [
      actions,
      activeTool,
      clearAdvancedOverlays,
      drawToolMode,
      measureToolMode,
    ]
  );

  React.useEffect(() => {
    if (activeTool !== 'draw') return;
    actions.setInteractionMode(drawToolMode);
  }, [actions, activeTool, drawToolMode]);

  React.useEffect(() => {
    if (activeTool !== 'measure') return;
    actions.setInteractionMode(measureToolMode);
  }, [actions, activeTool, measureToolMode]);

  React.useEffect(() => {
    if (activeTool !== 'analysis') return;
    actions.setInteractionMode('select');
  }, [actions, activeTool, analysisMode]);

  React.useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const syncFullscreenState = () => {
      const mapContainer = mapRef.current?.getContainer()?.closest('.map-view');
      const fullscreenElement = document.fullscreenElement;
      const nextIsFullscreen = Boolean(
        fullscreenElement &&
          mapContainer &&
          (fullscreenElement === mapContainer ||
            fullscreenElement.contains(mapContainer))
      );

      setIsFullscreenActive(nextIsFullscreen);
      if (nextIsFullscreen) {
        safeInvalidate(mapRef, 250);
      }


      if (!nextIsFullscreen) {
        clearAdvancedOverlays();
        setActiveTool(null);
        actions.setInteractionMode('select');
      }
    };

    syncFullscreenState();
    document.addEventListener('fullscreenchange', syncFullscreenState);

    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState);
    };
  }, [actions, clearAdvancedOverlays]);

  React.useEffect(() => {
    if (mapRef.current) return undefined;

    let isCancelled = false;
    let retryTimerId = 0;
    let resizeDebounceId = 0;
    let handleWindowResize = null;
    const refreshTimerIds = [];
    let overlayLayersStore = overlayLayersRef.current;
    let overlayGroupInstance = null;
    let measurementGroupInstance = null;
    let drawingGroupInstance = null;
    let advancedGroupInstance = null;
    let hotspotGroupInstance = null;
    let mapInstance = null;

    const clearRefreshTimers = () => {
      refreshTimerIds.forEach((timerId) => window.clearTimeout(timerId));
      refreshTimerIds.length = 0;
    };

    const scheduleRefresh = () => {
      clearRefreshTimers();
      [0, 220].forEach((delay) => {
        const timerId = window.setTimeout(() => {
          if (isCancelled || !mapRef.current) return;
          if (!mapRef.current._loaded) return;
          refreshMapLayout(mapRef.current);
        }, delay);
        refreshTimerIds.push(timerId);
      });
    };

    const initializeMap = () => {
      if (isCancelled || !mapNodeRef.current || mapRef.current) return;

      const rect = mapNodeRef.current.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        retryTimerId = window.setTimeout(initializeMap, 120);
        return;
      }

      const container = mapNodeRef.current;
      if (container._leaflet_id) {
        delete container._leaflet_id;
      }

      let map;
      try {
        map = L.map(container, {
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          zoomControl: false,
          doubleClickZoom: true,
        });
      } catch (error) {
        console.error('[MapView] map init failed', error);
        retryTimerId = window.setTimeout(initializeMap, 300);
        return;
      }

      const overlayGroup = L.layerGroup().addTo(map);
      const measurementGroup = L.layerGroup().addTo(map);
      const drawingGroup = L.layerGroup().addTo(map);
      const advancedGroup = L.layerGroup().addTo(map);
      const hotspotGroup = L.layerGroup().addTo(map);
      overlayGroupInstance = overlayGroup;
      measurementGroupInstance = measurementGroup;
      drawingGroupInstance = drawingGroup;
      advancedGroupInstance = advancedGroup;
      hotspotGroupInstance = hotspotGroup;
      mapInstance = map;
      if (mode !== 'mobile') {
        L.control.zoom({ position: 'bottomleft' }).addTo(map);
      }
      map.whenReady(() => {
        scheduleRefresh();
      });

      const syncMapMeta = () => {
        const center = map.getCenter();
        setMapMeta({
          zoom: map.getZoom(),
          center: { lat: center.lat, lng: center.lng },
        });
      };

      syncMapMeta();
      map.on('moveend zoomend', syncMapMeta);

      mapRef.current = map;
      overlayGroupRef.current = overlayGroup;
      measurementGroupRef.current = measurementGroup;
      drawingGroupRef.current = drawingGroup;
      advancedGroupRef.current = advancedGroup;
      hotspotGroupRef.current = hotspotGroup;
      setMapReadyVersion((value) => value + 1);

      handleWindowResize = () => {
        window.clearTimeout(resizeDebounceId);
        resizeDebounceId = window.setTimeout(() => {
          if (!mapRef.current) return;
          scheduleRefresh();
        }, 90);
      };

      window.addEventListener('resize', handleWindowResize);

      actionsRef.current.setMapApi({
        zoomIn: () => map.zoomIn(),
        zoomOut: () => map.zoomOut(),
        resetView: () => {
          if (!map._loaded) return;
          const hasFeatures = filteredLayersRef.current.some(
            (l) => l.visible && l.data?.features?.length > 0
          );
          try {
            if (hasFeatures) {
              fitVisibleLayers(map, filteredLayersRef.current);
            }
          } catch (e) {
            console.warn('[MapView] resetView fitBounds error', e);
          }
        },
        zoomToLayer: (layerId) => {
          const layer = allLayersRef.current.find((item) => item.id === layerId);
          if (!layer?.data?.features?.length) return;

          const bounds = L.geoJSON(layer.data).getBounds();
          if (bounds.isValid()) {
            map.fitBounds(bounds.pad(0.18), { maxZoom: 15 });
          }
        },
        zoomToFeatureBounds: (feature) => {
          try {
            const bounds = L.geoJSON(feature).getBounds();
            if (bounds.isValid()) {
              map.fitBounds(bounds.pad(0.5), { maxZoom: 17, animate: true });
              return;
            }
          } catch {
            // fall through to coordinate fallback
          }
          const coords = feature?.geometry?.coordinates;
          if (!coords) return;
          const [lng, lat] = Array.isArray(coords[0]) ? coords[0] : coords;
          map.setView([lat, lng], 16, { animate: true });
        },
        toggleFullscreen: () => {
          const container = map.getContainer().closest('.map-view');
          if (!container) return;

          if (!document.fullscreenElement) {
            container.requestFullscreen?.();
          } else {
            document.exitFullscreen?.();
          }
        },
        invalidateSize: () => scheduleRefresh(),
      });

      scheduleRefresh();

      initializeMap.cleanup = () => {
        map.off('moveend zoomend', syncMapMeta);
      };
    };

    initializeMap();

    return () => {
      isCancelled = true;
      window.clearTimeout(retryTimerId);
      window.clearTimeout(resizeDebounceId);
      clearRefreshTimers();
      if (handleWindowResize) {
        window.removeEventListener('resize', handleWindowResize);
      }
      initializeMap.cleanup?.();
      overlayLayersStore?.clear();
      overlayGroupInstance?.clearLayers();
      measurementGroupInstance?.clearLayers();
      drawingGroupInstance?.clearLayers();
      advancedGroupInstance?.clearLayers();
      hotspotGroupInstance?.clearLayers();
      mapInstance?.remove();
      mapRef.current = null;
      baseLayerRef.current = null;
      overlayGroupRef.current = null;
      measurementGroupRef.current = null;
      drawingGroupRef.current = null;
      advancedGroupRef.current = null;
      hotspotGroupRef.current = null;
      actionsRef.current.setMapApi(null);
    };
  }, [mode]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;

    const baseLayer = L.tileLayer(activeBaseMap.url, {
      attribution: activeBaseMap.attribution,
      keepBuffer: 2,
      updateWhenIdle: true,
    });
    const refresh = () => refreshMapLayout(map);
    const handleLoad = () => {
      refresh();
    };
    const handleTileError = () => {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[MapView] tile error', activeBaseMap.id);
      }
    };

    baseLayer.on('load', handleLoad);
    baseLayer.on('tileerror', handleTileError);
    baseLayer.addTo(map);
    baseLayerRef.current = baseLayer;
    refresh();

    return () => {
      baseLayer.off('load', handleLoad);
      baseLayer.off('tileerror', handleTileError);
      baseLayer.remove();
      if (baseLayerRef.current === baseLayer) {
        baseLayerRef.current = null;
      }
    };
  }, [activeBaseMap, mapReadyVersion]);

  // ── Effect 1: Layer CREATION ─────────────────────────────────────────────
  // Runs only when layer data / visibility / style / interactivity changes.
  // Does NOT include hoveredLayerId / activeFocusLayerId / selectedFeature
  // because those are volatile interaction state that should never cause full
  // layer teardown — they are handled by Effect 2 (style-only update below).
  React.useEffect(() => {
    const overlayGroup = overlayGroupRef.current;
    if (!overlayGroup) return;

    overlayGroup.clearLayers();
    overlayLayersRef.current.clear();

    filteredLayers
      .filter((layer) => layer.visible && layer.data?.features?.length)
      .forEach((layer) => {
        const geoJsonLayer = createGeoJsonLayer({
          enablePopup: !isMobile,
          // layerStateRef is already up-to-date (updated synchronously during
          // render, before this effect runs).
          stateRef: layerStateRef,
          interactive:
            interactionMode === 'select' &&
            !(ADVANCED_CLICK_TOOLS.has(activeTool) && analysisMode !== 'idle'),
          layer,
          onSelectFeature: (payload) => {
            actionsRef.current.focusLayer(payload.layerId);
            actionsRef.current.setSelectedFeature(payload);
          },
        });

        geoJsonLayer.addTo(overlayGroup);
        overlayLayersRef.current.set(layer.id, { geoJsonLayer, layer });
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filteredLayers,
    interactionMode,
    mapReadyVersion,
    activeTool,
    analysisMode,
  ]);

  // ── Effect 2: Style-only UPDATE ──────────────────────────────────────────
  // Runs when hover / focus / selection changes.
  // Updates existing Leaflet layers via setStyle() — zero layer recreation,
  // zero gray-map flicker.
  React.useEffect(() => {
    const { focusedLayerId, hoveredLayerId: hovered, selectedFeatureKey } =
      layerStateRef.current;

    overlayLayersRef.current.forEach(({ geoJsonLayer, layer }) => {
      // resetStyle re-invokes options.style(feature) which reads from
      // layerStateRef.current — now always current.
      geoJsonLayer.eachLayer((sublayer) => {
        geoJsonLayer.resetStyle(sublayer);

        // CircleMarker radius is not a CSS-style property; must be set explicitly.
        if (sublayer instanceof L.CircleMarker) {
          const featureKey =
            sublayer.feature?.properties?.__featureKey || null;
          const visualState = getVisualState({
            focusedLayerId,
            hoveredLayerId: hovered,
            isLayerVisible: layer.visible,
            layerId: layer.id,
            selectedFeatureKey,
            featureKey,
          });
          const isSelected = visualState === 'selected';
          const isHighlighted = visualState === 'highlighted';
          const baseRadius = layer.style?.pointRadius || 6;
          sublayer.setRadius(
            baseRadius + (isSelected ? 2 : isHighlighted ? 1 : 0)
          );
        }
      });
    });
  }, [hoveredLayerId, activeFocusLayerId, selectedFeature]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !map._loaded) return undefined;

    const hasFeatures = filteredLayers.some(
      (l) => l.visible && l.data?.features?.length > 0
    );

    if (hasFeatures) {
      try {
        fitVisibleLayers(map, filteredLayers);
      } catch (e) {
        console.warn('[MapView] fitBounds error', e);
      }
    }

    const timerIds = [220, 300].map((delay) =>
      window.setTimeout(() => {
        refreshMapLayout(map);
      }, delay)
    );

    return () => {
      timerIds.forEach((timerId) => window.clearTimeout(timerId));
    };
  }, [filteredLayers, mapReadyVersion, visibleSignature]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMobile) return undefined;

    const timerIds = [220].map((delay) =>
      window.setTimeout(() => {
        refreshMapLayout(map);
      }, delay)
    );

    return () => {
      timerIds.forEach((timerId) => window.clearTimeout(timerId));
    };
  }, [isCompactViewport, isMobile, mapReadyVersion, mobileSheet]);

  React.useEffect(() => {
    const map = mapRef.current;
    const isMobileViewport = isMobile || isCompactViewport;
    if (!map || !isMobileViewport) return undefined;

    const timerIds = [200, 300].map((delay) =>
      window.setTimeout(() => {
        if (!mapRef.current || !mapRef.current._loaded) return;

        try {
          mapRef.current.invalidateSize({ pan: false });
        } catch (e) {
          console.warn('[MapView] mobile invalidateSize error', e);
        }

        const hasFeatures = filteredLayers.some(
          (l) => l.visible && l.data?.features?.length > 0
        );

        if (hasFeatures) {
          try {
            fitVisibleLayers(mapRef.current, filteredLayers);
          } catch (e) {
            console.warn('[MapView] mobile fitBounds error', e);
          }
        }
      }, delay)
    );

    return () => {
      timerIds.forEach((timerId) => window.clearTimeout(timerId));
    };
  }, [filteredLayers, isCompactViewport, isMobile]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const container = map.getContainer();
    const isMapEditing = isMeasureMode(interactionMode) || isDrawMode(interactionMode);

    container.style.cursor = isMapEditing ? 'crosshair' : '';
    if (isMapEditing) map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();

    return () => {
      container.style.cursor = '';
      map.doubleClickZoom.enable();
    };
  }, [interactionMode, mapReadyVersion]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !isMeasureMode(interactionMode)) return undefined;

    const handleClick = (event) => {
      actions.setMeasurement((current) => {
        const nextPoints = current.finished
          ? [event.latlng]
          : [...current.points, event.latlng];

        return {
          type: interactionMode,
          points: nextPoints,
          summary: buildMeasurementSummary(interactionMode, nextPoints),
          finished: false,
        };
      });
    };

    const handleDoubleClick = () => {
      actions.setMeasurement((current) => {
        const minimumPoints =
          current.type === 'measure-distance' ? 2 : 3;

        if (current.points.length < minimumPoints) return current;

        return {
          ...current,
          finished: true,
          summary: buildMeasurementSummary(current.type, current.points),
        };
      });
    };

    map.on('click', handleClick);
    map.on('dblclick', handleDoubleClick);

    return () => {
      map.off('click', handleClick);
      map.off('dblclick', handleDoubleClick);
    };
  }, [actions, interactionMode, mapReadyVersion]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !isDrawMode(interactionMode)) return undefined;

    const handleClick = (event) => {
      if (interactionMode === 'draw-point') {
        actions.addDrawItem(buildDrawItem('draw-point', [event.latlng]));
        return;
      }

      actions.setDrawDraft((current) => {
        const currentPoints =
          current.type === interactionMode ? current.points : [];
        return {
          type: interactionMode,
          points: [...currentPoints, event.latlng],
        };
      });
    };

    const handleDoubleClick = () => {
      actions.setDrawDraft((current) => {
        const minimumPoints =
          current.type === 'draw-line' ? 2 : 3;

        if (current.points.length < minimumPoints) return current;

        actions.addDrawItem(buildDrawItem(current.type, current.points));
        return EMPTY_DRAW_DRAFT;
      });
    };

    map.on('click', handleClick);
    map.on('dblclick', handleDoubleClick);

    return () => {
      map.off('click', handleClick);
      map.off('dblclick', handleDoubleClick);
    };
  }, [actions, interactionMode, mapReadyVersion]);

  React.useEffect(() => {
    const measurementGroup = measurementGroupRef.current;
    if (!measurementGroup) return;

    measurementGroup.clearLayers();

    const points = measurement.points || [];
    if (!points.length) return;

    points.forEach((point) => {
      L.circleMarker(point, {
        radius: 5,
        color: '#691C32',
        weight: 2,
        fillColor: '#ffffff',
        fillOpacity: 1,
      }).addTo(measurementGroup);
    });

    if (measurement.type === 'measure-distance' && points.length >= 2) {
      const line = L.polyline(points, {
        color: '#691C32',
        weight: 3,
        dashArray: '10 6',
      }).addTo(measurementGroup);

      const summary =
        measurement.summary || formatDistance(computeDistance(points));
      line.bindTooltip(summary, {
        permanent: true,
        direction: 'top',
        className: 'measure-label',
      });
    }

    if (measurement.type === 'measure-area' && points.length >= 2) {
      if (measurement.finished && points.length >= 3) {
        const polygon = L.polygon(points, {
          color: '#691C32',
          weight: 2,
          fillColor: '#C5A572',
          fillOpacity: 0.22,
        }).addTo(measurementGroup);

        const summary =
          measurement.summary || formatArea(computeGeodesicArea(points));
        polygon.bindTooltip(summary, {
          permanent: true,
          direction: 'center',
          className: 'measure-label measure-label--area',
        });
      } else {
        L.polyline(points, {
          color: '#691C32',
          weight: 3,
          dashArray: '8 6',
        }).addTo(measurementGroup);
      }
    }
  }, [mapReadyVersion, measurement]);

  React.useEffect(() => {
    const drawingGroup = drawingGroupRef.current;
    if (!drawingGroup) return;

    drawingGroup.clearLayers();

    drawItems.forEach((item) => {
      if (item.type === 'draw-point' && item.points[0]) {
        const marker = L.circleMarker(item.points[0], {
          radius: 6,
          color: '#006341',
          weight: 2,
          fillColor: '#ffffff',
          fillOpacity: 1,
        }).addTo(drawingGroup);

        marker.bindTooltip('Punto', {
          permanent: true,
          direction: 'top',
          className: 'measure-label',
        });
      }

      if (item.type === 'draw-line' && item.points.length >= 2) {
        const line = L.polyline(item.points, {
          color: '#006341',
          weight: 3,
        }).addTo(drawingGroup);

        if (item.summary) {
          line.bindTooltip(item.summary, {
            permanent: true,
            direction: 'top',
            className: 'measure-label measure-label--draw',
          });
        }
      }

      if (item.type === 'draw-polygon' && item.points.length >= 3) {
        const polygon = L.polygon(item.points, {
          color: '#006341',
          weight: 2,
          fillColor: '#006341',
          fillOpacity: 0.16,
        }).addTo(drawingGroup);

        if (item.summary) {
          polygon.bindTooltip(item.summary, {
            permanent: true,
            direction: 'center',
            className: 'measure-label measure-label--draw',
          });
        }
      }
    });

    if (drawDraft.points.length) {
      if (drawDraft.type === 'draw-line') {
        L.polyline(drawDraft.points, {
          color: '#006341',
          weight: 3,
          dashArray: '8 6',
        }).addTo(drawingGroup);
      }

      if (drawDraft.type === 'draw-polygon') {
        L.polyline(drawDraft.points, {
          color: '#006341',
          weight: 3,
          dashArray: '8 6',
        }).addTo(drawingGroup);
      }

      drawDraft.points.forEach((point) => {
        L.circleMarker(point, {
          radius: 4,
          color: '#006341',
          weight: 2,
          fillColor: '#ffffff',
          fillOpacity: 1,
        }).addTo(drawingGroup);
      });
    }
  }, [drawDraft, drawItems, mapReadyVersion]);

  React.useEffect(() => {
    const map = mapRef.current;
    const advancedGroup = advancedGroupRef.current;
    if (!map || !advancedGroup) return undefined;
    if (!ADVANCED_CLICK_TOOLS.has(activeTool)) return undefined;

    const handleClick = async (event) => {
      advancedGroup.clearLayers();
      map.closePopup();

      if (analysisMode === 'buffer') {
        L.circle(event.latlng, {
          radius: bufferRadiusKm * METERS_PER_KILOMETER,
          color: '#691C32',
          weight: 2,
          fillColor: '#C5A572',
          fillOpacity: 0.14,
        }).addTo(advancedGroup);

        L.circleMarker(event.latlng, {
          radius: 5,
          color: '#691C32',
          weight: 2,
          fillColor: '#ffffff',
          fillOpacity: 1,
        }).addTo(advancedGroup);

        L.popup({ maxWidth: 280 })
          .setLatLng(event.latlng)
          .setContent(buildBufferPopup(bufferRadiusKm))
          .openOn(map);
        return;
      }

      if (analysisMode === 'population') {
        try {
          const result = await populationEngineRef.current.queryRadius(
            event.latlng,
            populationRadiusKm
          );

          L.circle(event.latlng, {
            radius: populationRadiusKm * METERS_PER_KILOMETER,
            color: '#1d4ed8',
            weight: 2,
            fillColor: '#60a5fa',
            fillOpacity: 0.16,
          }).addTo(advancedGroup);

          L.circleMarker(event.latlng, {
            radius: 5,
            color: '#1d4ed8',
            weight: 2,
            fillColor: '#ffffff',
            fillOpacity: 1,
          }).addTo(advancedGroup);

          L.popup({ maxWidth: 320 })
            .setLatLng(event.latlng)
            .setContent(buildPopulationPopup(result))
            .openOn(map);
        } catch (error) {
          L.popup({ maxWidth: 320 })
            .setLatLng(event.latlng)
            .setContent(buildPopulationPopup(null, error.message))
            .openOn(map);
        }
        return;
      }

      if (analysisMode === 'proximity') {
        if (!proximityLayer) {
          L.popup({ maxWidth: 300 })
            .setLatLng(event.latlng)
            .setContent(
              buildProximityPopup(
                'Capa activa',
                []
              )
            )
            .openOn(map);
          return;
        }

        const nearestItems = getNearestFeatures({
          layer: proximityLayer,
          latlng: event.latlng,
          limit: 5,
        });

        L.circleMarker(event.latlng, {
          radius: 5,
          color: '#7c2d12',
          weight: 2,
          fillColor: '#ffffff',
          fillOpacity: 1,
        }).addTo(advancedGroup);

        nearestItems.slice(0, 3).forEach((item) => {
          L.polyline([event.latlng, item.point], {
            color: '#ea580c',
            weight: 2,
            dashArray: '8 6',
            opacity: 0.72,
          }).addTo(advancedGroup);

          L.circleMarker(item.point, {
            radius: 6,
            color: '#ea580c',
            weight: 2,
            fillColor: '#fed7aa',
            fillOpacity: 0.95,
          }).addTo(advancedGroup);
        });

        L.popup({ maxWidth: 340 })
          .setLatLng(event.latlng)
          .setContent(
            buildProximityPopup(proximityLayer.name, nearestItems)
          )
          .openOn(map);
      }
    };

    map.on('click', handleClick);
    return () => {
      map.off('click', handleClick);
    };
  }, [
    activeTool,
    analysisMode,
    bufferRadiusKm,
    populationRadiusKm,
    proximityLayer,
  ]);

  React.useEffect(() => {
    const map = mapRef.current;
    const hotspotGroup = hotspotGroupRef.current;
    if (!map || !hotspotGroup) return undefined;

    const redrawHotspot = () => {
      hotspotGroup.clearLayers();

      if (activeTool !== 'hotspot' || !hotspotLayer) return;

      const bins = buildHotspotBins({
        cellSizePx: 72,
        layer: hotspotLayer,
        map,
      });

      if (!bins.length) return;
      const maxCount = bins[0].count;

      bins.slice(0, 180).forEach((bin) => {
        const color = getHotspotColor(bin.count, maxCount);
        const intensity = maxCount > 0 ? bin.count / maxCount : 0;

        const marker = L.circleMarker(bin.center, {
          radius: Math.max(14, Math.min(34, 12 + bin.count * 3)),
          color,
          weight: 1,
          fillColor: color,
          fillOpacity: 0.18 + intensity * 0.44,
          opacity: 0.2 + intensity * 0.7,
        }).addTo(hotspotGroup);

        marker.bindTooltip(`${bin.count} elemento(s)`, {
          permanent: false,
          direction: 'top',
          className: 'measure-label',
        });
      });
    };

    redrawHotspot();
    map.on('moveend zoomend', redrawHotspot);

    return () => {
      map.off('moveend zoomend', redrawHotspot);
      hotspotGroup.clearLayers();
    };
  }, [activeTool, hotspotLayer, mapReadyVersion]);

  React.useEffect(() => {
    measurementGroupRef.current?.clearLayers();
    clearAdvancedOverlays();
    setActiveTool(null);
  }, [clearAdvancedOverlays, clearSignal, mapReadyVersion]);

  const toolDetailPanel = React.useMemo(() => {
    if (!showAdvancedTools || !activeTool) return null;

    if (activeTool === 'basemap') {
      return (
        <div className="map-view__tools-detail map-view__tools-detail--menu">
          <span className="map-view__tools-title">Base map</span>
          <div className="map-view__tools-menu">
            {orderedBaseMaps.map((baseMap) => (
              <button
                className={`map-view__menu-item${
                  activeBaseMap.id === baseMap.id ? ' is-active' : ''
                }`}
                key={baseMap.id}
                onClick={() => {
                  actions.setActiveBaseMapId(baseMap.id);
                  setActiveTool(null);
                }}
                type="button"
              >
                <img
                  alt={`Vista previa ${getBasemapDisplayName(baseMap)}`}
                  className="map-view__menu-thumb"
                  loading="lazy"
                  src={baseMap.previewUrl}
                />
                <span className="map-view__menu-copy">
                  <strong>{getBasemapDisplayName(baseMap)}</strong>
                  <span>{baseMap.description}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (activeTool === 'layers') {
      return (
        <div className="map-view__tools-detail map-view__tools-detail--layers">
          <span className="map-view__tools-title">Capas</span>
          <div className="lp-header">
            <div className="lp-stats">
              <span>
                <strong>{visibleLayerCount}</strong> activas
              </span>
              <span>
                <strong>{layers.length}</strong> total
              </span>
            </div>
            <div className="lp-actions">
              <button
                className="lp-action-btn"
                onClick={() => actions.setAllLayersVisible(true)}
                type="button"
              >
                Encender todas
              </button>
              <button
                className="lp-action-btn"
                onClick={() => actions.setAllLayersVisible(false)}
                type="button"
              >
                Apagar todas
              </button>
            </div>
          </div>
          <div className="map-view__layers-scroll">
            <div className="lp-groups">
              {layersByDG.map(([dg, dgLayers]) => {
                const isExpanded = expandedDGs[dg] ?? false;
                const visibleInGroup = dgLayers.filter((layer) => layer.visible).length;
                const hasRisk = dgLayers.some(
                  (layer) => (layerMetricsById.get(layer.id)?.riskCount || 0) > 0
                );

                return (
                  <div className="lp-group" key={dg}>
                    <button
                      className={`lp-group__head${isExpanded ? ' is-open' : ''}${
                        hasRisk ? ' has-risk' : ''
                      }`}
                      onClick={() =>
                        setExpandedDGs((current) => ({
                          ...current,
                          [dg]: !isExpanded,
                        }))
                      }
                      type="button"
                    >
                      <span className="lp-group__chevron">
                        <svg
                          fill="none"
                          height="14"
                          viewBox="0 0 14 14"
                          width="14"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            d={isExpanded ? 'M3 5l4 4 4-4' : 'M5 3l4 4-4 4'}
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="1.6"
                          />
                        </svg>
                      </span>
                      <span className="lp-group__name">{dg}</span>
                      <span className="lp-group__count">
                        {visibleInGroup}/{dgLayers.length}
                      </span>
                      {hasRisk ? <span className="lp-group__risk" /> : null}
                    </button>

                    {isExpanded ? (
                      <div className="lp-group__body">
                        {dgLayers.map((layer) => {
                          const metrics = layerMetricsById.get(layer.id) || {};
                          const isRisk = (metrics.riskCount || 0) > 0;

                          return (
                            <div
                              className={`lp-layer${isRisk ? ' is-risk' : ''}`}
                              key={layer.id}
                            >
                              <div className="lp-layer__main">
                                <span
                                  className="lp-layer__sym"
                                  style={{ color: layer.style?.color || layer.color }}
                                >
                                  {geomSymbol(layer.geometryType)}
                                </span>
                                <div className="lp-layer__info">
                                  <strong>{layer.name}</strong>
                                  <span>
                                    {layer.data?.features?.length || 0} elementos
                                    {metrics.averageProgress != null
                                      ? ` · ${metrics.averageProgress}% avance`
                                      : ''}
                                    {isRisk ? ` · ${metrics.riskCount} riesgo` : ''}
                                  </span>
                                </div>
                                <LayerToggle
                                  checked={layer.visible}
                                  label={`${
                                    layer.visible ? 'Apagar' : 'Encender'
                                  } ${layer.name}`}
                                  onClick={() => actions.toggleLayerVisibility(layer.id)}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      );
    }

    if (activeTool === 'draw') {
      return (
        <div className="map-view__tools-detail">
          <span className="map-view__tools-title">Dibujo</span>
          <div className="map-view__tools-row">
            <AdvancedToolChip
              active={drawToolMode === 'draw-point'}
              onClick={() => setDrawToolMode('draw-point')}
            >
              Punto
            </AdvancedToolChip>
            <AdvancedToolChip
              active={drawToolMode === 'draw-line'}
              onClick={() => setDrawToolMode('draw-line')}
            >
              Línea
            </AdvancedToolChip>
            <AdvancedToolChip
              active={drawToolMode === 'draw-polygon'}
              onClick={() => setDrawToolMode('draw-polygon')}
            >
              Polígono
            </AdvancedToolChip>
          </div>
        </div>
      );
    }

    if (activeTool === 'measure') {
      return (
        <div className="map-view__tools-detail">
          <span className="map-view__tools-title">Medición</span>
          <div className="map-view__tools-row">
            <AdvancedToolChip
              active={measureToolMode === 'measure-distance'}
              onClick={() => setMeasureToolMode('measure-distance')}
            >
              Distancia
            </AdvancedToolChip>
            <AdvancedToolChip
              active={measureToolMode === 'measure-area'}
              onClick={() => setMeasureToolMode('measure-area')}
            >
              Área
            </AdvancedToolChip>
          </div>
        </div>
      );
    }

    if (activeTool === 'analysis') {
      return (
        <div className="map-view__tools-detail">
          <span className="map-view__tools-title">Análisis poblacional</span>
          <div className="map-view__tools-row">
            <AdvancedToolChip
              active={analysisMode === 'population'}
              onClick={() => setAnalysisMode('population')}
            >
              Población
            </AdvancedToolChip>
            <AdvancedToolChip
              active={analysisMode === 'buffer'}
              onClick={() => setAnalysisMode('buffer')}
            >
              Buffer
            </AdvancedToolChip>
            <AdvancedToolChip
              active={analysisMode === 'proximity'}
              onClick={() => setAnalysisMode('proximity')}
            >
              Proximidad
            </AdvancedToolChip>
          </div>
          <p>
            {analysisMode === 'population'
              ? 'Haz clic en el mapa para consultar la población por radio.'
              : analysisMode === 'buffer'
                ? 'Haz clic en el mapa para generar el buffer.'
                : 'Haz clic en el mapa para listar elementos cercanos.'}
          </p>
          <div className="map-view__tools-row">
            {analysisMode === 'population'
              ? [1, 3, 5].map((radius) => (
                  <AdvancedToolChip
                    active={populationRadiusKm === radius}
                    key={radius}
                    onClick={() => setPopulationRadiusKm(radius)}
                  >
                    {radius} km
                  </AdvancedToolChip>
                ))
              : null}
            {analysisMode === 'buffer'
              ? [1, 3, 5].map((radius) => (
                  <AdvancedToolChip
                    active={bufferRadiusKm === radius}
                    key={radius}
                    onClick={() => setBufferRadiusKm(radius)}
                  >
                    {radius} km
                  </AdvancedToolChip>
                ))
              : null}
          </div>
          {analysisMode === 'proximity' ? (
            <strong>
              {proximityLayer?.name || selectedLayer?.name || 'Sin capa activa'}
            </strong>
          ) : null}
        </div>
      );
    }

    if (activeTool === 'hotspot') {
      return (
        <div className="map-view__tools-detail">
          <span className="map-view__tools-title">Hotspot</span>
          <p>Mapa de densidad activo sobre la capa puntual visible.</p>
          <strong>{hotspotLayer?.name || 'Selecciona o activa una capa de puntos'}</strong>
        </div>
      );
    }

    return null;
  }, [
    activeTool,
    activeBaseMap.id,
    actions,
    analysisMode,
    bufferRadiusKm,
    drawToolMode,
    hotspotLayer,
    measureToolMode,
    orderedBaseMaps,
    populationRadiusKm,
    proximityLayer,
    selectedLayer,
    showAdvancedTools,
    expandedDGs,
    layerMetricsById,
    layers,
    layersByDG,
    visibleLayerCount,
  ]);

  const currentToolLabel =
    activeTool === 'basemap'
      ? 'Base map'
      : activeTool === 'layers'
        ? 'Capas'
        : activeTool === 'analysis'
          ? analysisMode === 'buffer'
            ? `Buffer ${bufferRadiusKm} km`
            : analysisMode === 'population'
              ? `Población ${populationRadiusKm} km`
              : 'Proximidad'
          : activeTool === 'hotspot'
            ? 'Hotspot'
            : activeTool === 'draw'
              ? drawToolMode === 'draw-point'
                ? 'Dibujo punto'
                : drawToolMode === 'draw-line'
                  ? 'Dibujo línea'
                  : 'Dibujo polígono'
              : activeTool === 'measure'
                ? measureToolMode === 'measure-distance'
                  ? 'Medición lineal'
                  : 'Medición de área'
                : interactionMode === 'select'
                  ? 'Selección'
                  : interactionMode === 'measure-distance'
                    ? 'Medición lineal'
                    : interactionMode === 'measure-area'
                      ? 'Medición de área'
                      : interactionMode === 'draw-point'
                        ? 'Dibujo punto'
                        : interactionMode === 'draw-line'
                          ? 'Dibujo línea'
                          : interactionMode === 'draw-polygon'
                            ? 'Dibujo polígono'
                            : 'Exploración';

  return (
    <section className={`map-view${isMobile ? ' map-view--mobile' : ''}`}>
      <div
        className={`map-view__surface${isFocusMode ? ' is-focus-mode' : ''}`}
      >
        <div className="map-view__canvas" ref={mapNodeRef} />

        {!isMobile ? (
          <div className="map-view__hud map-view__hud--top">
            <div className="map-view__badge">
              <span>Ciudad</span>
              <strong>Ciudad de México</strong>
            </div>
            <div className="map-view__badge">
              <span>Base</span>
              <strong>{activeBaseMap.name}</strong>
            </div>
            <div className="map-view__badge">
              <span>Visible</span>
              <strong>{filteredFeatureCount} registros</strong>
            </div>
          </div>
        ) : null}

        {showAdvancedTools ? (
          <div className="map-left-tools">
            <AdvancedToolButton
              active={activeTool === 'basemap'}
              label={<BasemapIcon />}
              onClick={() => handleAdvancedToolToggle('basemap')}
              title="Base map"
            />
            <AdvancedToolButton
              active={activeTool === 'layers'}
              label={
                <ToolIcon
                  alt="Capas"
                  src={`${TOOL_ICON_BASE}/capas.svg`}
                />
              }
              onClick={() => handleAdvancedToolToggle('layers')}
              title="Capas"
            />
            <AdvancedToolButton
              active={activeTool === 'draw'}
              label={
                <ToolIcon
                  alt="Dibujo"
                  src={`${TOOL_ICON_BASE}/dibujo.svg`}
                />
              }
              onClick={() => handleAdvancedToolToggle('draw')}
              title="Dibujo"
            />
            <AdvancedToolButton
              active={activeTool === 'measure'}
              label={
                <ToolIcon
                  alt="Medición"
                  src={`${TOOL_ICON_BASE}/medicion.svg`}
                />
              }
              onClick={() => handleAdvancedToolToggle('measure')}
              title="Medición"
            />
            <AdvancedToolButton
              active={activeTool === 'analysis'}
              label={
                <ToolIcon
                  alt="Población"
                  src={`${TOOL_ICON_BASE}/poblacion.svg`}
                />
              }
              onClick={() => handleAdvancedToolToggle('analysis')}
              title="Análisis poblacional"
            />
            <AdvancedToolButton
              active={activeTool === 'hotspot'}
              label={
                <ToolIcon
                  alt="Hotspot"
                  src={`${TOOL_ICON_BASE}/hotspot.svg`}
                />
              }
              onClick={() => handleAdvancedToolToggle('hotspot')}
              title="Hotspot"
            />
            {toolDetailPanel}
          </div>
        ) : null}

        {selectedFeature && !isMobile ? (
          <div className="map-view__feature-card">
            <span className="map-view__feature-eyebrow">Elemento activo</span>
            <h3>{selectedFeature.properties?.OBRA || selectedFeature.layerName}</h3>
            <dl>
              {[
                ['Programa', selectedFeature.properties?.PROGRAMA],
                ['DG', selectedFeature.properties?.DG],
                ['Alcaldía', selectedFeature.properties?.ALCALDIA],
                ['Frente', selectedFeature.properties?.FRENTE],
              ]
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{String(value)}</dd>
                  </div>
                ))}
            </dl>
          </div>
        ) : null}

        {!isMobile ? (
          <div className="map-view__statusbar">
            <span>Zoom {mapMeta.zoom}</span>
            <span>
              Centro {mapMeta.center.lat.toFixed(4)},{' '}
              {mapMeta.center.lng.toFixed(4)}
            </span>
            <span>
              Herramienta {currentToolLabel}
            </span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default MapView;
