import React from 'react';
import { useGISWorkspace } from '../../app/GISWorkspaceContext';
import {
  firstPropertyEntry,
  formatCoordinatePair,
  formatCurrency,
  formatDateValue,
  formatFieldValue,
  formatPercent,
  formatSignedDifference,
  getTableroLink,
  normalizeYear,
  parseNumericValue,
  renderField,
} from './featureDetailUtils';

// SEC-01: Valida que un href sea una URL http/https segura antes de renderizarla.
// Previene javascript: URIs provenientes de propiedades GeoJSON de la BD.
function isSafeUrl(value) {
  if (!value || typeof value !== 'string') return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

const TITLE_KEYS = [
  'OBRA',
  'obra',
  'NOMBRE_OBRA',
  'nombre_obra',
  'NOMBRE DEL SITIO INTERVENIDO',
  'NOMBRE DEL SITIO INTERVENIDO ',
  'NOMBRE_SITIO_INTERVENIDO',
  'nombre del sitio intervenido',
  'nombre_sitio_intervenido',
  'PLANTEL',
  'plantel',
  'NOMBRE_PLANTEL',
  'nombre_plantel',
  'G_NOMBRE',
  'g_nombre',
  'F_FRENTE',
  'FRENTE',
  'frente',
];

const AVANCE_REAL_KEYS = [
  'F_AV_REAL',
  'AV_REAL',
  'AVANCE_REAL',
  'avance_real',
  'AVANCE',
  'avance',
  'PORC_AVANCE',
  'porc_avance',
];

const AVANCE_PROGRAMADO_KEYS = [
  'F_AV_PRO',
  'AV_PRO',
  'AVANCE_PROGRAMADO',
  'avance_programado',
  'PORC_PROG',
  'porc_prog',
  'AVANCE_PROG',
  'avance_prog',
];

const ESTATUS_KEYS = ['F_ESTATUS', 'ESTATUS', 'estatus', 'ESTADO', 'estado'];
const OBSERVACIONES_KEYS = [
  'F_OBS',
  'OBSERVACIONES',
  'observaciones',
  'OBSERVACION',
  'observacion',
  'OBS',
  'obs',
];
const RIESGO_KEYS = ['RIESGO', 'riesgo'];

const GENERAL_FIELD_CONFIGS = [
  {
    label: 'Dirección General',
    keys: ['DG', 'dg', 'DIRECCION GENERAL', 'DIRECCION_GENERAL', 'direccion general', 'direccion_general'],
  },
  {
    label: 'Programa',
    keys: ['PROGRAMA', 'programa'],
  },
  {
    label: 'Año',
    keys: ['R_YEAR', 'YEAR', 'year', 'ANIO', 'anio', 'AÑO', 'año'],
    format: normalizeYear,
  },
  {
    label: 'Origen del compromiso',
    keys: ['R_O_COMPR', 'ORIGEN_COMPROMISO', 'origen_compromiso', 'ORIGEN DEL COMPROMISO', 'origen del compromiso'],
  },
  {
    label: 'Tipo',
    keys: ['G_TIPO', 'TIPO', 'tipo', 'TIPO_OBRA', 'tipo_obra'],
  },
  {
    label: 'Subtipo',
    keys: ['G_SUBTIPO', 'SUBTIPO', 'subtipo'],
  },
];

const CONTRACT_FIELD_CONFIGS = [
  {
    label: 'Número de contrato',
    keys: ['CONTRATO', 'N_CONTRATO', 'NO_CONTRATO', 'NUM_CONTRATO', 'contrato', 'F_CONTRATO', 'F_CONTRAT'],
  },
  {
    label: 'Empresa',
    keys: ['EMPRESA', 'N_EMPRESA', 'CONTRATISTA', 'empresa', 'contratista', 'F_EMPRESA'],
  },
  {
    label: 'Monto',
    keys: [
      'MONTO',
      'monto',
      'IMPORTE',
      'importe',
      'PRESUPUESTO',
      'presupuesto',
      'INVERSION',
      'inversion',
      'COSTO',
      'costo',
      'MONTO_TOTAL',
      'monto_total',
      'MONTO_CONTRATO',
      'monto_contrato',
      'F_MONTO',
    ],
    format: (value) => formatCurrency(value) || formatFieldValue(value),
  },
  {
    label: 'Fecha de inicio',
    keys: ['FECHA_INICIO', 'fecha_inicio', 'INICIO_CONTRATO', 'inicio_contrato', 'FECHA_IN', 'F_FECHA_IN'],
    format: formatDateValue,
  },
  {
    label: 'Fecha de término',
    keys: ['FECHA_TERMINO', 'fecha_termino', 'TERMINO_CONTRATO', 'termino_contrato', 'FECHA_TE', 'F_FECHA_TE'],
    format: formatDateValue,
  },
];

const GEOGRAPHIC_FIELD_CONFIGS = [
  {
    label: 'Calle',
    keys: ['G_CALLE', 'CALLE', 'calle', 'DIRECCION', 'direccion', 'DIRECCIÓN', 'dirección', 'DOMICILIO', 'domicilio'],
  },
  {
    label: 'Entre calles',
    keys: ['G_ENTRE_CA', 'ENTRE CALLE', 'ENTRE_CALLE', 'entre calle', 'entre_calle', 'ENTRE_CALLES', 'entre_calles'],
  },
  {
    label: 'Alcaldía',
    keys: ['G_ALCALDIA', 'ALCALDIA', 'alcaldia', 'ALCALDÍA', 'alcaldía'],
  },
];

const GOOGLE_MAPS_KEYS = [
  'G_URL_GM',
  'URL_GOOGLE_MAPS',
  'url_google_maps',
  'URL_GM',
  'url_gm',
  'GOOGLE_MAPS',
  'google_maps',
];

const LATITUDE_KEYS = ['G_Y', 'LAT', 'LATITUD', 'lat', 'latitud', 'Y'];
const LONGITUDE_KEYS = ['G_X', 'LON', 'LONGITUD', 'LONG', 'lng', 'X'];

function resolveField(properties, config) {
  const entry = firstPropertyEntry(properties, config.keys);
  if (!entry) return null;

  const value =
    typeof config.format === 'function'
      ? config.format(entry.value, properties)
      : formatFieldValue(entry.value);

  if (value === null || value === undefined || value === '') return null;

  return {
    label: config.label,
    value,
  };
}

function collectFields(properties, configs) {
  return configs.reduce((accumulator, config) => {
    const field = resolveField(properties, config);
    if (field) accumulator.push(field);
    return accumulator;
  }, []);
}

function findFirstCoordinatePair(value) {
  if (!Array.isArray(value)) return null;

  if (
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  ) {
    return value;
  }

  for (const item of value) {
    const match = findFirstCoordinatePair(item);
    if (match) return match;
  }

  return null;
}

function getRepresentativeCoordinates(feature) {
  const pair = findFirstCoordinatePair(feature?.geometry?.coordinates);
  if (!pair) return null;

  return {
    lng: pair[0],
    lat: pair[1],
  };
}

function resolveCoordinates(properties, feature) {
  const latitudeEntry = firstPropertyEntry(properties, LATITUDE_KEYS);
  const longitudeEntry = firstPropertyEntry(properties, LONGITUDE_KEYS);

  if (latitudeEntry && longitudeEntry) {
    const value = formatCoordinatePair(latitudeEntry.value, longitudeEntry.value);
    if (!value) return null;

    return {
      label: 'Coordenadas',
      value,
      coords: {
        lat: parseNumericValue(latitudeEntry.value),
        lng: parseNumericValue(longitudeEntry.value),
      },
    };
  }

  const geometryCoords = getRepresentativeCoordinates(feature);
  if (!geometryCoords) return null;

  return {
    label: 'Coordenadas',
    value: formatCoordinatePair(geometryCoords.lat, geometryCoords.lng),
    coords: geometryCoords,
  };
}

function resolveGoogleMapsField(properties, coords) {
  const entry = firstPropertyEntry(properties, GOOGLE_MAPS_KEYS);
  const href = formatFieldValue(entry?.value);

  // SEC-01: solo usar href si es una URL http/https válida
  if (href && isSafeUrl(href)) {
    return {
      label: 'Google Maps',
      value: (
        <a
          className="map-button"
          href={href}
          rel="noopener noreferrer"
          target="_blank"
        >
          Ver ubicación
        </a>
      ),
    };
  }

  if (!Number.isFinite(coords?.lat) || !Number.isFinite(coords?.lng)) {
    return null;
  }

  return {
    label: 'Google Maps',
    value: (
      <a
        className="map-button"
        href={`https://www.google.com/maps?q=${coords.lat},${coords.lng}`}
        rel="noopener noreferrer"
        target="_blank"
      >
        Ver ubicación
      </a>
    ),
  };
}

function getStatusTone({ diferencia, estatus, isRisk }) {
  if (isRisk) return 'risk';
  if (Number.isFinite(diferencia) && diferencia < 0) return 'warn';
  if (String(estatus || '').match(/terminad|concluid|finaliz/i)) return 'good';
  return 'neutral';
}

function Section({ children, hasContent, title, variant = '' }) {
  if (!hasContent) return null;

  return (
    <div className={`info-section${variant ? ` ${variant}` : ''}`}>
      <h3 className="section-title">{title}</h3>
      <div className="info-grid">{children}</div>
    </div>
  );
}

function getProgressColor(pct) {
  if (pct === 100) return '#16a34a'; // verde — terminado
  if (pct > 70)   return '#eab308'; // amarillo — avance alto
  if (pct > 30)   return '#f97316'; // naranja — en proceso
  return '#dc2626';                  // rojo — inicio o sin avance
}

function ProgressBar({ value }) {
  if (!Number.isFinite(value)) return null;

  const pct   = Math.min(100, Math.max(0, value));
  const color = getProgressColor(pct);

  return (
    <div className="avance-box">
      <div className="avance-box__header">
        <span>Avance</span>
        <strong style={{ color }}>{formatPercent(value)}</strong>
      </div>
      <div className="avance-box__barra">
        <div
          className="avance-box__fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

function MobileFeatureCard() {
  const { actions, selectedFeature } = useGISWorkspace();
  const [shareToast, setShareToast] = React.useState(false);
  const panelRef = React.useRef(null);

  // Ref estable para acceder a actions dentro de efectos sin stale closure
  const actionsRef = React.useRef(actions);
  React.useEffect(() => { actionsRef.current = actions; });

  const properties = React.useMemo(
    () => selectedFeature?.properties || null,
    [selectedFeature]
  );
  const safeProperties = React.useMemo(() => properties || {}, [properties]);
  const tableroLink = getTableroLink(safeProperties);

  // SEC-01: validar tableroLink antes de usarlo como href
  const safeTableroLink = isSafeUrl(tableroLink) ? tableroLink : null;

  // Cerrar el panel completamente cuando se hace tap en el mapa fuera de él
  React.useEffect(() => {
    const handlePanelDismiss = () => {
      actionsRef.current.clearSelectionAndTools();
    };

    window.addEventListener('gis-detail-panel-dismiss', handlePanelDismiss);

    return () => {
      window.removeEventListener('gis-detail-panel-dismiss', handlePanelDismiss);
    };
  }, []);

  React.useEffect(() => {
    if (!selectedFeature || process.env.NODE_ENV === 'production') return;

    console.log('DATA OBRA:', safeProperties);
    console.log('TABLERO LINK:', tableroLink, safeProperties);
  }, [safeProperties, selectedFeature, tableroLink]);

  if (!selectedFeature) return null;

  const title =
    formatFieldValue(firstPropertyEntry(safeProperties, TITLE_KEYS)?.value) ||
    formatFieldValue(selectedFeature.layerName) ||
    'Sin nombre';
  const layerLabel = formatFieldValue(selectedFeature.layerName) || 'Detalle de obra';
  const estatus = formatFieldValue(firstPropertyEntry(safeProperties, ESTATUS_KEYS)?.value);
  const observaciones = formatFieldValue(
    firstPropertyEntry(safeProperties, OBSERVACIONES_KEYS)?.value
  );
  const avanceReal = parseNumericValue(
    firstPropertyEntry(safeProperties, AVANCE_REAL_KEYS)?.value
  );
  const avanceProgramado = parseNumericValue(
    firstPropertyEntry(safeProperties, AVANCE_PROGRAMADO_KEYS)?.value
  );
  const diferencia =
    Number.isFinite(avanceReal) && Number.isFinite(avanceProgramado)
      ? avanceReal - avanceProgramado
      : null;
  const isRisk =
    firstPropertyEntry(safeProperties, RIESGO_KEYS)?.value === true ||
    String(firstPropertyEntry(safeProperties, RIESGO_KEYS)?.value || '').toLowerCase() ===
      'true';

  const generalFields = collectFields(safeProperties, GENERAL_FIELD_CONFIGS);
  const contractFields = collectFields(safeProperties, CONTRACT_FIELD_CONFIGS);
  const geographicFields = collectFields(safeProperties, GEOGRAPHIC_FIELD_CONFIGS);
  const coordinatesField = resolveCoordinates(safeProperties, selectedFeature.feature);
  const googleMapsField = resolveGoogleMapsField(
    safeProperties,
    coordinatesField?.coords
  );

  const statusTone = getStatusTone({ diferencia, estatus, isRisk });
  const statusText = isRisk ? 'En riesgo' : estatus || 'Seguimiento activo';

  // BONUS: Compartir obra usando Web Share API o fallback a portapapeles
  const handleShare = () => {
    const shareTitle = title !== 'Sin nombre' ? title : (selectedFeature.layerName || 'Obra SOBSE');
    const coordText = coordinatesField ? `\nCoordenadas: ${coordinatesField.value}` : '';
    const avanceText = Number.isFinite(avanceReal) ? `\nAvance: ${avanceReal}%` : '';
    const shareText = `${shareTitle}\n${layerLabel}\nEstatus: ${statusText}${avanceText}${coordText}`;

    if (navigator.share) {
      navigator.share({ title: shareTitle, text: shareText }).catch(() => {});
    } else if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(shareText).then(() => {
        setShareToast(true);
        setTimeout(() => setShareToast(false), 2200);
      }).catch(() => {});
    }
  };

  return (
    <div className="mfc" ref={panelRef}>
      <div className="mfc__inner">
        <div className="panel-header">
          <h3 className="panel-title">Detalle de obra</h3>
          <div className="panel-header__actions">
            {safeTableroLink ? (
              <a
                className="tablero-btn tablero-btn--header"
                href={safeTableroLink}
                rel="noopener noreferrer"
                target="_blank"
                title="Ver tablero de control"
              >
                <svg fill="none" height="15" viewBox="0 0 24 24" width="15" xmlns="http://www.w3.org/2000/svg">
                  <rect height="7" rx="1" stroke="currentColor" strokeWidth="1.8" width="7" x="3" y="3" />
                  <rect height="7" rx="1" stroke="currentColor" strokeWidth="1.8" width="7" x="14" y="3" />
                  <rect height="7" rx="1" stroke="currentColor" strokeWidth="1.8" width="7" x="14" y="14" />
                  <rect height="7" rx="1" stroke="currentColor" strokeWidth="1.8" width="7" x="3" y="14" />
                </svg>
                Tablero
              </a>
            ) : null}
            <button
              aria-label="Compartir obra"
              className="icon-btn"
              onClick={handleShare}
              title="Compartir"
              type="button"
            >
              <svg fill="none" height="16" viewBox="0 0 24 24" width="16" xmlns="http://www.w3.org/2000/svg">
                <circle cx="18" cy="5" r="3" stroke="currentColor" strokeWidth="1.8" />
                <circle cx="6" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
                <circle cx="18" cy="19" r="3" stroke="currentColor" strokeWidth="1.8" />
                <path d="m8.59 13.51 6.83 3.98M15.41 6.51 8.59 10.49" stroke="currentColor" strokeWidth="1.8" />
              </svg>
            </button>
            <button
              aria-label="Cerrar detalle"
              className="icon-btn"
              onClick={() => actions.clearSelectionAndTools()}
              title="Cerrar"
              type="button"
            >
              <svg fill="none" height="16" viewBox="0 0 24 24" width="16" xmlns="http://www.w3.org/2000/svg">
                <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
              </svg>
            </button>
          </div>
        </div>
        {shareToast && (
          <div className="share-toast" role="status">
            Información copiada al portapapeles
          </div>
        )}
        <div className="mfc__eyebrow obra-subtitle">{layerLabel}</div>
        <h4 className="mfc__title obra-title">{title}</h4>
        <div className={`mfc__status-line mfc__status-line--${statusTone}`}>
          {statusText}
        </div>

        <Section
          hasContent={
            Number.isFinite(avanceReal) ||
            Number.isFinite(avanceProgramado) ||
            Boolean(estatus) ||
            Boolean(observaciones)
          }
          title="Avance y estatus"
          variant="info-section--primary"
        >
          <ProgressBar value={avanceReal} />
          {renderField('Avance programado', formatPercent(avanceProgramado))}
          {renderField('Diferencia', formatSignedDifference(diferencia))}
          {renderField('Estatus', estatus)}
          {renderField('Observaciones', observaciones)}
        </Section>

        <Section
          hasContent={generalFields.length > 0}
          title="Información general"
        >
          {generalFields.map(({ label, value }) => (
            <React.Fragment key={label}>{renderField(label, value)}</React.Fragment>
          ))}
        </Section>

        <Section
          hasContent={contractFields.length > 0}
          title="Información contractual"
        >
          {contractFields.map(({ label, value }) => (
            <React.Fragment key={label}>{renderField(label, value)}</React.Fragment>
          ))}
        </Section>

        <Section
          hasContent={
            geographicFields.length > 0 ||
            Boolean(coordinatesField) ||
            Boolean(googleMapsField)
          }
          title="Información geográfica"
        >
          {geographicFields.map(({ label, value }) => (
            <React.Fragment key={label}>{renderField(label, value)}</React.Fragment>
          ))}
          {coordinatesField ? renderField(coordinatesField.label, coordinatesField.value) : null}
          {googleMapsField ? renderField(googleMapsField.label, googleMapsField.value) : null}
        </Section>
      </div>
    </div>
  );
}

export default MobileFeatureCard;
