import { rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { leer_buzon, extraer, validar, registrar, alertas } from "./src/tools/contratos.js";

const directory = process.cwd();
const ctx = { directory, sessionId: "demo" };
const call = async (tool: { execute: (args: unknown, ctx: { directory: string; sessionId: string }) => Promise<string> }, args: unknown) =>
  JSON.parse(await tool.execute(args, ctx)) as { ok: boolean; data?: any; error?: string };

async function main() {
  rmSync(path.join(directory, "out"), { recursive: true, force: true });
  mkdirSync(path.join(directory, "out"), { recursive: true });

  const inbox = await call(leer_buzon, {});
  if (!inbox.ok) throw new Error(inbox.error);
  const mensajes = inbox.data.mensajes as { id: string }[];

  for (const mensaje of mensajes) {
    console.log(`\n--- ${mensaje.id} ---`);
    const extracted = await call(extraer, { mensaje_id: mensaje.id });
    if (!extracted.ok) {
      console.log(`rechazado: ${extracted.error}`);
      continue;
    }
    const contrato = extracted.data;
    const checked = await call(validar, { mensaje_id: mensaje.id, contrato });
    if (!checked.ok) {
      console.log(`error validando: ${checked.error}`);
      continue;
    }
    const v = checked.data;
    console.log(`Clasificación: ${v.clasificacion}`);
    console.log(`Revisión requerida: ${v.requiere_revision.join(", ") || "ninguna"}`);

    if (v.clasificacion === "rechazado" || v.clasificacion === "duplicado") {
      console.log(v.clasificacion === "duplicado" ? "Acción: sin escritura (duplicado)" : `Motivo: ${v.motivo}`);
      continue;
    }
    if (v.requiere_revision.length > 0) {
      console.log("Acción inicial: no registrado; requiere confirmación humana");
      if (mensaje.id === "msg-006") {
        const confirmed = await call(registrar, { mensaje_id: mensaje.id, contrato, confirmado: true });
        console.log(confirmed.ok ? `Tras confirmar: ${JSON.stringify(confirmed.data)}` : `Error al confirmar: ${confirmed.error}`);
      }
      continue;
    }
    const saved = await call(registrar, { mensaje_id: mensaje.id, contrato });
    console.log(saved.ok ? `Acción: ${JSON.stringify(saved.data)}` : `Error: ${saved.error}`);
  }

  const report = await call(alertas, { hoy: "2026-09-03" });
  console.log("\n--- ALERTAS ---");
  console.log(report.ok ? JSON.stringify({
    ruta: report.data.ruta,
    vencen: report.data.vencen.length,
    polizas_pendientes: report.data.polizas_pendientes.length,
    registrados_desde_corte: report.data.registrados_desde_corte.length
  }, null, 2) : report.error);
}
main().catch(error => {
  console.error("La demo terminó con error:", error);
  process.exitCode = 1;
});
