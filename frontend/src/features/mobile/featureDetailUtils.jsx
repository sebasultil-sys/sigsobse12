import React from 'react';

function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

function safeValue(obj, key) {
  const value = obj?.[key] ?? null;
  return isEmptyValue(value) ? null : value;
}

function normalizeKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .trim();
}

function firstPropertyEntry(properties, keys) {
  for (const key of keys) {
    const value = safeValue(properties, key);
    if (value !== null) {
      return { key, value };
    }
  }

  return null;
}

function firstFlexiblePropertyEntry(properties, keys) {
  if (!properties || typeof properties !== 'object') return null;

  const directMatch = firstPropertyEntry(properties, keys);
  if (directMatch) return directMatch;

  const normalizedKeys = new Set(
    keys.map((key) => normalizeKey(key)).filter(Boolean)
  );

  for (const [key, rawValue] of Object.entries(properties)) {
    const value = isEmptyValue(rawValue) ? null : rawValue;
    if (value === null) continue;

    if (normalizedKeys.has(normalizeKey(key))) {
      return { key, value };
    }
  }

  return null;
}

function parseNumericValue(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    // Eliminar coma decimal europea, símbolo % y espacios ("45,5%" → "45.5", "45%" → "45")
    const normalized = value.trim().replace(/,/g, '.').replace(/%/g, '').replace(/\s/g, '');
    if (!normalized) return null;

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function formatFieldValue(value) {
  if (isEmptyValue(value)) return null;
  if (React.isValidElement(value)) return value;

  if (typeof value === 'boolean') return value ? 'Sí' : 'No';

  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? value.toLocaleString('es-MX')
      : value.toLocaleString('es-MX', { maximumFractionDigits: 2 });
  }

  return String(value).replace(/\s+/g, ' ').trim();
}

function getTableroLink(data) {
  if (!data) return null;

  const possibleKeys = [
    'link_tablero_control',
    'link_tablero',
    'tablero_control',
    'tablero',
    'dashboard',
    'url_tablero',
    'linkDashboard',
    'LINK_TABLERO_CONTROL',
    'LINK_TABLERO_DE_CONTROL',
    'URL_TABLERO_CONTROL',
  ];

  const directEntry = firstFlexiblePropertyEntry(data, possibleKeys);
  const directValue = formatFieldValue(directEntry?.value);

  if (directValue) return directValue;

  for (const [key, rawValue] of Object.entries(data)) {
    const normalized = normalizeKey(key);
    const value = formatFieldValue(rawValue);

    if (!value) continue;

    if (
      normalized.includes('TABLERO') ||
      normalized.includes('DASHBOARD')
    ) {
      return value;
    }
  }

  return null;
}

function formatCurrency(value) {
  const amount = parseNumericValue(value);
  if (!Number.isFinite(amount)) return null;

  return amount.toLocaleString('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  });
}

function formatPercent(value) {
  const amount = parseNumericValue(value);
  if (!Number.isFinite(amount)) return null;

  return `${amount.toLocaleString('es-MX', {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 2,
  })}%`;
}

function formatSignedDifference(value) {
  const amount = parseNumericValue(value);
  if (!Number.isFinite(amount)) return null;

  const absolute = Math.abs(amount).toLocaleString('es-MX', {
    minimumFractionDigits: Math.abs(amount) % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 2,
  });

  return `${amount > 0 ? '+' : amount < 0 ? '-' : ''}${absolute} pts`;
}

function formatDateValue(value) {
  if (isEmptyValue(value)) return null;

  const raw = String(value).trim();

  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(raw)) {
    return raw;
  }

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleDateString('es-MX');
  }

  return formatFieldValue(value);
}

function normalizeYear(value) {
  if (!value) return null;

  const cleaned = value.toString().replace(/[^0-9]/g, '');
  if (cleaned.length === 4) return cleaned;

  return null;
}

function formatCoordinatePair(latitude, longitude) {
  const lat = parseNumericValue(latitude);
  const lng = parseNumericValue(longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function humanizeKey(key) {
  return String(key || '')
    .replace(/^_+/, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderField(label, value) {
  if (
    value === null ||
    value === undefined ||
    value === '' ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    return null;
  }

  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      <span className="info-value">{value}</span>
    </div>
  );
}

export {
  firstFlexiblePropertyEntry,
  firstPropertyEntry,
  formatCoordinatePair,
  formatCurrency,
  formatDateValue,
  formatFieldValue,
  formatPercent,
  formatSignedDifference,
  getTableroLink,
  normalizeYear,
  humanizeKey,
  normalizeKey,
  parseNumericValue,
  renderField,
  safeValue,
};
