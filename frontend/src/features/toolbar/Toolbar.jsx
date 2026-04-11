import { useGISWorkspace } from '../../app/GISWorkspaceContext';

const TOOLBAR_ITEMS = [
  {
    id: 'zoom-in',
    group: 'navigation',
    label: 'Zoom +',
    hint: 'Acercar',
  },
  {
    id: 'zoom-out',
    group: 'navigation',
    label: 'Zoom -',
    hint: 'Alejar',
  },
  {
    id: 'reset-view',
    group: 'navigation',
    label: 'Reset vista',
    hint: 'Ver todo',
  },
  {
    id: 'measure-distance',
    group: 'analysis',
    label: 'Medir distancia',
    hint: 'Trazo lineal',
  },
  {
    id: 'measure-area',
    group: 'analysis',
    label: 'Medir área',
    hint: 'Polígono',
  },
  {
    id: 'select',
    group: 'selection',
    label: 'Seleccionar',
    hint: 'Ver detalle',
  },
  {
    id: 'clear',
    group: 'selection',
    label: 'Limpiar',
    hint: 'Borra selección',
  },
  {
    id: 'fullscreen',
    group: 'navigation',
    label: 'Fullscreen',
    hint: 'Pantalla completa',
  },
  {
    id: 'mobile-mode',
    group: 'navigation',
    label: 'Modo móvil',
    hint: 'Vista app',
  },
];

function Toolbar() {
  const {
    actions,
    interactionMode,
    isCompactViewport,
    isMobileModeActive,
    mapApi,
    measurement,
    selectedFeature,
  } = useGISWorkspace();

  const handleAction = (actionId) => {
    if (actionId === 'zoom-in') {
      mapApi?.zoomIn?.();
      return;
    }

    if (actionId === 'zoom-out') {
      mapApi?.zoomOut?.();
      return;
    }

    if (actionId === 'reset-view') {
      mapApi?.resetView?.();
      return;
    }

    if (actionId === 'fullscreen') {
      mapApi?.toggleFullscreen?.();
      return;
    }

    if (actionId === 'clear') {
      actions.clearSelectionAndTools();
      return;
    }

    if (actionId === 'mobile-mode') {
      actions.toggleMobileMode();
      return;
    }

    actions.setInteractionMode(actionId);
  };

  return (
    <section className="gis-toolbar" aria-label="Herramientas GIS">
      <div className="gis-toolbar__group">
        {TOOLBAR_ITEMS.map((item) => {
          const isActive =
            interactionMode === item.id ||
            (item.id === 'mobile-mode' && isMobileModeActive);
          const isDisabled =
            !mapApi &&
            ['zoom-in', 'zoom-out', 'reset-view', 'fullscreen'].includes(
              item.id
            );

          return (
            <button
              className={`gis-tool${isActive ? ' is-active' : ''}`}
              disabled={isDisabled}
              key={item.id}
              onClick={() => handleAction(item.id)}
              type="button"
            >
              <span className="gis-tool__label">{item.label}</span>
              <span className="gis-tool__hint">{item.hint}</span>
            </button>
          );
        })}
      </div>

      <div className="gis-toolbar__status">
        <div className="gis-toolbar__badge">
          <span>Modo</span>
          <strong>
            {interactionMode === 'select'
              ? 'Selección'
              : interactionMode === 'measure-distance'
                ? 'Medición lineal'
                : interactionMode === 'measure-area'
                  ? 'Medición poligonal'
                  : 'Exploración'}
          </strong>
        </div>
        <div className="gis-toolbar__badge">
          <span>Selección</span>
          <strong>{selectedFeature ? 'Activa' : 'Sin elemento'}</strong>
        </div>
        <div className="gis-toolbar__badge">
          <span>Medición</span>
          <strong>{measurement.summary || 'Sin trazo'}</strong>
        </div>
        <div className="gis-toolbar__badge">
          <span>Vista</span>
          <strong>
            {isCompactViewport
              ? 'Mobile auto'
              : isMobileModeActive
                ? 'Mobile simulada'
                : 'Desktop GIS'}
          </strong>
        </div>
      </div>
    </section>
  );
}

export default Toolbar;
