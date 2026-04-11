import { useGISWorkspace } from '../../app/GISWorkspaceContext';

const MEASURE_TOOLS = [
  {
    id: 'select',
    emoji: '👆',
    title: 'Seleccionar',
    desc: 'Toca un elemento para ver su detalle',
  },
  {
    id: 'measure-distance',
    emoji: '📏',
    title: 'Medir distancia',
    desc: 'Traza puntos para calcular distancia lineal',
  },
  {
    id: 'measure-area',
    emoji: '⬡',
    title: 'Medir área',
    desc: 'Cierra un polígono para calcular superficie',
  },
];

const DRAW_TOOLS = [
  {
    id: 'draw-point',
    emoji: '●',
    title: 'Punto',
    desc: 'Marca una ubicación puntual en el mapa',
  },
  {
    id: 'draw-line',
    emoji: '╱',
    title: 'Línea',
    desc: 'Traza un recorrido o frente de obra',
  },
  {
    id: 'draw-polygon',
    emoji: '▭',
    title: 'Polígono',
    desc: 'Delimita un área de intervención',
  },
];

function ToolCard({ tool, isActive, onClick }) {
  return (
    <button
      className={`tool-card${isActive ? ' is-active' : ''}`}
      onClick={onClick}
      type="button"
    >
      <span className="tool-card__emoji" aria-hidden="true">
        {tool.emoji}
      </span>
      <strong className="tool-card__title">{tool.title}</strong>
      <span className="tool-card__desc">{tool.desc}</span>
    </button>
  );
}

function MobileToolsPanel({ onClose }) {
  const { actions, drawItems, interactionMode, measurement } = useGISWorkspace();

  const activate = (toolId) => {
    actions.setInteractionMode(toolId);
    onClose();
  };

  const hasMeasurement = Boolean(measurement.summary);
  const hasDrawings = drawItems.length > 0;

  return (
    <div className="mobile-panel">
      <div className="tools-section">
        <span className="tools-section__label">Análisis</span>
        <div className="tools-grid">
          {MEASURE_TOOLS.map((tool) => (
            <ToolCard
              isActive={interactionMode === tool.id}
              key={tool.id}
              onClick={() => activate(tool.id)}
              tool={tool}
            />
          ))}
        </div>
      </div>

      <div className="tools-section">
        <span className="tools-section__label">Dibujo</span>
        <div className="tools-grid">
          {DRAW_TOOLS.map((tool) => (
            <ToolCard
              isActive={interactionMode === tool.id}
              key={tool.id}
              onClick={() => activate(tool.id)}
              tool={tool}
            />
          ))}
        </div>
      </div>

      {(hasMeasurement || hasDrawings) && (
        <div className="tools-results">
          {hasMeasurement && (
            <div className="tools-result-row">
              <span>Última medición</span>
              <strong>{measurement.summary}</strong>
            </div>
          )}
          {hasDrawings && (
            <div className="tools-result-row">
              <span>Dibujos activos</span>
              <strong>{drawItems.length}</strong>
            </div>
          )}
          <button
            className="ghost-button ghost-button--small"
            onClick={() => {
              actions.clearDrawings();
              onClose();
            }}
            type="button"
          >
            Limpiar todo
          </button>
        </div>
      )}
    </div>
  );
}

export default MobileToolsPanel;
