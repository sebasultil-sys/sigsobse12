import React from 'react';
import { useGISWorkspace } from '../../app/GISWorkspaceContext';

function geomSymbol(geometryType) {
  if (geometryType === 'Point' || geometryType === 'MultiPoint') return '●';
  if (geometryType === 'LineString' || geometryType === 'MultiLineString') return '—';
  return '▭';
}

function getLayerDisplayName(layer) {
  return String(layer?.databaseDisplayName || layer?.name || 'Capa sin nombre')
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
    visibleLayerCount,
  } = useGISWorkspace();

  const groups = React.useMemo(() => {
    const map = new Map();
    layers.forEach((layer) => {
      const dg = layer.dg || 'Sin DG';
      if (!map.has(dg)) map.set(dg, []);
      map.get(dg).push(layer);
    });
    return map;
  }, [layers]);

  const toggleDG = (dg) =>
    setExpandedDGs((prev) => ({ ...prev, [dg]: !prev[dg] }));

  return (
    <div className="mobile-panel">
      <div className="lp-header">
        <div className="lp-stats">
          <span><strong>{visibleLayerCount}</strong> activas</span>
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
      </div>

      <div className="lp-groups">
        {[...groups.entries()].map(([dg, dgLayers]) => {
          const isExpanded = !!expandedDGs[dg];
          const visibleInGroup = dgLayers.filter((l) => l.visible).length;
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
                <span className="lp-group__chevron">
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
                <span className="lp-group__name">{dg}</span>
                <span className="lp-group__count">{visibleInGroup}/{dgLayers.length}</span>
                {hasRisk && <span className="lp-group__risk" />}
              </button>

              {isExpanded && (
                <div className="lp-group__body">
                  {dgLayers.map((layer) => {
                    const m = layerMetricsById.get(layer.id) || {};
                    const isRisk = (m.riskCount || 0) > 0;
                    const displayName = getLayerDisplayName(layer);

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
                            <strong title={displayName}>{displayName}</strong>
                            <span>
                              {layer.data?.features?.length || 0} elementos
                              {m.averageProgress != null ? ` · ${m.averageProgress}% avance` : ''}
                              {isRisk ? ` · ${m.riskCount} riesgo` : ''}
                            </span>
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
