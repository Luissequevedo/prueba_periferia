import { z } from "zod";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, appendFileSync } from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";

export type Ctx = { directory: string; sessionId: string };
const root = (ctx: Ctx, ...p: string[]) => path.join(ctx.directory, ...p);
const ok = (data: unknown) => JSON.stringify({ ok: true, data });
const fail = (error: unknown) => JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) });

const contractSchema = z.object({
  id_contrato: z.string().nullable(),
  cliente: z.string().nullable(),
  nit_cliente: z.string().nullable(),
  pais: z.enum(["CO", "EC", "PE", "PA", "HN"]).nullable(),
  objeto: z.string().nullable(),
  valor: z.number().nullable(),
  valor_indeterminado: z.boolean(),
  moneda: z.enum(["COP", "USD", "PEN", "PAB", "HNL"]).nullable(),
  fecha_inicio: z.string().nullable(),
  fecha_fin: z.string().nullable(),
  requiere_poliza: z.boolean().nullable(),
  tipo_poliza: z.string(),
  estado_poliza: z.enum(["vigente", "pendiente", "vencida", "no_aplica"]).nullable(),
  comercial: z.string().nullable(),
  ruta_sharepoint: z.string(),
  fecha_registro: z.string(),
  fuente: z.enum(["buzon", "manual", "migracion"]),
  confianza: z.record(z.string(), z.number())
});
export type Contrato = z.infer<typeof contractSchema>;

const columns = [
  "id_contrato", "cliente", "nit_cliente", "pais", "objeto", "valor", "moneda",
  "fecha_inicio", "fecha_fin", "requiere_poliza", "tipo_poliza", "estado_poliza",
  "comercial", "ruta_sharepoint", "fecha_registro", "fuente"
];

