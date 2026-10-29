import { ESTADOS_TAREA, type CargaEstado, type FaseCarga, type Notificacion, type TareaEstado } from "./api/tipos"

export type AvisoEnVivo = {
  id: string
  titulo: string
  cuerpo: string
  accion: Notificacion["accion"]
  creada_en: string
}

export type EventoCanal = {
  id: string
  tipo: string
  creado_en: string
  recurso: Notificacion["recurso"]
  payload: unknown
  notificacion: AvisoEnVivo | null
}

type Oyente = (evento: EventoCanal) => void
type Marca = (clase: string, id: string) => void

const oyentes = new Set<Oyente>()
const jobsEnPantalla = new Set<string>()
let conectado = false
let panelAbierto = false
let marcarRecurso: Marca = () => {}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null
}

export function publicarConexion(valor: boolean): void {
  conectado = valor
}

export function canalConectado(): boolean {
  return conectado
}

export function publicarPanel(abierto: boolean): void {
  panelAbierto = abierto
}

export function panelEstaAbierto(): boolean {
  return panelAbierto
}

export function seguirJob(jobId: string): () => void {
  jobsEnPantalla.add(jobId)
  return () => {
    jobsEnPantalla.delete(jobId)
  }
}

export function jobEnPantalla(jobId: string | undefined): boolean {
  return jobId !== undefined && jobsEnPantalla.has(jobId)
}

export function registrarMarcaRecurso(fn: Marca): void {
  marcarRecurso = fn
}

export function marcarLeidasDeRecurso(clase: string, id: string): void {
  marcarRecurso(clase, id)
}

export function suscribirEventos(oyente: Oyente): () => void {
  oyentes.add(oyente)
  return () => {
    oyentes.delete(oyente)
  }
}

export function publicarEvento(evento: EventoCanal): void {
  for (const oyente of [...oyentes]) oyente(evento)
}

export function leerEvento(valor: unknown): EventoCanal | "listo" | "ping" | null {
  if (!esObjeto(valor) || typeof valor.tipo !== "string") return null
  if (valor.tipo === "ping") return "ping"
  if (valor.tipo === "listo") return "listo"
  if (typeof valor.id !== "string" || valor.id === "") return null
  const creado = typeof valor.creado_en === "string" ? valor.creado_en : ""
  let notificacion: AvisoEnVivo | null = null
  if (esObjeto(valor.notificacion) && typeof valor.notificacion.id === "string") {
    const accion = valor.notificacion.accion
    let boton: Notificacion["accion"] = null
    if (
      esObjeto(accion) &&
      typeof accion.etiqueta === "string" &&
      accion.etiqueta &&
      typeof accion.ruta === "string" &&
      accion.ruta
    ) {
      boton = { etiqueta: accion.etiqueta, ruta: accion.ruta }
    }
    notificacion = {
      id: valor.notificacion.id,
      titulo: typeof valor.notificacion.titulo === "string" ? valor.notificacion.titulo : "",
      cuerpo: typeof valor.notificacion.cuerpo === "string" ? valor.notificacion.cuerpo : "",
      accion: boton,
      creada_en: typeof valor.notificacion.creada_en === "string" ? valor.notificacion.creada_en : creado,
    }
  }
  let recurso: Notificacion["recurso"] = null
  if (esObjeto(valor.recurso) && typeof valor.recurso.clase === "string" && typeof valor.recurso.id === "string") {
    recurso = { clase: valor.recurso.clase, id: valor.recurso.id }
  }
  return {
    id: valor.id,
    tipo: valor.tipo,
    creado_en: creado,
    recurso,
    payload: valor.payload,
    notificacion,
  }
}

export function notificacionDe(evento: EventoCanal): Notificacion | null {
  const aviso = evento.notificacion
  if (!aviso) return null
  return {
    id: aviso.id,
    tipo: evento.tipo,
    titulo: aviso.titulo,
    cuerpo: aviso.cuerpo,
    accion: aviso.accion,
    recurso: evento.recurso,
    leida: false,
    creada_en: aviso.creada_en || evento.creado_en,
  }
}

export function tareaDeEvento(evento: EventoCanal, jobId: string): TareaEstado | null {
  if (evento.tipo !== "chat.estado" || !esObjeto(evento.payload)) return null
  const candidato = evento.payload
  if (candidato.job_id !== jobId) return null
  if (typeof candidato.job_id !== "string" || typeof candidato.thread_id !== "string") return null
  if (typeof candidato.status !== "string" || !ESTADOS_TAREA.includes(candidato.status as TareaEstado["status"])) {
    return null
  }
  const result = candidato.result == null ? null : typeof candidato.result === "string" ? candidato.result : null
  return {
    job_id: candidato.job_id,
    status: candidato.status as TareaEstado["status"],
    thread_id: candidato.thread_id,
    result,
  }
}

const FASES: readonly FaseCarga[] = ["recibida", "extrayendo", "lista", "falla"]

export function cargaDeEvento(evento: EventoCanal): CargaEstado | null {
  if (evento.tipo !== "carga.estado" || !esObjeto(evento.payload)) return null
  const candidato = evento.payload
  if (typeof candidato.job_id !== "string" || candidato.job_id === "") return null
  if (typeof candidato.fase !== "string" || !FASES.includes(candidato.fase as FaseCarga)) return null
  return {
    job_id: candidato.job_id,
    fase: candidato.fase as FaseCarga,
    documento_id: typeof candidato.documento_id === "string" ? candidato.documento_id : null,
    mensaje: typeof candidato.mensaje === "string" ? candidato.mensaje : null,
  }
}
