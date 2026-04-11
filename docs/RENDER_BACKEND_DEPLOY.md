# Despliegue del backend en Render

Este proyecto ya está preparado para publicar el backend GIS en Render y dejar
el frontend estático en Hostinger.

## Estructura usada

- `frontend` ya vive en:
  - `https://TU_DOMINIO/web/sandbox/PRUEBAS/Visualizador_Web2/`
- `backend` se publicará en Render

## Archivos ya preparados

- `render.yaml`
- `backend/package.json`
- `backend/.node-version`

## Paso a paso

### 1. Crear repositorio Git

Render despliega desde GitHub, GitLab, Bitbucket o una URL pública Git.

La ruta más simple es GitHub.

Si todavía no tienes repo, desde tu máquina:

```bash
cd /Users/andreesparzamartinez/Desktop/sigsobse
git init
git add .
git commit -m "Prepare backend for Render"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
git push -u origin main
```

### 2. Crear el servicio en Render

En Render:

- `New` → `Web Service`
- conecta GitHub
- selecciona tu repo

### 3. Valores del servicio

Usa estos valores:

- `Name`: `sigsobse-backend`
- `Language / Runtime`: `Node`
- `Branch`: `main`
- `Root Directory`: `backend`
- `Build Command`: `npm install`
- `Start Command`: `npm start`
- `Health Check Path`: `/health`

### 4. Variables de entorno

Captura exactamente las variables listadas más abajo en este documento.

### 5. Desplegar

Haz clic en `Create Web Service`.

Cuando termine, Render te dará una URL similar a:

`https://sigsobse-backend.onrender.com`

### 6. Probar backend

Abre:

- `https://TU_BACKEND_RENDER/health`
- `https://TU_BACKEND_RENDER/test`
- `https://TU_BACKEND_RENDER/layers`

### 7. Conectar Hostinger

Edita en Hostinger:

`public_html/web/sandbox/PRUEBAS/Visualizador_Web2/runtime-config.js`

Y pega:

```js
window.__GIS_CONFIG__ = window.__GIS_CONFIG__ || {
  API_BASE_URL: 'https://TU_BACKEND_RENDER',
};
```

### 8. Validar frontend final

Abre:

`https://TU_DOMINIO/web/sandbox/PRUEBAS/Visualizador_Web2/`

Si todo está bien:

- el frontend carga
- ya no marca error de API
- el mapa consulta `/layers`
- las capas de PostgreSQL aparecen

## Variables requeridas en Render

```env
NODE_ENV=production
GIS_DEBUG=false
SERVE_FRONTEND=false
PGHOST=REEMPLAZAR_HOST
PGPORT=5432
PGDATABASE=sig_sobse
PGSCHEMA=sig_sobse
PGUSER=REEMPLAZAR_USUARIO
PGPASSWORD=REEMPLAZAR_PASSWORD
CACHE_INVALIDATE_TOKEN=REEMPLAZAR_TOKEN
CORS_ALLOWED_ORIGINS=https://TU_DOMINIO
```

Si tu frontend está en `https://plataformasobse.info/web/sandbox/PRUEBAS/Visualizador_Web2/`,
el valor correcto del origin es:

```env
CORS_ALLOWED_ORIGINS=https://plataformasobse.info
```

## Rutas que debes probar en Render

- `/health`
- `/test`
- `/layers`

## Conexión final con Hostinger

Cuando Render te dé la URL pública del backend, edita este archivo en Hostinger:

`public_html/web/sandbox/PRUEBAS/Visualizador_Web2/runtime-config.js`

Y deja:

```js
window.__GIS_CONFIG__ = window.__GIS_CONFIG__ || {
  API_BASE_URL: 'https://TU_BACKEND_RENDER.onrender.com',
};
```

## Nota

No necesitas recompilar el frontend para cambiar la URL del backend.
Solo cambias `runtime-config.js`.
