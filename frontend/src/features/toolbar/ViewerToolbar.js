function ViewerToolbar({ hasLayers, onResetWorkspace }) {
  return (
    <section className="panel-card">
      <div className="panel-card__header">
        <div>
          <h2 className="panel-card__title">Herramientas</h2>
          <div className="panel-card__meta">
            Base nueva sin migrar lógica legacy.
          </div>
        </div>
      </div>

      <div className="panel-card__body">
        <div className="toolbar-grid">
          <button className="control-button control-button--accent" disabled>
            <span className="control-button__label">Importar capas</span>
            <span className="control-button__hint">
              La siguiente etapa reabre la carga dinámica.
            </span>
          </button>

          <button className="control-button" disabled>
            <span className="control-button__label">Semillas</span>
            <span className="control-button__hint">
              Quedará separado del visor principal.
            </span>
          </button>

          <button className="control-button" disabled>
            <span className="control-button__label">Análisis</span>
            <span className="control-button__hint">
              Se reconecta después del mapa base.
            </span>
          </button>

          <button
            className="control-button"
            disabled={!hasLayers}
            onClick={onResetWorkspace}
            type="button"
          >
            <span className="control-button__label">Restablecer</span>
            <span className="control-button__hint">
              Vuelve al catálogo curado inicial.
            </span>
          </button>
        </div>
      </div>
    </section>
  );
}

export default ViewerToolbar;
