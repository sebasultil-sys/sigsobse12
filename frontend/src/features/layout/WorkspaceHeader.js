function WorkspaceHeader({
  activeBaseMapName,
  filteredFeatureCount,
  layerCount,
  visibleLayerCount,
}) {
  return (
    <header className="workspace-header">
      {/* ── Brand ─────────────────────────────────────────────── */}
      <div className="workspace-header__brand">
        <div className="workspace-header__logo-wrap" aria-hidden="true">
          <img
            src="/web/assets/img/corazon-snfondo.png"
            alt="SOBSE"
            className="workspace-header__logo-img"
            onError={(e) => {
              e.target.style.display = 'none';
              e.target.nextSibling.style.display = 'flex';
            }}
          />
          <span className="workspace-header__logo-fallback" aria-hidden="true">
            SG
          </span>
        </div>

        <div className="workspace-header__brand-copy">
          <span className="workspace-header__eyebrow">
            Secretaría de Obras y Servicios · CDMX
          </span>
          <h1 className="workspace-header__title">SIG-SOBSE</h1>
          <p className="workspace-header__subtitle">
            Sistema Institucional de Información Geoespacial
          </p>
        </div>
      </div>

      {/* ── KPI Chips ─────────────────────────────────────────── */}
      <div className="workspace-header__stats">
        <div className="stat-pill">
          <span className="stat-pill__label">Capas activas</span>
          <span className="stat-pill__value">{visibleLayerCount}</span>
        </div>
        <div className="stat-pill">
          <span className="stat-pill__label">Catálogo</span>
          <span className="stat-pill__value">{layerCount}</span>
        </div>
        <div className="stat-pill">
          <span className="stat-pill__label">Registros</span>
          <span className="stat-pill__value">{filteredFeatureCount}</span>
        </div>
        <div className="stat-pill">
          <span className="stat-pill__label">Base map</span>
          <span className="stat-pill__value stat-pill__value--small">
            {activeBaseMapName}
          </span>
        </div>
      </div>

      {/* ── Avatar ───────────────────────────────────────────── */}
      <div className="workspace-header__avatar" aria-label="Usuario" title="Usuario">
        <span className="workspace-header__avatar-initials">DG</span>
      </div>
    </header>
  );
}

export default WorkspaceHeader;
