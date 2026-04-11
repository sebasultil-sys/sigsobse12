import { useGISWorkspace } from '../../app/GISWorkspaceContext';

const DRAW_TOOLS = [
  {
    id: 'draw-point',
    title: 'Punto',
    description: 'Marca una ubicación puntual en el mapa.',
  },
  {
    id: 'draw-line',
    title: 'Línea',
    description: 'Dibuja un trazo para recorridos o frentes.',
  },
  {
    id: 'draw-polygon',
    title: 'Polígono',
    description: 'Delimita áreas de trabajo o intervención.',
  },
];

function MobileDrawPanel({ onClose }) {
  const { actions, drawItems, interactionMode } = useGISWorkspace();

  return (
    <div className="mobile-panel">
      <div className="mobile-tool-grid">
        {DRAW_TOOLS.map((tool) => (
          <button
            className={`mobile-tool-card${
              interactionMode === tool.id ? ' is-active' : ''
            }`}
            key={tool.id}
            onClick={() => {
              actions.setInteractionMode(tool.id);
              onClose();
            }}
            type="button"
          >
            <strong>{tool.title}</strong>
            <span>{tool.description}</span>
          </button>
        ))}
      </div>

      <div className="mobile-panel__footer">
        <div className="mini-card mini-card--compact">
          <span className="mini-card__label">Dibujos</span>
          <span className="mini-card__value">{drawItems.length}</span>
        </div>
        <button
          className="ghost-button ghost-button--small"
          onClick={() => {
            actions.clearDrawings();
            onClose();
          }}
          type="button"
        >
          Borrar dibujo
        </button>
      </div>
    </div>
  );
}

export default MobileDrawPanel;
