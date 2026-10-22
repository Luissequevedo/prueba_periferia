import express from "express";
import path from "node:path";
import {
  leer_buzon,
  extraer,
  validar,
  registrar,
  alertas
} from "./tools/contratos.js";

import type { Ctx } from "./tools/contratos.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const directory = process.cwd();

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(directory, "src", "public")));

type ToolResult = {
  ok: boolean;
  data?: any;
  error?: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

type Pending = {
  mensaje_id: string;
  contrato: any;
};

const sessions = new Map<string, ChatMessage[]>();
const pending = new Map<string, Pending>();

async function execute(
  tool: { execute: (args: unknown, ctx: Ctx) => Promise<string> },
  args: unknown,
  sessionId: string
): Promise<ToolResult> {
  return JSON.parse(
    await tool.execute(args, { directory, sessionId })
  ) as ToolResult;
}

function saveMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string
) {
  const history = sessions.get(sessionId) ?? [];
  history.push({ role, content, timestamp: new Date().toISOString() });
  sessions.set(sessionId, history.slice(-50));
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    provider: "local-deterministic",
    model: null,
    message: "Servidor activo; el enrutamiento actual usa reglas, no un LLM."
  });
});

app.get("/api/sessions/:id", (req, res) => {
  res.json({
    sessionId: req.params.id,
    messages: sessions.get(req.params.id) ?? []
  });
});

app.post("/api/chat", async (req, res) => {
  const message = String(req.body?.message ?? "").trim();
  const sessionId = String(req.body?.sessionId ?? "default").slice(0, 100);

  if (!message) {
    res.status(400).json({ error: "El mensaje no puede estar vacío." });
    return;
  }

  saveMessage(sessionId, "user", message);

  const toolCalls: Array<{ name: string; result: ToolResult }> = [];
  let reply = "";
  let needsConfirmation = false;

  const invoke = async (
    name: string,
    tool: { execute: (args: unknown, ctx: Ctx) => Promise<string> },
    args: unknown
  ) => {
    const result = await execute(tool, args, sessionId);
    toolCalls.push({ name, result });
    return result;
  };

  try {
    const awaiting = pending.get(sessionId);
    const confirms = /\b(confirmo|confirmar|sí, registrar|si, registrar|aprobar)\b/i.test(message);

    if (awaiting && confirms) {
      const result = await invoke("contratos_registrar", registrar, {
        mensaje_id: awaiting.mensaje_id,
        contrato: awaiting.contrato,
        confirmado: true
      });

      if (result.ok) {
        pending.delete(sessionId);
        reply = `Contrato ${result.data.id_contrato} registrado tras tu confirmación. Acción: ${result.data.accion}. Archivo: ${result.data.ruta_archivo}.`;
      } else {
        reply = `No se pudo registrar el contrato: ${result.error}`;
        needsConfirmation = true;
      }
    } else if (/\b(buzón|buzon|bandeja|correos|mensajes pendientes|leer correos)\b/i.test(message)) {
      const result = await invoke("contratos_leer_buzon", leer_buzon, {});
      reply = result.ok
        ? `Buzón consultado:\n${JSON.stringify(result.data, null, 2)}`
        : `No pude leer el buzón: ${result.error}`;
    } else if (/\b(alertas|vencimientos|pólizas pendientes|polizas pendientes)\b/i.test(message)) {
      const hoy = new Date().toISOString().slice(0, 10);
      const result = await invoke("contratos_alertas", alertas, { hoy });
      reply = result.ok
        ? `Alertas generadas para ${hoy}:\n${JSON.stringify(result.data, null, 2)}`
        : `No pude generar las alertas: ${result.error}`;
    } else {
      const id = message.match(/\bmsg-\d{3}\b/i)?.[0]?.toLowerCase();

      if (!id) {
        reply = "Puedo ayudarte a leer el buzón, procesar un correo concreto (por ejemplo, «procesa msg-001») o generar alertas. Si un contrato requiere revisión, te pediré confirmación antes de registrarlo.";
      } else {
        const extracted = await invoke("contratos_extraer", extraer, { mensaje_id: id });

        if (!extracted.ok) {
          reply = `No pude extraer el contrato de ${id}: ${extracted.error}`;
        } else {
          const contrato = extracted.data;
          const checked = await invoke("contratos_validar", validar, {
            mensaje_id: id,
            contrato
          });

          if (!checked.ok) {
            reply = `Falló la validación de ${id}: ${checked.error}`;
          } else {
            const review: string[] = checked.data.requiere_revision ?? [];
            const classification = checked.data.clasificacion;

            if (classification === "rechazado") {
              reply = `El mensaje ${id} fue rechazado: ${checked.data.motivo ?? "no cumple los criterios de contrato"}.`;
            } else if (classification === "duplicado") {
              reply = `El mensaje ${id} corresponde a un duplicado. No se realizaron escrituras.`;
            } else if (review.length > 0) {
              pending.set(sessionId, { mensaje_id: id, contrato });
              needsConfirmation = true;
              reply = `El contrato de ${id} se clasificó como «${classification}», pero requiere revisión de estos campos: ${review.join(", ")}. No lo he registrado. Revisa los datos y escribe «confirmo» para autorizar el registro.`;
            } else {
              const saved = await invoke("contratos_registrar", registrar, {
                mensaje_id: id,
                contrato
              });

              reply = saved.ok
                ? `Contrato procesado y registrado. ID: ${saved.data.id_contrato}. Acción: ${saved.data.accion}. Archivo: ${saved.data.ruta_archivo}.`
                : `No se registró el contrato: ${saved.error}`;
            }
          }
        }
      }
    }
  } catch (error) {
    reply = `Error controlado: ${error instanceof Error ? error.message : String(error)}`;
  }

  saveMessage(sessionId, "assistant", reply);
  res.json({ sessionId, reply, toolCalls, needsConfirmation });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Agente de contratos disponible en http://localhost:${port}`);
});
