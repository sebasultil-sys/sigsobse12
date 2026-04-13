import React from 'react';
import { useGISWorkspace } from '../../app/GISWorkspaceContext';
import FiltersPanel from '../filters/FiltersPanel';
import LayerStyleEditor from './LayerStyleEditor';
import { formatLayerCount, getLayerStatus } from './layerStatus';

const GEOJSON_GEOMETRY_TYPES = new Set([
  'Point',
  'MultiPoint',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
  'GeometryCollection',
]);

function getGeometryClass(geometryType) {
  if (geometryType === 'Point' || geometryType === 'MultiPoint') {
    return 'is-point';
  }

  if (geometryType === 'LineString' || geometryType === 'MultiLineString') {
    return 'is-line';
  }

  return 'is-polygon';
}

function buildFeatureCollectionFromGeoJson(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('El archivo no contiene un GeoJSON válido.');
  }

  if (payload.type === 'FeatureCollection') {
    if (!Array.isArray(payload.features)) {
      throw new Error('El FeatureCollection no contiene un arreglo de features.');
    }

    if (!payload.features.length) {
      throw new Error('El GeoJSON no contiene elementos para dibujar.');
    }

    return payload;
  }

  if (payload.type === 'Feature') {
    return {
      type: 'FeatureCollection',
      features: [payload],
    };
  }

  if (GEOJSON_GEOMETRY_TYPES.has(payload.type)) {
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: payload,
        },
      ],
    };
  }

  throw new Error('Solo se permiten archivos GeoJSON válidos.');
}

function buildMetricSummary(layer, metrics) {
  const loadedCount = layer.data?.features?.length || 0;
  const estimatedCount = Math.max(0, Number(layer.estimatedFeatureCount || 0));
  const isPendingDatabaseLayer =
    layer.databaseLayer && layer.loadStatus !== 'loaded';

  return {
    progress: isPendingDatabaseLayer
      ? 'Pendiente'
      : metrics.averageProgress != null
        ? `${metrics.averageProgress}% avance`
        : 'Sin avance',
    risk: isPendingDatabaseLayer
      ? 'Sin evaluar'
      : metrics.riskCount > 0
        ? `${metrics.riskCount} elemento${metrics.riskCount === 1 ? '' : 's'} en riesgo`
        : 'Sin riesgo',
    total: isPendingDatabaseLayer
      ? estimatedCount > 0
        ? `${formatLayerCount(estimatedCount, true)} elementos estimados`
        : 'Disponible para cargar'
      : `${formatLayerCount(loadedCount)} elemento${loadedCount === 1 ? '' : 's'}`,
  };
}

