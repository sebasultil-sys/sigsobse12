import { useGISWorkspace } from '../../app/GISWorkspaceContext';

function firstPropertyValue(properties, keys) {
  for (const key of keys) {
    const value = properties?.[key];
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      return value;
    }
  }

  return null;
}

function formatFieldValue(value) {
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';

  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? value.toLocaleString('es-MX')
      : value.toLocaleString('es-MX', { maximumFractionDigits: 2 });
  }

  return String(value).replace(/\s+/g, ' ').trim();
}

function formatCurrency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;

  return amount.toLocaleString('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  });
}

function buildFeatureDetails(properties) {
  const preferredFields = [
    {
      label: 'DG',
      keys: ['DG', 'dg', 'DIRECCION GENERAL', 'DIRECCION_GENERAL', 'direccion general', 'direccion_general'],
    },
    { label: 'Alcaldía', keys: ['ALCALDIA', 'alcaldia', 'ALCALDÍA', 'alcaldía'] },
    { label: 'Programa', keys: ['PROGRAMA', 'programa'] },
    { label: 'Frente', keys: ['FRENTE', 'frente'] },
    { label: 'Colonia', keys: ['COLONIA', 'colonia'] },
    { label: 'Tipo', keys: ['TIPO', 'tipo', 'TIPO_OBRA', 'tipo_obra'] },
  ];
  const details = [];

  preferredFields.forEach(({ label, keys }) => {
    const value = firstPropertyValue(properties, keys);
    if (value == null) return;
    details.push({ label, value: formatFieldValue(value) });
  });

  return details;
}

function buildFeatureHighlights(properties) {
  const monto =
    firstPropertyValue(properties, [
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
    ]) ?? null;

  const contrato = firstPropertyValue(properties, [
    'CONTRATO',
    'N_CONTRATO',
    'NO_CONTRATO',
    'NUM_CONTRATO',
    'contrato',
  ]);

  const empresa = firstPropertyValue(properties, [
    'EMPRESA',
    'N_EMPRESA',
    'CONTRATISTA',
    'empresa',
    'contratista',
  ]);

  const estatus = firstPropertyValue(properties, [
    'ESTATUS',
    'estatus',
    'ESTADO',
    'estado',
  ]);

  return [
    monto != null
      ? { label: 'Monto', value: formatCurrency(monto) || formatFieldValue(monto), tone: 'money' }
      : null,
    contrato
      ? { label: 'Contrato', value: formatFieldValue(contrato), tone: 'neutral' }
      : null,
    empresa
      ? { label: 'Empresa', value: formatFieldValue(empresa), tone: 'neutral' }
      : null,
    estatus
      ? { label: 'Estatus', value: formatFieldValue(estatus), tone: 'status' }
      : null,
  ].filter(Boolean);
}

function AvanceBar({ value }) {
  const pct = Math.min(100, Math.max(0, value ?? 0));
  const color =
    pct >= 80 ? 'var(--mfc-green)' : pct >= 50 ? 'var(--mfc-gold)' : 'var(--mfc-red)';

  return (
    <div className="mfc-avance">
      <div className="mfc-avance__meta">
        <span>Avance</span>
        <strong style={{ color }}>{pct}%</strong>
      </div>
      <div className="mfc-avance__track">
        <div
          className="mfc-avance__fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg fill="none" height="18" viewBox="0 0 18 18" width="18" xmlns="http://www.w3.org/2000/svg">
      <path d="M14 4 4 14M4 4l10 10" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
    </svg>
  );
}

function MobileFeatureCard() {
  const { actions, selectedFeature } = useGISWorkspace();

  if (!selectedFeature) return null;

  const p = selectedFeature.properties || {};
  const avanceValue = firstPropertyValue(p, ['AVANCE', 'avance', 'PORC_AVANCE', 'porc_avance']);
  const avance = Number(avanceValue);
  const isRisk = p.RIESGO === true;
  const title =
    firstPropertyValue(p, ['OBRA', 'obra', 'NOMBRE_OBRA', 'nombre_obra', 'FRENTE', 'frente']) ||
    selectedFeature.layerName ||
    'Sin nombre';
  const highlights = buildFeatureHighlights(p);
  const details = buildFeatureDetails(p);
  const hasAvance = Number.isFinite(avance) && avance >= 0;

  return (
    <div className="mfc">
      <div className="mfc__inner">
        <div className="mfc__top">
          <div className="mfc__status">
            <span
              className={`mfc__dot${isRisk ? ' mfc__dot--risk' : ' mfc__dot--ok'}`}
            />
            <span className="mfc__status-label">
              {isRisk ? 'En riesgo' : 'Activo'}
            </span>
          </div>
          <button
            aria-label="Cerrar"
            className="mfc__dismiss"
            onClick={actions.clearSelectionAndTools}
            type="button"
          >
            <CloseIcon />
          </button>
        </div>

        <h3 className="mfc__title">{title}</h3>

        {hasAvance && <AvanceBar value={avance} />}

        {highlights.length > 0 && (
          <div className="mfc__highlights">
            {highlights.map(({ label, value, tone }) => (
              <div className={`mfc__highlight mfc__highlight--${tone}`} key={label}>
                <span className="mfc__highlight-label">{label}</span>
                <strong className="mfc__highlight-value">{value}</strong>
              </div>
            ))}
          </div>
        )}

        {details.length > 0 && (
          <div className="mfc__details">
            {details.map(({ label, value }) => (
              <div className="mfc__detail-row" key={label}>
                <span className="mfc__detail-label">{label}</span>
                <span className="mfc__detail-value">{String(value)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default MobileFeatureCard;
