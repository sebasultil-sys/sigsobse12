// ─────────────────────────────────────────────────────────────────────────────
// layerIcons.js — Mapeo de nombres de capa a iconos PNG/SVG
//
// Coloca los archivos de icono en /public/icons/
// Las claves se comparan con el NOMBRE DE CAPA en mayúsculas (includes).
// Para agregar una capa nueva: añade la clave aquí y el archivo en /public/icons/
// ─────────────────────────────────────────────────────────────────────────────

export const layerIcons = {
  // Transporte
  'CABLEBUS':      '/icons/cablebus.png',
  'CABLEBÚS':      '/icons/cablebus.png',
  'TREN LIGERO':   '/icons/tren.png',
  'TREN':          '/icons/tren.png',
  'TROLEBUS':      '/icons/trolebus.png',
  'TROLEBÚS':      '/icons/trolebus.png',
  'METRO':         '/icons/metro.png',
  'METROBUS':      '/icons/metrobus.png',
  'METROBÚS':      '/icons/metrobus.png',
  'ECOBICI':       '/icons/ecobici.png',

  // Educación
  'ESCUELA':       '/icons/escuela.png',
  'COLEGIO':       '/icons/escuela.png',
  'PLANTEL':       '/icons/escuela.png',
  'CETRAM':        '/icons/cetram.png',

  // Salud
  'HOSPITAL':      '/icons/hospital.png',
  'CLINICA':       '/icons/hospital.png',
  'CLÍNICA':       '/icons/hospital.png',
  'UNIDAD MEDICA': '/icons/hospital.png',
  'UNIDAD MÉDICA': '/icons/hospital.png',
  'ERUM':          '/icons/ambulancia.png',
  'AMBULANCIA':    '/icons/ambulancia.png',

  // Equipamiento urbano
  'UTOPIA':        '/icons/utopias.png',
  'UTOPÍA':        '/icons/utopias.png',
  'PARQUE':        '/icons/parque.png',
  'JARDIN':        '/icons/parque.png',
  'JARDÍN':        '/icons/parque.png',
  'MERCADO':       '/icons/mercado.png',
  'DEPORTIVO':     '/icons/deportivo.png',

  // Obra pública
  'OBRA':          '/icons/obra.png',
  'BACHEO':        '/icons/obra.png',
  'PUENTE':        '/icons/puente.png',
  'CICLOVÍA':      '/icons/ciclovia.png',
  'CICLOVIA':      '/icons/ciclovia.png',
};

// Icono por defecto cuando no hay coincidencia
export const DEFAULT_ICON_URL = '/icons/default.png';

/**
 * Devuelve la URL del icono para una capa dada su nombre.
 * Compara en mayúsculas con las claves de layerIcons (includes).
 * Devuelve null si no hay icono personalizado — en ese caso
 * el mapa usará CircleMarker y la leyenda usará el símbolo de geometría.
 *
 * @param {string} name — Nombre de la capa
 * @returns {string|null}
 */
export function getLayerIcon(name) {
  if (!name) return null;
  const upper = name.toUpperCase();
  const key = Object.keys(layerIcons).find((k) => upper.includes(k.toUpperCase()));
  return key ? layerIcons[key] : null;
}
