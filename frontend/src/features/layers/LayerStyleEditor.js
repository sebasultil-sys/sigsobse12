const QUICK_COLORS = [
  '#691c32',
  '#0f766e',
  '#7c3aed',
  '#b45309',
  '#2563eb',
  '#dc2626',
  '#059669',
  '#374151',
];

function formatPercent(value) {
  return `${Math.round((value || 0) * 100)}%`;
}

function LayerStyleEditor({
  layer,
  onUpdateLayerStyle,
  onResetLayerStyle,
}) {
  if (!layer) return null;

  const geometryType = layer.geometryType || 'Unknown';
  const style = layer.style || {};
  const isPoint = geometryType === 'Point' || geometryType === 'MultiPoint';
  const isLine =
    geometryType === 'LineString' || geometryType === 'MultiLineString';
  const isPolygon =
    geometryType === 'Polygon' || geometryType === 'MultiPolygon';

  const updateStyle = (patch) => {
    onUpdateLayerStyle(layer.id, patch);
  };

  return (
    <section className="style-editor">
      <div className="style-editor__header">
        <div>
          <h3 className="style-editor__title">Simbología de capa</h3>
          <p className="style-editor__subtitle">
            Cambia color, trazo y presencia visual de la capa seleccionada.
          </p>
        </div>
        <button
          className="ghost-button ghost-button--small"
          onClick={() => onResetLayerStyle(layer.id)}
          type="button"
        >
          Restaurar
        </button>
      </div>

      <div className="style-editor__hero">
        <div
          className={`style-editor__preview style-editor__preview--${isPoint ? 'point' : isLine ? 'line' : 'polygon'}`}
          style={{
            '--preview-color': style.color,
            '--preview-opacity': style.opacity,
            '--preview-fill-opacity': style.fillOpacity,
            '--preview-weight': `${style.weight || 3}px`,
            '--preview-radius': `${style.pointRadius || 6}px`,
          }}
        >
          <span className={`style-editor__marker style-editor__marker--${style.markerKind || 'solid'}`} />
        </div>

        <div className="style-editor__hero-copy">
          <strong>{layer.name}</strong>
          <span>
            {geometryType} · {layer.data?.features?.length || 0} elementos
          </span>
        </div>
      </div>

      <div className="style-editor__section">
        <label className="field-label" htmlFor="layer-color-input">
          Color principal
        </label>
        <div className="style-editor__color-row">
          <input
            className="style-editor__color-input"
            id="layer-color-input"
            onChange={(event) => updateStyle({ color: event.target.value })}
            type="color"
            value={style.color || '#691c32'}
          />
          <div className="style-editor__swatches">
            {QUICK_COLORS.map((color) => (
              <button
                aria-label={`Usar color ${color}`}
                className={`style-editor__swatch${style.color === color ? ' is-active' : ''}`}
                key={color}
                onClick={() => updateStyle({ color })}
                style={{ backgroundColor: color }}
                type="button"
              />
            ))}
          </div>
        </div>
      </div>

      {isPoint ? (
        <div className="style-editor__section">
          <span className="field-label">Estilo del símbolo</span>
          <div className="segmented-control">
            {[
              ['solid', 'Sólido'],
              ['ring', 'Anillo'],
              ['soft', 'Suave'],
            ].map(([value, label]) => (
              <button
                className={`segmented-control__button${(style.markerKind || 'solid') === value ? ' is-active' : ''}`}
                key={value}
                onClick={() => updateStyle({ markerKind: value })}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {isLine || isPolygon ? (
        <div className="style-editor__section">
          <span className="field-label">Tipo de línea</span>
          <div className="segmented-control">
            {[
              ['solid', 'Continua'],
              ['dash', 'Segmentada'],
              ['dot', 'Punteada'],
            ].map(([value, label]) => (
              <button
                className={`segmented-control__button${(style.dashStyle || 'solid') === value ? ' is-active' : ''}`}
                key={value}
                onClick={() => updateStyle({ dashStyle: value })}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="style-editor__metrics">
        <label className="slider-field">
          <span>
            {isPoint ? 'Tamaño del punto' : 'Grosor del trazo'}
          </span>
          <strong>{isPoint ? style.pointRadius : style.weight}px</strong>
          <input
            max={isPoint ? '16' : '10'}
            min={isPoint ? '4' : '1'}
            onChange={(event) =>
              updateStyle({
                [isPoint ? 'pointRadius' : 'weight']: Number(event.target.value),
              })
            }
            step="1"
            type="range"
            value={isPoint ? style.pointRadius : style.weight}
          />
        </label>

        <label className="slider-field">
          <span>Opacidad general</span>
          <strong>{formatPercent(style.opacity)}</strong>
          <input
            max="1"
            min="0.2"
            onChange={(event) =>
              updateStyle({ opacity: Number(event.target.value) })
            }
            step="0.05"
            type="range"
            value={style.opacity}
          />
        </label>

        {isPolygon ? (
          <label className="slider-field">
            <span>Opacidad del relleno</span>
            <strong>{formatPercent(style.fillOpacity)}</strong>
            <input
              max="0.8"
              min="0"
              onChange={(event) =>
                updateStyle({ fillOpacity: Number(event.target.value) })
              }
              step="0.05"
              type="range"
              value={style.fillOpacity}
            />
          </label>
        ) : null}
      </div>
    </section>
  );
}

export default LayerStyleEditor;
