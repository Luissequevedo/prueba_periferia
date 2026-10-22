# Solución técnica — Reto 02

## 1. Objetivo

Construir un prototipo conversacional para apoyar el registro y seguimiento de contratos vigentes a partir de mensajes y archivos de un buzón simulado.

## 2. Arquitectura

- **Interfaz:** chat web en HTML, CSS y JavaScript.
- **Backend:** servidor Node.js con Express.
- **Herramientas de negocio:** TypeScript y validación de datos con Zod.
- **Datos de entrada:** fixtures del reto.
- **Persistencia simulada:** archivos locales bajo `out/`; el maestro original de fixtures debe conservarse sin modificaciones.
- **Trazabilidad:** registro de llamadas a herramientas y operaciones de historial.

## 3. Flujo funcional

1. Consultar el buzón e identificar los mensajes con adjuntos contractuales.
2. Extraer los campos disponibles del documento.
3. Validar los campos y detectar información faltante o de baja confianza.
4. Clasificar el caso como nuevo, actualización, duplicado o documento no contractual.
5. Solicitar revisión humana cuando existan campos ambiguos.
6. Registrar únicamente los casos autorizados.
7. Generar alertas sobre vencimientos, pólizas pendientes y registros recientes.

## 4. Reglas de negocio

- Un documento que no corresponda a un contrato se rechaza.
- Un registro duplicado no debe generar una nueva escritura.
- Las actualizaciones con campos ambiguos requieren revisión.
- La información de pólizas se conserva para seguimiento.
- Las alertas se generan a partir del maestro de trabajo y una fecha de referencia.
- Los datos originales de prueba no deben modificarse.

## 5. Pruebas funcionales observadas

- `msg-001`: contrato nuevo registrado como `CT-2026-015`.
- `msg-003`: actualización detectada; se requiere revisar `objeto` y `tipo_poliza` antes del registro.
- Buzón: se identificaron seis mensajes, incluida una cotización que no es contrato.
- Alertas: se detectó un contrato próximo a vencer y pólizas pendientes.

Queda pendiente ejecutar y documentar la prueba de duplicado `msg-004`, así como repetir la demo completa desde un estado limpio.

## 6. Decisiones y limitaciones

Se priorizó un prototipo local, trazable y fácil de ejecutar dentro del tiempo disponible. La persistencia en archivos simplifica la demostración, pero no ofrece las garantías de concurrencia, permisos y auditoría de una base de datos productiva.

El enrutamiento conversacional actual se basa en reglas determinísticas; no se ha integrado un modelo de lenguaje. La extracción y clasificación no deben considerarse equivalentes a una solución de IA generativa en producción.

No existe conexión real con el correo corporativo ni con SharePoint. Las rutas de documentos son simuladas.

## 7. Mejoras para producción

- Integrar un proveedor LLM mediante un adaptador del lado del servidor y credenciales en variables de entorno.
- Usar salida estructurada y validación de esquema; no permitir que el modelo escriba directamente en los registros.
- Incorporar autenticación, autorización y aprobación explícita de cambios.
- Migrar la persistencia a una base de datos y SharePoint real.
- Añadir pruebas automatizadas para duplicados, actualizaciones, errores de extracción y reintentos.
- Incorporar observabilidad, manejo seguro de datos personales y controles contra instrucciones maliciosas en documentos.

## 8. Uso de IA

La implementación y la documentación se desarrollaron con asistencia de ChatGPT. El prototipo entregado utiliza reglas determinísticas y no incluye integración con un LLM.
