# Se vale todo - Videochat PRO base

Proyecto listo para GitHub + Render.

## Estructura

- `server.js`: servidor Node + Socket.IO
- `public/`: web
- `prisma/schema.prisma`: base de datos PostgreSQL
- `.env.example`: variables necesarias
- `mobile/capacitor.config.json`: base para crear app Android con Capacitor

## Subir a GitHub

Sube estos archivos y carpetas:

- server.js
- package.json
- .gitignore
- .env.example
- prisma/
- public/
- mobile/

NO subas node_modules.

## Render

Crear como:

New + -> Web Service

Configuración:

- Runtime: Node
- Build Command:
npm install && npx prisma generate && npx prisma db push

- Start Command:
node server.js

- Root Directory:
dejar vacío

## Variables de entorno en Render

Crea una base PostgreSQL en Render o Supabase y agrega:

DATABASE_URL
JWT_SECRET
ADMIN_PASSWORD

## Android

La forma más rápida es usar Capacitor para convertir esta web en app Android.
Cuando la web esté publicada en Render, coloca tu URL en `mobile/capacitor.config.json`.

Ejemplo:
https://se-vale-todo.onrender.com

Luego se puede abrir con Android Studio y generar APK/AAB.
