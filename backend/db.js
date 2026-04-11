// ─────────────────────────────────────────────────────────────────────────────
// db.js — Conexión a PostgreSQL
//
// Este archivo crea el "pool" de conexiones a la base de datos.
// Un pool mantiene varias conexiones abiertas al mismo tiempo para que
// múltiples peticiones del frontend puedan ejecutarse en paralelo sin
// tener que abrir y cerrar una conexión nueva en cada request.
// ─────────────────────────────────────────────────────────────────────────────

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pkg from 'pg';

const { Pool } = pkg;

// __dirname no existe en módulos ES, estas dos líneas lo reconstruyen
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carga las variables de entorno desde el archivo .env del backend
// (host, puerto, usuario, contraseña, nombre de base de datos)
dotenv.config({ path: path.join(__dirname, '.env') });
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function getEnv(name, fallback = '') {
  const value = String(process.env[name] || '').trim();
  return value || fallback;
}

const dbHost = getEnv('PGHOST', IS_PRODUCTION ? '' : '127.0.0.1');
const dbPort = Number(getEnv('PGPORT', '5432'));
const dbUser = getEnv('PGUSER', IS_PRODUCTION ? '' : 'postgres');
const dbPassword = getEnv('PGPASSWORD', '');
const dbName = getEnv('PGDATABASE', IS_PRODUCTION ? '' : 'sig_sobse');

const missingRequiredEnv = [
  ['PGHOST', dbHost],
  ['PGUSER', dbUser],
  ['PGDATABASE', dbName],
].filter(([, value]) => !value);

if (missingRequiredEnv.length) {
  throw new Error(
    `Faltan variables de entorno de PostgreSQL: ${missingRequiredEnv
      .map(([name]) => name)
      .join(', ')}`
  );
}

// Pool de conexiones a PostgreSQL.
// max: 10 → hasta 10 conexiones simultáneas abiertas.
// idleTimeoutMillis: 30000 → si una conexión lleva 30 seg sin usarse, se cierra.
// connectionTimeoutMillis: 10000 → si en 10 seg no logra conectar, lanza error.
export const pool = new Pool({
  host: dbHost,
  port: dbPort,
  user: dbUser,
  password: dbPassword,
  database: dbName,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Función helper que ejecuta cualquier consulta SQL.
// Recibe el texto SQL y los parámetros de forma separada para evitar
// inyección SQL (PostgreSQL los escapa automáticamente con $1, $2, etc.)
export async function query(text, params) {
  return pool.query(text, params);
}
