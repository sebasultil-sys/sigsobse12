import { useGISWorkspace } from '../../app/GISWorkspaceContext';

const GEOM_TYPES = [
  { icon: '●', label: 'Punto', desc: 'Ubicación puntual en el mapa' },
  { icon: '—', label: 'Línea', desc: 'Trayectos, rutas, corredores' },
  { icon: '▭', label: 'Polígono', desc: 'Áreas, zonas, superficies' },
];

function MobileMorePanel() {
  const { actions, activeBaseMap, baseMaps, layers } = useGISWorkspace();

  const visibleLayers = layers.filter((l) => l.visible);

  return (
    <div className="mobile-panel">
      {/* Mapa base */}
      <section className="more-section">
        <h3 className="more-section__title">Mapa base</h3>
        <div className="basemap-grid">
          {baseMaps.map((bm) => (
            <button
              className={`basemap-card${activeBaseMap.id === bm.id ? ' is-active' : ''}`}
              key={bm.id}
              onClick={() => actions.setActiveBaseMapId(bm.id)}
              type="button"
            >
              <img
                alt={`Vista previa ${bm.name}`}
                className="basemap-card__swatch"
                loading="lazy"
                src={bm.previewUrl}
              />
              <div className="basemap-card__content">
                <strong>{bm.name}</strong>
                <span>{bm.description}</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Leyenda dinámica */}
      <section className="more-section">
        <h3 className="more-section__title">Leyenda dinámica</h3>
        <div className="legend-geom">
          {GEOM_TYPES.map((g) => (
            <div className="legend-geom__row" key={g.label}>
              <span className="legend-geom__icon">{g.icon}</span>
              <div>
                <strong>{g.label}</strong>
                <span>{g.desc}</span>
              </div>
            </div>
          ))}
        </div>
        {visibleLayers.length > 0 ? (
          <div className="legend-layers">
            <span className="legend-layers__title">Capas activas</span>
            {visibleLayers.map((layer) => (
              <div className="legend-layer-row" key={layer.id}>
                <span
                  className="legend-color"
                  style={{ background: layer.style?.color || layer.color }}
                />
                <span>{layer.name}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="legend-empty">No hay capas visibles en el mapa</p>
        )}
      </section>

      {/* Sistema */}
      <section className="more-section">
        <h3 className="more-section__title">Sistema</h3>
        <button
          className="ghost-button ghost-button--small"
          onClick={actions.resetWorkspace}
          type="button"
        >
          Restablecer workspace
        </button>
      </section>
    </div>
  );
}

export default MobileMorePanel;
