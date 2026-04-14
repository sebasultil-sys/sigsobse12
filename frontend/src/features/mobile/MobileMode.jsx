import React from 'react';
import { useGISWorkspace } from '../../app/GISWorkspaceContext';
import MapView from '../map/MapView';
import BottomNav from './BottomNav';
import BottomSheet from './BottomSheet';
import MobileLayersPanel from './MobileLayersPanel';
import MobileSearchPanel from './MobileSearchPanel';
import MobileDashboardPanel from './MobileDashboardPanel';
import MobileToolsPanel from './MobileToolsPanel';
import MobileMorePanel from './MobileMorePanel';
import MobileFeatureCard from './MobileFeatureCard';
import MobileOnboarding, { shouldShowOnboarding } from './MobileOnboarding';
import AttributeTableSheet from './AttributeTableSheet';

const SHEET_META = {
  layers:    { title: 'Capas',              subtitle: 'Administra la información visible en el mapa' },
  search:    { title: 'Buscar',             subtitle: 'Obras por plantel, dirección, colonia o programa' },
  dashboard: { title: 'Indicadores',        subtitle: 'Avance, riesgos y semaforización' },
  tools:     { title: 'Herramientas',       subtitle: 'Medición, dibujo y análisis espacial' },
  more:      { title: 'Más',               subtitle: 'Leyenda, mapa base y guía de uso' },
  table:     { title: 'Tabla de atributos', subtitle: 'Explora y filtra los datos de la capa' },
};

function SearchIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 18 18" width="18" xmlns="http://www.w3.org/2000/svg">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.6" />
      <path d="m16 16-3.5-3.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  );
}

const SPLASH_DURATION_MS = 2200;

function MobileMode() {
  const [onboardingDone, setOnboardingDone] = React.useState(!shouldShowOnboarding());
  const [showSplash, setShowSplash] = React.useState(true);

  React.useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), SPLASH_DURATION_MS);
    return () => clearTimeout(timer);
  }, []);

  const {
    actions,
    isCompactViewport,
    mobileModeManual,
    mobileSheet,
    selectedFeature,
  } = useGISWorkspace();
  const showExitButton = mobileModeManual && !isCompactViewport;

  const handleNavSelect = (sheetId) => {
    if (mobileSheet === sheetId) {
      actions.closeMobileSheet();
    } else {
      actions.openMobileSheet(sheetId);
    }
  };

  const meta = SHEET_META[mobileSheet] || { title: '', subtitle: '' };

  // BUG-03: invalidateSize ya es manejado por MapView con múltiples timers
  // (100 ms, 300 ms, 600 ms) que incluyen mobileSheet y isCompactViewport en sus deps.
  // El effect adicional aquí causaba 4+ llamadas simultáneas al abrir un panel.
  // Se eliminó el effect redundante; MapView es la única fuente de verdad.

  let panelContent = null;
  if (mobileSheet === 'layers')    panelContent = <MobileLayersPanel />;
  if (mobileSheet === 'search')    panelContent = <MobileSearchPanel onClose={actions.closeMobileSheet} />;
  if (mobileSheet === 'dashboard') panelContent = <MobileDashboardPanel />;
  if (mobileSheet === 'tools')     panelContent = <MobileToolsPanel onClose={actions.closeMobileSheet} />;
  if (mobileSheet === 'more')      panelContent = <MobileMorePanel />;
  if (mobileSheet === 'table')     panelContent = <AttributeTableSheet />;

  return (
    <div
      className={`mobile-mode${
        isCompactViewport ? ' is-compact' : ' is-desktop-simulator'
      }`}
    >
      {!isCompactViewport && <div className="mobile-mode__backdrop" />}

      <section className="mobile-mode__device">
        {/* SPLASH — solo en primer montaje */}
        {showSplash && (
          <div className="mobile-splash" aria-hidden="true">
            <img
              alt=""
              className="mobile-splash__logo"
              src="/files/web/assets/img/corazon-snfondo.png"
            />
            <span className="mobile-splash__title">SIG SOBSE</span>
            <span className="mobile-splash__subtitle">Visor de obra pública</span>
            <div className="mobile-splash__dots">
              <span className="mobile-splash__dot" />
              <span className="mobile-splash__dot" />
              <span className="mobile-splash__dot" />
            </div>
          </div>
        )}

        {/* MAP — full screen, behind everything */}
        <div className="mobile-mode__map-shell">
          <MapView mode="mobile" />
        </div>

        {/* TOP BAR — Google Maps style */}
        <header className="mtopbar">
          <div className="mtopbar__brand">
            <img
              alt="Logo SOBSE"
              className="mtopbar__logo"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
              src="/files/web/assets/img/corazon-snfondo.png"
            />
            <span>SIG</span>
            <strong>SOBSE</strong>
          </div>

          {mobileSheet !== 'search' && (
            <button
              className="mtopbar__search"
              onClick={() => handleNavSelect('search')}
              type="button"
            >
              <SearchIcon />
              <span>Buscar plantel, colonia...</span>
            </button>
          )}

          {showExitButton && (
            <button
              className="mtopbar__exit"
              onClick={actions.exitMobileMode}
              type="button"
            >
              Salir
            </button>
          )}
        </header>

        {/* FEATURE CARD — Airbnb style, floats above bottom nav */}
        {selectedFeature && (
          <div className="mfc-wrap">
            <MobileFeatureCard />
          </div>
        )}

        {/* BOTTOM NAV */}
        <BottomNav activeItem={mobileSheet} onSelect={handleNavSelect} />

        {/* BOTTOM SHEET */}
        <BottomSheet
          isOpen={Boolean(mobileSheet)}
          onClose={actions.closeMobileSheet}
          subtitle={meta.subtitle}
          title={meta.title}
        >
          {panelContent}
        </BottomSheet>

        {/* ONBOARDING — first use */}
        {!onboardingDone && (
          <MobileOnboarding onDone={() => setOnboardingDone(true)} />
        )}
      </section>
    </div>
  );
}

export default MobileMode;
