# Agente conversacional — Registro de contratos vigentes

Prototipo para consultar un buzón de contratos, extraer y validar información contractual, detectar registros nuevos o actualizaciones, controlar duplicados y generar alertas.

## Requisitos
- Node.js
- npm

## Instalación y ejecución

```bash
npm install
npm run dev
```

Abre el puerto 3000 en Codespaces para usar la interfaz web.

## Demo de los escenarios

```bash
npm run demo
```

La demo ejecuta escenarios de prueba y genera archivos de salida en `out/`.

## API

- `GET /api/health`: estado del servidor.
- `GET /api/sessions/:id`: historial de una sesión.
- `POST /api/chat`: envía un mensaje al agente.

Ejemplo de petición:

```json
{
  "sessionId": "demo",
  "message": "Lee el buzón"
}
```

## Herramientas

El prototipo incluye operaciones para leer el buzón, extraer datos, validar contratos, registrar contratos y generar alertas.

## Alcance y limitaciones

La versión actual utiliza reglas determinísticas para interpretar los mensajes y enrutar las operaciones. No tiene un LLM integrado ni conexión real con correo corporativo o SharePoint; utiliza fixtures y archivos locales para simular esas integraciones.

Los resultados que requieren revisión deben ser confirmados por una persona antes de registrarse.

## Despliegue

URL pública: https://glorious-zebra-p6jx566w5r35wj-3000.app.github.dev/