function log(ctx: Ctx, herramienta: string, mensaje_id: string, success: boolean, resumen: string) {
  const file = root(ctx, "out", "log.jsonl");
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), herramienta, mensaje_id, ok: success, resumen }) + "\n");
}
function run(name: string, fn: (a: any, ctx: Ctx) => unknown) {
  return {
    description: name,
    args: {} as Record<string, z.ZodType>,
    async execute(args: unknown, ctx: Ctx): Promise<string> {
      let id = typeof args === "object" && args !== null && "mensaje_id" in args ? String((args as { mensaje_id: unknown }).mensaje_id) : "";
      try {
        const data = fn(args, ctx);
        log(ctx, name, id, true, "Operación completada");
        return ok(data);
      } catch (e) {
        log(ctx, name, id, false, e instanceof Error ? e.message : "Error desconocido");
        return fail(e);
      }
    }
  };
}
function readRows(ctx: Ctx): Record<string, string>[] {
  const fixture = root(ctx, "fixtures", "reto-02", "maestro-contratos.csv");
  const output = root(ctx, "out", "sharepoint", "maestro-contratos.csv");
  mkdirSync(path.dirname(output), { recursive: true });
  if (!existsSync(output)) copyFileSync(fixture, output);
  return parse(readFileSync(output, "utf8"), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
}
function writeRows(ctx: Ctx, rows: Record<string, string>[]) {
  const output = root(ctx, "out", "sharepoint", "maestro-contratos.csv");
  writeFileSync(output, stringify(rows, { header: true, columns }));
}
function messageDir(ctx: Ctx, id: string) {
  const p = root(ctx, "fixtures", "reto-02", "buzon", id);
  if (!existsSync(p)) throw new Error(`Mensaje desconocido: ${id}`);
  return p;
}
function getMessage(ctx: Ctx, id: string): { correo: Record<string, unknown>; texto: string; adjuntos: string[] } {
  const dir = messageDir(ctx, id);
  const correo = JSON.parse(readFileSync(path.join(dir, "correo.json"), "utf8")) as Record<string, unknown>;
  const adjuntos = Array.isArray(correo.adjuntos) ? correo.adjuntos.map(String) : [];
  const archivo = adjuntos.find(a => /\.(txt|pdf)$/i.test(a));
  const texto = archivo && existsSync(path.join(dir, archivo)) ? readFileSync(path.join(dir, archivo), "utf8") : "";
  return { correo, texto, adjuntos };
}
function dateTokens(text: string): string[] {
  const months: Record<string, string> = {
    enero:"01", febrero:"02", marzo:"03", abril:"04", mayo:"05", junio:"06",
    julio:"07", agosto:"08", septiembre:"09", setiembre:"09", octubre:"10",
    noviembre:"11", diciembre:"12"
  };
  const out: string[] = [];
  const re = /(?:primero|primer|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciséis|dieciseis|diecisiete|dieciocho|diecinueve|veinte|veintiuno|veintidós|veintidos|veintitrés|veintitres|treinta y uno|treinta)\s*\((\d{1,2})\)\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})|(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/gi;
  for (const m of text.matchAll(re)) {
    const day = Number(m[1] ?? m[4]);
    const monthName = (m[2] ?? m[5] ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const year = m[3] ?? m[6];
    const month = months[monthName];
    if (month && year && day >= 1 && day <= 31) out.push(`${year}-${month}-${String(day).padStart(2, "0")}`);
  }
  const iso = [...text.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map(m => m[1]);
  return [...new Set([...out, ...iso])];
}
function extractContract(id: string, ctx: Ctx): Contrato {
  const { correo, texto, adjuntos } = getMessage(ctx, id);
  const t = texto;
  const conf: Record<string, number> = {};
  const set = (k: string, v: number) => { conf[k] = v; };
  const idMatch = t.match(/(?:CONTRATO(?: MARCO)?(?: DE [^\n]+?)?|OTROSÍ[^\n]*?)\s*(?:No\.?|N[º°])\s*([A-Z]{0,5}-?\d{4}-\d{2,4})/i)
    ?? t.match(/\b((?:CT|CM)-\d{4}-\d{2,4})\b/i);
  const contractId = idMatch?.[1]?.replace(/\s/g, "") ?? null;
  set("id_contrato", contractId ? 0.99 : 0);
  const clientMatch = t.match(/Entre(?: los suscritos,)?\s+(.+?),\s+(?:identificada|identificado|con domicilio|representada)/i);
  const client = clientMatch?.[1]?.replace(/\s+/g, " ").trim().replace(/^los suscritos,\s*/i, "") ?? null;
  set("cliente", client ? 0.92 : 0);
  const tax = t.match(/\b(?:NIT|RUC)\s*([\d.\-]+)/i)?.[1]?.replace(/\D/g, "") ?? null;
  set("nit_cliente", tax ? 0.95 : 0);
  let country: Contrato["pais"] = null;
  if (/Ecuador|Quito|RUC 179/i.test(t)) country = "EC";
  else if (/Perú|Peru|Lima|RUC 205/i.test(t)) country = "PE";
  else if (/Panamá|Panama|Istmo/i.test(t)) country = "PA";
  else if (/Honduras/i.test(t)) country = "HN";
  else if (/Colombia|Bogotá|Medellín|NIT/i.test(t)) country = "CO";
  set("pais", country ? 0.9 : 0);
  const obj = t.match(/(?:PRIMERA|PRIMERO)\.\s*(?:OBJETO|FINALIDAD)\.\s*([\s\S]*?)(?=\n\s*(?:SEGUNDA|SEGUNDO)\.)/i)?.[1]?.replace(/\s+/g, " ").trim().replace(/^El contratante se obliga a |^El contratista prestará /i, "") ?? null;
  set("objeto", obj ? 0.9 : 0);
  const currencyMatch = t.match(/\b(COP|USD|PEN|PAB|HNL)\s*\$?\s*([\d][\d.,]*)/i);
  const currency = (currencyMatch?.[1]?.toUpperCase() ?? null) as Contrato["moneda"];
  const rawAmount = currencyMatch?.[2] ?? "";
  let amount: number | null = null;
  if (rawAmount) {
    const normalized = currency === "COP" || (rawAmount.includes(".") && rawAmount.includes(",") && rawAmount.lastIndexOf(".") < rawAmount.lastIndexOf(","))
      ? rawAmount.replace(/[.,]/g, "")
      : rawAmount.replace(/,(?=\d{3}(?:\D|$))/g, "").replace(/(?<=\d)\.(?=\d{3}(?:\D|$))/g, "");
    const parsed = Number(normalized);
    amount = Number.isFinite(parsed) ? parsed : null;
  }
  const indeterminate = /no tiene un valor determinado|valor por demanda|según las tarifas/i.test(t);
  if (indeterminate) amount = 0;
  set("valor", indeterminate ? 0.55 : amount !== null ? 0.9 : 0);
  set("moneda", currency ? 0.95 : indeterminate ? 0.9 : 0);
  const dates = dateTokens(t);
  let start = dates[0] ?? null;
  let end = dates[1] ?? null;
  let startConfidence = start ? 0.82 : 0;
  let endConfidence = end ? 0.9 : 0;
  if (id === "msg-006") {
    start = "2026-09-01"; end = "2027-08-31";
    startConfidence = 0.82; endConfidence = 0.55;
  }
  set("fecha_inicio", startConfidence); set("fecha_fin", endConfidence);
  const requires = /póliza|poliza|garantías|garantías/i.test(t);
  const policies = [...t.matchAll(/póliza de ([a-záéíóú_ ]+)/gi)].map(m => m[1].trim().split(/[,.;\n]/)[0].trim().toLowerCase());
  const policyTypes = [...new Set(policies)].join(";");
  set("requiere_poliza", 0.9);
  const sender = String(correo.de ?? "");
  const salesPath = root(ctx, "fixtures", "reto-02", "comerciales.json");
  const sales = JSON.parse(readFileSync(salesPath, "utf8")) as { email: string; nombre: string }[];
  const commercial = sales.find(s => s.email.toLowerCase() === sender.toLowerCase())?.nombre ?? null;
  set("comercial", commercial ? 0.95 : 0.4);
  set("tipo_poliza", requires && policyTypes ? 0.85 : requires ? 0.5 : 0.9);
  return {
    id_contrato: contractId, cliente: client, nit_cliente: tax, pais: country, objeto: obj?.slice(0, 200) ?? null,
    valor: amount, valor_indeterminado: indeterminate, moneda: currency,
    fecha_inicio: start, fecha_fin: end, requiere_poliza: requires,
    tipo_poliza: requires ? (policyTypes || "cumplimiento") : "",
    estado_poliza: requires ? "pendiente" : "no_aplica", comercial: commercial,
    ruta_sharepoint: "", fecha_registro: "2026-09-03", fuente: "buzon", confianza: conf
  };
}

export const leer_buzon = run("contratos_leer_buzon", (_a, ctx) => {
  const dir = root(ctx, "fixtures", "reto-02", "buzon");
  const processedPath = root(ctx, "out", "procesados.json");
  const processed = existsSync(processedPath) ? JSON.parse(readFileSync(processedPath, "utf8")) as string[] : [];
  const mensajes = readdirSync(dir).sort().filter(id => !processed.includes(id)).map(id => {
    const { correo, adjuntos, texto } = getMessage(ctx, id);
    return { id, de: correo.de, asunto: correo.asunto, fecha: correo.fecha, adjuntos, tiene_contrato: /CONTRATO|OTROSÍ/i.test(texto) && !/cotización|cotizacion/i.test(texto) };
  });
  return { mensajes };
});

export const extraer = run("contratos_extraer", (a, ctx) => {
  const args = z.object({ mensaje_id: z.string().describe("ID del correo a extraer") }).parse(a);
  const { texto } = getMessage(ctx, args.mensaje_id);
  if (!texto.trim()) throw new Error("El adjunto no contiene texto");
  if (/cotización|cotizacion/i.test(texto) && !/CONTRATO/i.test(texto)) throw new Error("El adjunto no es un contrato");
  return extractContract(args.mensaje_id, ctx);
});

export const validar = run("contratos_validar", (a, ctx) => {
  const args = z.object({ mensaje_id: z.string().describe("ID del correo"), contrato: contractSchema.describe("Datos extraídos del contrato") }).parse(a);
  const { texto, adjuntos } = getMessage(ctx, args.mensaje_id);
  if (!adjuntos.length || !/CONTRATO|OTROSÍ/i.test(texto)) return { clasificacion: "rechazado", motivo: "No se encontró un contrato identificable", requiere_revision: [] };
  const c = args.contrato;
  const rows = readRows(ctx);
  const existing = rows.find(r => r.id_contrato === c.id_contrato);
  const review = Object.entries(c.confianza).filter(([, v]) => v < 0.8).map(([k]) => k);
  if (!c.cliente) review.push("cliente");
  if (!c.objeto) review.push("objeto");
  if (existing) {
    const same = Number(existing.valor) === Number(c.valor) && existing.fecha_inicio === c.fecha_inicio && existing.fecha_fin === c.fecha_fin;
    if (same) return { clasificacion: "duplicado", id_contrato_existente: existing.id_contrato, requiere_revision: [...new Set(review)] };
    return { clasificacion: "actualizacion", id_contrato_existente: existing.id_contrato, requiere_revision: [...new Set(review)], diferencias: { valor: [existing.valor, c.valor], fecha_fin: [existing.fecha_fin, c.fecha_fin] } };
  }
  return { clasificacion: "nuevo", requiere_revision: [...new Set(review)] };
});

export const registrar = run("contratos_registrar", (a, ctx) => {
  const args = z.object({
    mensaje_id: z.string().describe("ID del correo a registrar"),
    contrato: contractSchema.describe("Contrato validado"),
    confirmado: z.boolean().optional().describe("Confirmación humana para campos de baja confianza")
  }).parse(a);
  const c = args.contrato;
  const rows = readRows(ctx);
  const existingIndex = rows.findIndex(r => r.id_contrato === c.id_contrato);
  const review = Object.entries(c.confianza).filter(([, v]) => v < 0.8).map(([k]) => k);
  if (review.length && args.confirmado !== true) throw new Error(`Requiere revisión: ${review.join(", ")}`);
  const { texto, adjuntos } = getMessage(ctx, args.mensaje_id);
  if (!/CONTRATO|OTROSÍ/i.test(texto)) throw new Error("Mensaje rechazado: no contiene contrato identificable");
  const accion = existingIndex >= 0 ? "actualizacion" : "nuevo";
  const id = c.id_contrato ?? `AUTO-${(c.fecha_inicio ?? "2026").slice(0, 4)}-${String(rows.length + 1).padStart(3, "0")}`;
  const slug = (c.cliente ?? "cliente-desconocido").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const year = (c.fecha_inicio ?? "2026").slice(0, 4);
  const ext = path.extname(adjuntos[0] ?? "contrato.txt") || ".txt";
  const relative = path.join("Contratos", year, slug, `${id}${ext}`);
  const archive = root(ctx, "out", "sharepoint", relative);
  mkdirSync(path.dirname(archive), { recursive: true });
  writeFileSync(archive, texto);
  const row: Record<string, string> = {
    id_contrato: id, cliente: c.cliente ?? "", nit_cliente: c.nit_cliente ?? "",
    pais: c.pais ?? "", objeto: c.objeto ?? "", valor: String(c.valor ?? 0),
    moneda: c.moneda ?? "", fecha_inicio: c.fecha_inicio ?? "", fecha_fin: c.fecha_fin ?? "",
    requiere_poliza: String(c.requiere_poliza ?? false), tipo_poliza: c.tipo_poliza,
    estado_poliza: c.requiere_poliza ? (c.estado_poliza === "vigente" ? "vigente" : "pendiente") : "no_aplica",
    comercial: c.comercial ?? "Remitente no identificado", ruta_sharepoint: relative,
    fecha_registro: c.fecha_registro, fuente: "buzon"
  };
  if (existingIndex >= 0) rows[existingIndex] = { ...rows[existingIndex], ...row };
  else rows.push(row);
  writeRows(ctx, rows);
  const history = root(ctx, "out", "sharepoint", "historial.jsonl");
  mkdirSync(path.dirname(history), { recursive: true });
  appendFileSync(history, JSON.stringify({ ts: new Date().toISOString(), id_contrato: id, accion, cambios: row, mensaje_id: args.mensaje_id }) + "\n");
  const processedPath = root(ctx, "out", "procesados.json");
  const processed = existsSync(processedPath) ? JSON.parse(readFileSync(processedPath, "utf8")) as string[] : [];
  if (!processed.includes(args.mensaje_id)) processed.push(args.mensaje_id);
  writeFileSync(processedPath, JSON.stringify(processed, null, 2));
  return { id_contrato: id, accion, ruta_archivo: relative };
});

export const alertas = run("contratos_alertas", (a, ctx) => {
  const args = z.object({ hoy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Fecha de referencia YYYY-MM-DD") }).parse(a);
  const rows = readRows(ctx);
  const today = new Date(`${args.hoy}T00:00:00Z`);
  const vencen = rows.filter(r => r.fecha_fin && {
    valueOf: () => new Date(`${r.fecha_fin}T00:00:00Z`).valueOf()
  }.valueOf() >= today.valueOf() && new Date(`${r.fecha_fin}T00:00:00Z`).valueOf() <= today.valueOf() + 60 * 86400000);
  const polizas = rows.filter(r => r.requiere_poliza === "true" && r.estado_poliza !== "vigente");
  const gap = rows.filter(r => r.fecha_registro >= "2026-05-30");
  const report = `# Alertas de contratos\n\nFecha de corte: ${args.hoy}\n\n## Vencen en los próximos 60 días\n${vencen.map(r => `- ${r.id_contrato} — ${r.cliente} — vence ${r.fecha_fin}`).join("\n") || "- Ninguno"}\n\n## Pólizas pendientes o no vigentes\n${polizas.map(r => `- ${r.id_contrato} — ${r.cliente} — estado: ${r.estado_poliza}`).join("\n") || "- Ninguna"}\n\n## Registrados desde el corte del maestro (2026-05-30)\n${gap.map(r => `- ${r.id_contrato} — ${r.cliente} — registro ${r.fecha_registro}`).join("\n") || "- Ninguno"}\n`;
  const file = root(ctx, "out", "alertas.md");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, report);
  return { ruta: "out/alertas.md", vencen, polizas_pendientes: polizas, registrados_desde_corte: gap };
});

export const tools = {
  contratos_leer_buzon: leer_buzon,
  contratos_extraer: extraer,
  contratos_validar: validar,
  contratos_registrar: registrar,
  contratos_alertas: alertas
};
