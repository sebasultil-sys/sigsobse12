import React from 'react';
import { useGISWorkspace } from '../../app/GISWorkspaceContext';
import { getLayerStatus } from '../layers/layerStatus';
import { getLayerGroupLabel, orderLayerGroupEntries } from '../layers/layerGroups';
import { getLayerIcon } from '../../config/layerIcons';

// Símbolo de geometría de reserva cuando no hay icono personalizado
function geomSymbol(geometryType) {
  if (geometryType === 'Point' || geometryType === 'MultiPoint') return '●';
  if (geometryType === 'LineString' || geometryType === 'MultiLineString') return '—';
  return '▭';
}

// Muestra el icono PNG si existe, o el símbolo de geometría en color de la capa
function LayerIcon({ layer }) {
  const iconUrl = getLayerIcon(layer.name);
  if (iconUrl) {
    return (
      <img
        alt=""
        className="lp-layer__icon"
        onError={(e) => { e.currentTarget.style.display = 'none'; }}
        src={iconUrl}
      />
    );
  }
  return (
    <span
      className="lp-layer__sym"
      style={{ color: layer.style?.color || layer.color }}
    >
      {geomSymbol(layer.geometryType)}
    </span>
  );
}

function getLayerDisplayName(layer) {
  return String(layer?.databaseDisplayName || layer?.name || 'Capa sin nombre')
    .split(/\s+-\s+/)[0]
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function LayerToggle({ checked, label, onChange }) {
  return (
    <label
      className={`lp-toggle${checked ? ' is-on' : ''}`}
    >
      <input
        aria-label={label}
        checked={checked}
        className="lp-toggle__input"
        onChange={onChange}
        type="checkbox"
      />
      <span className="lp-toggle__label">{checked ? 'ON' : 'OFF'}</span>
    </label>
  );
}

function MobileLayersPanel() {
  const [expandedDGs, setExpandedDGs] = React.useState({});

  const {
    actions,
    layerMetricsById,
    layers,
    mapViewportBounds,
    visibleLayerCount,
  } = useGISWorkspace();

  const groups = React.useMemo(() => {
    const map = new Map();
    layers.forEach((layer) => {
      const dg = layer.dg || 'Sin DG';
      if (!map.has(dg)) map.set(dg, []);
      map.get(dg).push(layer);
    });
    return orderLayerGroupEntries([...map.entries()]);
  }, [layers]);

  const layerStatusById = React.useMemo(() => {
    const statusMap = new Map();

    layers.forEach((layer) => {
      statusMap.set(
        layer.id,
        getLayerStatus(layer, mapViewportBounds, layerMetricsById.get(layer.id))
      );
    });

    return statusMap;
  }, [layerMetricsById, layers, mapViewportBounds]);

  const summary = React.useMemo(() => {
    return layers.reduce(
      (acc, layer) => {
        const status = layerStatusById.get(layer.id);
        if (layer.loadStatus === 'loaded' || (!layer.databaseLayer && (layer.data?.features?.length || 0) > 0)) {
          acc.loaded += 1;
        }
        if (layer.loadStatus === 'loading') acc.loading += 1;
        if (status?.tone === 'waiting') acc.waiting += 1;
        return acc;
      },
      { loaded: 0, loading: 0, waiting: 0 }
    );
  }, [layerStatusById, layers]);

  const toggleDG = (dg) =>
    setExpandedDGs((prev) => ({ ...prev, [dg]: !prev[dg] }));

  return (
    <div className="mobile-panel">
      <div className="lp-header">
        <div className="lp-stats lp-stats--rich">
          <span><strong>{visibleLayerCount}</strong> activas</span>
          <span><strong>{summary.loaded}</strong> cargadas</span>
          <span><strong>{summary.loading}</strong> cargando</span>
          <span><strong>{layers.length}</strong> total</span>
        </div>
        <div className="lp-actions">
          <button className="lp-action-btn" onClick={() => actions.setAllLayersVisible(true)} type="button">
            Encender todas
          </button>
          <button className="lp-action-btn" onClick={() => actions.setAllLayersVisible(false)} type="button">
            Apagar todas
          </button>
        </div>
        {summary.waiting > 0 && (
          <div className="lp-panel-note">
            {summary.waiting} capa{summary.waiting !== 1 ? 's' : ''} se cargarán al entrar a su zona
          </div>
        )}
      </div>

      <div className="lp-groups">
        {groups.map(([dg, dgLayers]) => {
          const isExpanded = !!expandedDGs[dg];
          const visibleInGroup = dgLayers.filter((l) => l.visible).length;
          const loadingInGroup = dgLayers.filter(
            (l) => l.loadStatus === 'loading'
          ).length;
          const hasRisk = dgLayers.some(
            (l) => (layerMetricsById.get(l.id)?.riskCount || 0) > 0
          );

          return (
            <div className="lp-group" key={dg}>
              <button
                className={`lp-group__head${isExpanded ? ' is-open' : ''}${hasRisk ? ' has-risk' : ''}`}
                onClick={() => toggleDG(dg)}
                type="button"
              >
                <span className={`lp-group__chevron${isExpanded ? ' is-open' : ''}`}>
                  <svg fill="none" height="14" viewBox="0 0 14 14" width="14" xmlns="http://www.w3.org/2000/svg">
                    <path
                      d={isExpanded ? 'M3 5l4 4 4-4' : 'M5 3l4 4-4 4'}
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.6"
                    />
                  </svg>
                </span>
                <span className="lp-group__name">{getLayerGroupLabel(dg)}</span>
                {loadingInGroup > 0 && (
                  <span className="lp-group__meta">{loadingInGroup} cargando</span>
                )}
                <span className="lp-group__count">{visibleInGroup}/{dgLayers.length}</span>
                {hasRisk && <span className="lp-group__risk" />}
              </button>

              {isExpanded && (
                <div className="lp-group__body">
                  {dgLayers.map((layer) => {
                    const metrics = layerMetricsById.get(layer.id) || {};
                    const status = layerStatusById.get(layer.id);
                    const isRisk = (metrics.riskCount || 0) > 0;
                    const displayName = getLayerDisplayName(layer);

                    return (
                      <div
                        className={`lp-layer${isRisk ? ' is-risk' : ''}`}
                        key={layer.id}
                      >
                        <div className="lp-layer__main">
                          <LayerIcon layer={layer} />
                          <div className="lp-layer__info">
                            <strong title={displayName}>{displayName}</strong>
                            <div className="lp-layer__meta">
                              <span>{status?.detail}</span>
                            </div>
                          </div>
                          <LayerToggle
                            checked={layer.visible}
                            label={`${layer.visible ? 'Apagar' : 'Encender'} ${displayName}`}
                            onChange={() => actions.toggleLayerVisibility(layer.id)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default MobileLayersPanel;