function LayersPanel() {
  const {
    actions,
    activeBaseMap,
    baseMaps,
    focusedLayerId,
    layerQuery,
    layerMetricsById,
    layerSearchResults,
    layers,
    mapApi,
    mapViewportBounds,
    selectedLayer,
    selectedLayerId,
    sidebarTab,
    visibleLayerCount,
    filteredLayers,
    hoveredLayerId,
  } = useGISWorkspace();
  const [draggedLayerId, setDraggedLayerId] = React.useState(null);
  const [openLayerId, setOpenLayerId] = React.useState(null);
  const [openGroupId, setOpenGroupId] = React.useState(null);
  const [uploadError, setUploadError] = React.useState(null);
  const [isUploading, setIsUploading] = React.useState(false);
  const fileInputRef = React.useRef(null);

  const filteredCountByLayer = React.useMemo(() => {
    const counts = new Map();

    filteredLayers.forEach((layer) => {
      counts.set(layer.id, layer.data?.features?.length || 0);
    });

    return counts;
  }, [filteredLayers]);

  const hasHiddenLayers = visibleLayerCount < layers.length;
  const hasVisibleLayers = visibleLayerCount > 0;
  const uploadedLayers = React.useMemo(
    () => layers.filter((layer) => layer.uploaded),
    [layers]
  );
  const groupedLayerSearchResults = React.useMemo(() => {
    const groups = new Map();

    layerSearchResults.forEach((layer) => {
      const dg = layer.dg || 'Sin DG';
      if (!groups.has(dg)) groups.set(dg, []);
      groups.get(dg).push(layer);
    });

    return Array.from(groups.entries()).sort(([left], [right]) =>
      left.localeCompare(right, 'es')
    );
  }, [layerSearchResults]);

  React.useEffect(() => {
    if (!openLayerId) return;

    const isStillVisible = layerSearchResults.some(
      (layer) => layer.id === openLayerId
    );

    if (!isStillVisible) {
      setOpenLayerId(null);
    }
  }, [layerSearchResults, openLayerId]);

  React.useEffect(() => {
    if (sidebarTab === 'layers') {
      setOpenLayerId(null);
      setOpenGroupId(null);
    }
  }, [sidebarTab]);

  React.useEffect(() => {
    if (!openGroupId) return;

    const groupStillExists = groupedLayerSearchResults.some(
      ([groupName]) => groupName === openGroupId
    );

    if (!groupStillExists) {
      setOpenGroupId(null);
    }
  }, [groupedLayerSearchResults, openGroupId]);

  const handleUploadClick = React.useCallback(() => {
    setUploadError(null);
    fileInputRef.current?.click();
  }, []);

  const handleUploadChange = React.useCallback(
    async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';

      if (!file) return;

      setIsUploading(true);
      setUploadError(null);

      try {
        const text = await file.text();
        const raw = JSON.parse(text);
        const featureCollection = buildFeatureCollectionFromGeoJson(raw);
        const layerName = file.name.replace(/\.(geo)?json$/i, '') || 'Capa subida';

        actions.addUploadedLayer(featureCollection, layerName);
        actions.setSidebarTab('uploads');
      } catch (error) {
        setUploadError(
          error instanceof Error
            ? error.message
            : 'No se pudo cargar el archivo GeoJSON.'
        );
      } finally {
        setIsUploading(false);
      }
    },
    [actions]
  );

  const renderLayersTab = () => (
    <div className="sidebar-panel">
      <div className="sidebar-panel__toolbar">
        <div className="sidebar-panel__stats">
          <div className="mini-card mini-card--compact">
            <span className="mini-card__label">Capas activas</span>
            <span className="mini-card__value">{visibleLayerCount}</span>
          </div>
          <div className="mini-card mini-card--compact">
            <span className="mini-card__label">Total catálogo</span>
            <span className="mini-card__value">{layers.length}</span>
          </div>
        </div>

        <div className="sidebar-panel__actions">
          <button
            className="ghost-button ghost-button--small"
            disabled={!hasHiddenLayers}
            onClick={() => actions.setAllLayersVisible(true)}
            type="button"
          >
            Encender todas
          </button>
          <button
            className="ghost-button ghost-button--small"
            disabled={!hasVisibleLayers}
            onClick={() => actions.setAllLayersVisible(false)}
            type="button"
          >
            Apagar todas
          </button>
        </div>
      </div>

      <label className="layer-search">
        <span className="field-label">Buscar capa</span>
        <input
          onChange={(event) => actions.setLayerQuery(event.target.value)}
          placeholder="Red vial, CETRAM, Utopías..."
          type="search"
          value={layerQuery}
        />
      </label>

      <div className="lp-groups layers-tree__groups">
        {groupedLayerSearchResults.map(([dg, dgLayers]) => {
          const isGroupOpen = openGroupId === dg;
          const visibleInGroup = dgLayers.filter((layer) => layer.visible).length;
          const hasRisk = dgLayers.some(
            (layer) => (layerMetricsById.get(layer.id)?.riskCount || 0) > 0
          );

          const isDimmed = openGroupId !== null && openGroupId !== dg;

          return (
            <section
              className={`lp-group layers-tree__group-card${isGroupOpen ? ' lp-group--active' : ''}${isDimmed ? ' lp-group--dimmed' : ''}`}
              key={dg}
            >
              <button
                aria-expanded={isGroupOpen}
                className={`lp-group__head${isGroupOpen ? ' is-open' : ''}${
                  hasRisk ? ' has-risk' : ''
                }`}
                onClick={() => {
                  setOpenGroupId((current) => (current === dg ? null : dg));
                  setOpenLayerId(null);
                }}
                type="button"
              >
                <span className={`lp-group__chevron${isGroupOpen ? ' is-open' : ''}`}>
                  <svg
                    aria-hidden="true"
                    fill="none"
                    height="14"
                    viewBox="0 0 14 14"
                    width="14"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M3 5l4 4 4-4"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.6"
                    />
                  </svg>
                </span>
                <span className="lp-group__name" title={dg}>
                  {dg}
                </span>
                <span className="lp-group__count">
                  {visibleInGroup}/{dgLayers.length}
                </span>
                {hasRisk ? <span className="lp-group__risk" /> : null}
              </button>

              {isGroupOpen ? (
                <div className="layers-tree">
                  {dgLayers.map((layer) => {
                  const isSelected = layer.id === selectedLayerId;
                  const isExpanded = layer.id === openLayerId;
                  const isFocused = layer.id === focusedLayerId;
                  const isHovered = layer.id === hoveredLayerId;
                  const filteredFeatureCount = filteredCountByLayer.get(layer.id) || 0;
                  const geometryClass = getGeometryClass(layer.geometryType);
                  const metrics = layerMetricsById.get(layer.id) || {
                    averageProgress: null,
                    riskCount: 0,
                    totalElements: 0,
                    health: 'active',
                  };
                  const status = getLayerStatus(layer, mapViewportBounds, metrics);
                  const metricSummary = buildMetricSummary(layer, metrics);
                  const isMetricsLoaded =
                    !layer.databaseLayer || layer.loadStatus === 'loaded';
                  const statusIndicatorClass = isMetricsLoaded
                    ? metrics.health === 'risk'
                      ? ' is-risk'
                      : ' is-active'
                    : ' is-pending';
                  const statusIndicatorLabel = isMetricsLoaded
                    ? metrics.health === 'risk'
                      ? 'Riesgo'
                      : 'Activo'
                    : status.label;
                  const subtitleText =
                    isMetricsLoaded
                      ? `${layer.visible ? 'Visible' : 'Oculta'} · ${filteredFeatureCount} visibles · ${layer.geometryType}`
                      : `${status.label} · ${status.detail} · ${layer.geometryType}`;

                    return (
                      <article
                        className={`layers-tree__item${isSelected ? ' is-selected' : ''}${
                          isExpanded ? ' is-open' : ''
                        }${
                          isFocused ? ' is-focused' : ''
                        }${isHovered ? ' is-hovered' : ''}${
                          metrics.health === 'risk' ? ' is-risk' : ' is-active-health'
                        }`}
                        draggable
                        key={layer.id}
                        onMouseEnter={() => actions.setHoveredLayerId(layer.id)}
                        onMouseLeave={() => actions.clearLayerHover()}
                        onDragOver={(event) => event.preventDefault()}
                        onDragStart={() => setDraggedLayerId(layer.id)}
                        onDrop={() => {
                          if (!draggedLayerId) return;
                          actions.moveLayer(draggedLayerId, layer.id);
                          setDraggedLayerId(null);
                        }}
                      >
                        <div className="layers-tree__row">
                          <div className="layers-tree__headline">
                            <button
                              className="layers-tree__grab"
                              onClick={() => actions.focusLayer(layer.id)}
                              type="button"
                            >
                              ⋮⋮
                            </button>

                            <button
                              aria-label={layer.visible ? 'Ocultar capa' : 'Mostrar capa'}
                              aria-pressed={layer.visible}
                              className={`layer-toggle${layer.visible ? ' layer-toggle--on' : ''}`}
                              onClick={() => actions.toggleLayerVisibility(layer.id)}
                              type="button"
                            >
                              <span className="layer-toggle__track" />
                              <span className="layer-toggle__thumb" />
                            </button>

                            <button
                              aria-expanded={isExpanded}
                              className="layers-tree__label"
                              onClick={() => {
                                actions.focusLayer(layer.id);
                                mapApi?.zoomToLayer?.(layer.id);
                                setOpenLayerId((current) =>
                                  current === layer.id ? null : layer.id
                                );
                              }}
                              type="button"
                            >
                              <span
                                className={`layers-tree__geometry ${geometryClass}`}
                                style={{ '--layer-color': layer.style?.color || layer.color }}
                              />
                              <span className="layers-tree__copy">
                                <span className="layers-tree__title-row">
                                  <strong title={layer.name}>{layer.name}</strong>
                                  <span
                                    className={`layers-tree__status-indicator${
                                      statusIndicatorClass
                                    }`}
                                  >
                                    <span className="layers-tree__status-dot" />
                                    {statusIndicatorLabel}
                                  </span>
                                </span>
                                <span className="layers-tree__subtitle">
                                  {subtitleText}
                                </span>
                              </span>
                              <span className={`layers-tree__accordion${isExpanded ? ' is-open' : ''}`}>
                                <svg
                                  aria-hidden="true"
                                  fill="none"
                                  height="16"
                                  viewBox="0 0 16 16"
                                  width="16"
                                  xmlns="http://www.w3.org/2000/svg"
                                >
                                  <path
                                    d="M4.5 6.5 8 10l3.5-3.5"
                                    stroke="currentColor"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth="1.7"
                                  />
                                </svg>
                              </span>
                            </button>
                          </div>

                          <div className="layers-tree__footer">
                            <span className="layers-tree__meta-row">
                              <span className="layers-tree__meta-chip is-success">
                                <span className="layers-tree__meta-dot" />
                                {metricSummary.progress}
                              </span>
                              <span
                                className={`layers-tree__meta-chip${
                                  isMetricsLoaded && metrics.riskCount > 0
                                    ? ' is-danger'
                                    : ' is-neutral'
                                }`}
                              >
                                <span className="layers-tree__meta-dot" />
                                {metricSummary.risk}
                              </span>
                              <span className="layers-tree__meta-chip is-info">
                                <span className="layers-tree__meta-dot" />
                                {metricSummary.total}
                              </span>
                            </span>
                          </div>
                        </div>

                        {isExpanded ? (
                          <div className="layers-tree__details">
                            <label className="slider-field slider-field--compact">
                              <span>Opacidad</span>
                              <strong>{Math.round((layer.style?.opacity || 0) * 100)}%</strong>
                              <input
                                max="1"
                                min="0.2"
                                onChange={(event) =>
                                  actions.updateLayerStyle(layer.id, {
                                    opacity: Number(event.target.value),
                                  })
                                }
                                step="0.05"
                                type="range"
                                value={layer.style?.opacity || 0.92}
                              />
                            </label>
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      <LayerStyleEditor
        layer={selectedLayer}
        onResetLayerStyle={actions.resetLayerStyle}
        onUpdateLayerStyle={actions.updateLayerStyle}
      />
    </div>
  );

  const renderBasemapsTab = () => (
    <div className="sidebar-panel sidebar-panel--stack">
      <div className="sidebar-panel__intro">
        <h3>Base maps</h3>
        <p>
          Cambia el mapa base sin reiniciar el mapa principal. La experiencia se
          mantiene persistente como en un software GIS.
        </p>
      </div>

      <div className="basemap-grid">
        {baseMaps.map((baseMap) => (
          <button
            className={`basemap-card${activeBaseMap.id === baseMap.id ? ' is-active' : ''}`}
            key={baseMap.id}
            onClick={() => actions.setActiveBaseMapId(baseMap.id)}
            type="button"
          >
            <img
              alt={`Vista previa ${baseMap.name}`}
              className="basemap-card__swatch"
              loading="lazy"
              src={baseMap.previewUrl}
            />
            <span className="basemap-card__content">
              <strong>{baseMap.name}</strong>
              <span>{baseMap.description}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );

  const renderDataTab = () => <FiltersPanel />;

  const renderUploadsTab = () => (
    <div className="sidebar-panel sidebar-panel--stack">
      <div className="sidebar-panel__intro">
        <h3>Subir capa</h3>
        <p>
          Importa capas temporales en formato GeoJSON. El historial de esta vista
          muestra únicamente capas cargadas por usuario.
        </p>
      </div>

      <input
        accept=".geojson,.json,application/geo+json,application/json"
        className="upload-panel__input"
        onChange={handleUploadChange}
        ref={fileInputRef}
        type="file"
      />

      <div className="upload-panel__hero">
        <div className="upload-panel__stats">
          <div className="mini-card mini-card--compact">
            <span className="mini-card__label">Capas subidas</span>
            <span className="mini-card__value">{uploadedLayers.length}</span>
          </div>
          <div className="mini-card mini-card--compact">
            <span className="mini-card__label">Formato</span>
            <span className="mini-card__value mini-card__value--small">GeoJSON</span>
          </div>
        </div>

        <button
          className="ghost-button ghost-button--accent upload-panel__button"
          disabled={isUploading}
          onClick={handleUploadClick}
          type="button"
        >
          {isUploading ? 'Cargando...' : 'Subir capa'}
        </button>
      </div>

      {uploadError ? (
        <div className="upload-panel__error">{uploadError}</div>
      ) : null}

      {uploadedLayers.length === 0 ? (
        <div className="empty-state empty-state--compact">
          <h3 className="empty-state__title">Sin capas subidas</h3>
          <p className="empty-state__text">
            Selecciona un archivo `.geojson` o `.json` para incorporarlo al mapa.
          </p>
        </div>
      ) : (
        <div className="upload-history">
          {uploadedLayers.map((layer) => {
            const isSelected = layer.id === selectedLayerId;
            const featureCount = layer.data?.features?.length || 0;

            return (
              <article
                className={`upload-history__item${isSelected ? ' is-selected' : ''}`}
                key={layer.id}
              >
                <div className="upload-history__head">
                  <span
                    className={`layers-tree__geometry ${getGeometryClass(
                      layer.geometryType
                    )}`}
                    style={{ '--layer-color': layer.style?.color || layer.color }}
                  />
                  <div className="upload-history__copy">
                    <strong>{layer.name}</strong>
                    <span>
                      {layer.geometryType} · {featureCount} elemento
                      {featureCount === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>

                <div className="upload-history__actions">
                  <button
                    className="ghost-button ghost-button--small"
                    onClick={() => actions.toggleLayerVisibility(layer.id)}
                    type="button"
                  >
                    {layer.visible ? 'Ocultar' : 'Mostrar'}
                  </button>
                  <button
                    className="ghost-button ghost-button--small lp-btn--danger"
                    onClick={() => actions.removeLayer(layer.id)}
                    type="button"
                  >
                    Eliminar
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <aside className="gis-sidebar" aria-label="Panel GIS izquierdo">
      <div className="gis-sidebar__header">
        <div>
          <span className="gis-sidebar__eyebrow">Explorer GIS</span>
          <h2 className="gis-sidebar__title">Navegador de proyecto</h2>
        </div>
      </div>

      <div className="gis-tabs" role="tablist" aria-label="Secciones del panel">
        {[
          ['layers', 'Capas'],
          ['basemaps', 'Base Maps'],
          ['uploads', 'Subir capa'],
          ['data', 'Filtros / Datos'],
        ].map(([value, label]) => (
          <button
            aria-selected={sidebarTab === value}
            className={`gis-tab${sidebarTab === value ? ' is-active' : ''}`}
            key={value}
            onClick={() => actions.setSidebarTab(value)}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      <div className="gis-sidebar__body">
        {sidebarTab === 'layers' ? renderLayersTab() : null}
        {sidebarTab === 'basemaps' ? renderBasemapsTab() : null}
        {sidebarTab === 'uploads' ? renderUploadsTab() : null}
        {sidebarTab === 'data' ? renderDataTab() : null}
      </div>
    </aside>
  );
}

export default LayersPanel;
