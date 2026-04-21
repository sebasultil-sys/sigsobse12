# Deploy en Hostinger para `sigsobse2`

Ruta objetivo:

`/public_html/web/sandbox/PRUEBAS/sigsobse2/`

## 1) Generar build correcto para esa ruta

Desde la raíz del proyecto:

```bash
npm run build:hostinger:sigsobse2
```

## 2) Qué subir al hosting

Sube **el contenido interno** de `frontend/build/` a:

`public_html/web/sandbox/PRUEBAS/sigsobse2/`

Debe quedar así (sin carpeta `build` anidada):

- `index.html`
- `.htaccess`
- `runtime-config.js`
- `static/`
- `assets/`
- `icons/`
- `logos/`
- `data/`

## 3) Configurar backend

En Hostinger, edita:

`public_html/web/sandbox/PRUEBAS/sigsobse2/runtime-config.js`

y define `API_BASE_URL` con tu backend real.

## 4) Verificación

Abre:

`https://TU_DOMINIO/web/sandbox/PRUEBAS/sigsobse2/`
