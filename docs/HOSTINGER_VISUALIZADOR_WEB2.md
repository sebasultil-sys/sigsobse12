# Despliegue híbrido en `Visualizador_Web2`

Ruta objetivo del frontend estático:

`/public_html/web/sandbox/PRUEBAS/Visualizador_Web2/`

## Modelo de despliegue

- `frontend` se publica como sitio estático en la subcarpeta `Visualizador_Web2`.
- `backend` se publica aparte como app Node.js.
- El frontend consume la API del backend usando `runtime-config.js`.

## 1. Construir el frontend para esa subcarpeta

Desde la raíz del proyecto:

```bash
npm run build:hostinger
```

O directamente:

```bash
cd frontend
npm run build:hostinger
```

Este build genera assets con base pública:

`/web/sandbox/PRUEBAS/Visualizador_Web2`

## 2. Qué subir a Hostinger

Sube **el contenido interno** de:

`frontend/build/`

No subas la carpeta `build` completa como carpeta anidada.  
Sube su contenido dentro de:

`public_html/web/sandbox/PRUEBAS/Visualizador_Web2/`

Debes ver algo así en esa ruta:

- `index.html`
- `asset-manifest.json`
- `manifest.json`
- `runtime-config.js`
- `static/`

## 3. Configurar la URL del backend

Después de subir los archivos, edita en Hostinger:

`public_html/web/sandbox/PRUEBAS/Visualizador_Web2/runtime-config.js`

Contenido:

```js
window.__GIS_CONFIG__ = window.__GIS_CONFIG__ || {
  API_BASE_URL: 'https://TU_BACKEND_NODE',
};
```

Ejemplo:

```js
window.__GIS_CONFIG__ = window.__GIS_CONFIG__ || {
  API_BASE_URL: 'https://api.tu-dominio.com',
};
```

## 4. Backend Node.js

El backend debe publicarse aparte como app Node.js con estas variables:

```env
NODE_ENV=production
PORT=3001
PGHOST=REEMPLAZAR_HOST
PGPORT=5432
PGDATABASE=sig_sobse
PGSCHEMA=sig_sobse
PGUSER=REEMPLAZAR_USUARIO
PGPASSWORD=REEMPLAZAR_PASSWORD
GIS_DEBUG=false
SERVE_FRONTEND=false
CACHE_INVALIDATE_TOKEN=REEMPLAZAR_TOKEN_SEGURO
CORS_ALLOWED_ORIGINS=https://plataformasobse.info
```

Si el frontend vive en otro dominio/subdominio, agrega ese origen real a `CORS_ALLOWED_ORIGINS`.

## 5. Verificaciones

### Frontend

Abre:

`https://TU_DOMINIO/web/sandbox/PRUEBAS/Visualizador_Web2/`

### Backend

Verifica:

- `/health`
- `/test`
- `/layers`

## 6. Notas

- `runtime-config.js` permite cambiar la URL de la API sin recompilar.
- Si cambias el backend después, solo editas `runtime-config.js`.
- Si el frontend carga en blanco, normalmente el problema será:
  - assets subidos a la ruta incorrecta
  - `runtime-config.js` apuntando a una API incorrecta
  - `CORS_ALLOWED_ORIGINS` faltante en el backend
