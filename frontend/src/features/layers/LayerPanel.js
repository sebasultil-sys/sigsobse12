import React from 'react';
import LayerStyleEditor from './LayerStyleEditor';

function LayerPanel({
  layers,
  selectedLayerId,
  onSelectLayer,
  onToggleLayer,
  onShowOnlyLayer,
  onSetAllLayersVisible,
  onUpdateLayerStyle,
  onResetLayerStyle,
}) {
  const [query, setQuery] = React.useState('');
  const selectedLayer =
    layers.find((layer) => layer.id === selectedLayerId) || null;
  const visibleCount = layers.filter((layer) => layer.visible).length;
  const filteredLayers = React.useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return layers;

    return layers.filter((layer) => {
      const haystack = `${layer.name} ${layer.source} ${layer.geometryType}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [layers, query]);

  const hasHiddenLayers = visibleCount < layers.length;
  const hasVisibleLayers = visibleCount > 0;

  return (
    <section className="panel-card">
      <div className="panel-card__header">
        <div>
          <h2 className="panel-card__title">Capas</h2>
          <div className="panel-card__meta">
            Catálogo inicial curado para arrancar el mapa.
          </div>
        </div>
      </div>

      <div className="panel-card__body">
        <div className="layer-toolbar">
          <div className="layer-toolbar__stats">
            <div className="layer-toolbar__stat">
              <span>Total</span>
              <strong>{layers.length}</strong>
            </div>
            <div className="layer-toolbar__stat">
              <span>Encendidas</span>
              <strong>{visibleCount}</strong>
            </div>
          </div>

          <div className="layer-toolbar__actions">
            <button
              className="ghost-button ghost-button--small"
              disabled={!hasHiddenLayers}
              onClick={() => onSetAllLayersVisible(true)}
              type="button"
            >
              Encender todas
            </button>
            <button
              className="ghost-button ghost-button--small"
              disabled={!hasVisibleLayers}
              onClick={() => onSetAllLayersVisible(false)}
              type="button"
            >
              Apagar todas
            </button>
          </div>
        </div>

        <label className="layer-search">
          <span className="field-label">Buscar capa</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ej. ciclovía, utopías, puntos..."
            type="text"
            value={query}
          />
        </label>

        {layers.length === 0 ? (
          <div className="empty-state">
            <h3 className="empty-state__title">Sin capas cargadas</h3>
            <p className="empty-state__text">
              Se retiraron las capas de ejemplo. Desde aquí vamos a reconectar
              solo las capas nuevas que sí se queden en la versión actual.
            </p>
            <ul className="stack-list">
              <li>Capas base publicadas</li>
              <li>Capas SIG-SOBSE vigentes</li>
              <li>Importaciones temporales del usuario</li>
            </ul>
          </div>
        ) : filteredLayers.length === 0 ? (
          <div className="empty-state">
            <h3 className="empty-state__title">Sin coincidencias</h3>
            <p className="empty-state__text">
              Ajusta tu búsqueda para volver a ver las capas disponibles.
            </p>
          </div>
        ) : (
          <div className="layer-panel__content">
            <ul className="layer-list">
              {filteredLayers.map((layer) => {
              const isSelected = layer.id === selectedLayerId;
              const featureCount = layer.data?.features?.length || 0;
              const isPoint =
                layer.geometryType === 'Point' ||
                layer.geometryType === 'MultiPoint';
              const isLine =
                layer.geometryType === 'LineString' ||
                layer.geometryType === 'MultiLineString';

              return (
                <li
                  className={`layer-row${isSelected ? ' is-selected' : ''}`}
                  key={layer.id}
                >
                  <button
                    className="ghost-button"
                    onClick={() => onSelectLayer(layer.id)}
                    type="button"
                  >
                    {isSelected ? 'Activa' : 'Abrir'}
                  </button>

                  <div className="layer-row__info">
                    <span className="layer-row__name">
                      <span className="layer-row__geometry">
                        <span
                          className={`layer-row__swatch${isLine ? ' is-line' : ''}${!isLine && !isPoint ? ' is-polygon' : ''}`}
                          style={{ backgroundColor: layer.style?.color || layer.color }}
                        />
                      </span>
                      {layer.name}
                    </span>
                    <span className="layer-row__status">
                      {layer.visible ? 'Visible' : 'Oculta'} · {featureCount}{' '}
                      elementos · {layer.geometryType}
                    </span>
                  </div>

                  <div className="layer-row__actions">
                    <button
                      className="ghost-button ghost-button--small"
                      onClick={() => onShowOnlyLayer(layer.id)}
                      type="button"
                    >
                      Solo
                    </button>
                    <button
                      className={`toggle${layer.visible ? ' is-on' : ''}`}
                      onClick={() => onToggleLayer(layer.id)}
                      type="button"
                    />
                  </div>
                </li>
              );
              })}
            </ul>

            <LayerStyleEditor
              layer={selectedLayer}
              onResetLayerStyle={onResetLayerStyle}
              onUpdateLayerStyle={onUpdateLayerStyle}
            />
          </div>
        )}
      </div>
    </section>
  );
}

export default LayerPanel;
