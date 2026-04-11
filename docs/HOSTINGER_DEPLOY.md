# Despliegue en Hostinger

## Arquitectura recomendada

- `backend/` sirve la API GIS y, si existe `frontend/build`, también sirve la app React.
- En producción la ruta recomendada es desplegar una sola app Node.js.

## Variables de entorno backend

Configura estas variables en Hostinger:

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
SERVE_FRONTEND=true
CACHE_INVALIDATE_TOKEN=REEMPLAZAR_TOKEN_SEGURO
CORS_ALLOWED_ORIGINS=https://tu-dominio.com,https://www.tu-dominio.com
```

## Variables de entorno frontend

Si backend y frontend quedan en el mismo dominio, no necesitas definir URL de API.

Solo define esto si el backend queda en otro origen:

```env
REACT_APP_GIS_API_URL=https://api.tu-dominio.com
REACT_APP_GIS_SYNC_INTERVAL_MS=300000
```

## Build del frontend

```bash
cd frontend
npm install
npm run build
```

## Arranque del backend

```bash
cd backend
npm install
npm start
```

## Verificaciones mínimas

- `GET /health`
- `GET /test`
- `GET /layers`
- abrir `/` y confirmar que React carga

## Notas operativas

- `POST /cache/invalidate` requiere token en producción.
- Si React queda servido por el mismo backend, el frontend consume la API por mismo origen.
- La sincronización de capas desde PostgreSQL en producción debe quedarse en intervalos altos. El valor recomendado actual es `300000` ms.
