# Checklist Operativo (5 puntos)

Fecha de referencia: **17 de abril de 2026**

## 1. Confiabilidad de datos KPI

- Validar `GET /api/kpis/summary?force=1` y confirmar total real esperado.
- Validar `GET /api/kpis/audit?force=1` y revisar:
  - `totals`
  - `table_rollup`
  - `deltas`
  - `audit.skipped_tables`
- Si hay diferencia, revisar columnas de ID de obra por tabla.

## 2. Salud de backend en producción

- `GET /health` debe regresar `checks.kpi_summary.ok`.
- Confirmar `X-Request-Id` presente en respuestas API.
- Confirmar límites activos:
  - `rate_limit_enabled`
  - `request_timeout_ms`

## 3. Rendimiento y caché

- Confirmar `ETag` en:
  - `/api/layers`
  - `/api/kpis/summary`
  - `/api/kpis/audit`
- En segunda petición con `If-None-Match`, validar `304` cuando aplique.
- Revisar `X-GIS-Cache` en `/api/layer/:table`.

## 4. UX móvil (panel KPI)

- Confirmar que el filtro KPI se conserva al recargar.
- Confirmar mensaje limpio en desconexión:
  - "Sin conexión: mostrando la última información guardada."
- Confirmar que no se muestra mensaje técnico de ruta faltante.

## 5. Entrega y operación

- Ejecutar smoke test dos veces:
  - `npm run smoke:backend -- https://sigsobse-backend.onrender.com 2`
- Subir build frontend de `sigsobseClean`.
- Realizar hard refresh en navegador para validar assets nuevos.
