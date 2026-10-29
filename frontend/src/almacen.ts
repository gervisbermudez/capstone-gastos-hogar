const CLAVE_TOKEN = "gastos.access_token"
const CLAVE_HILO = "gastos.thread_id"
const CLAVE_JOB = "gastos.job_pendiente"
const CLAVE_TRANSCRIPTOS = "gastos.transcriptos"
const CLAVE_CONSULTA = "gastos.consulta_pendiente"
const CLAVE_CONTEXTO = "gastos.chat_contexto"

export type ContextoChat = {
  comprobanteId: string
  threadId: string | null
}

export const TOPE_TRANSCRIPTO = 100

export type FotoAdjunto = {
  id: string
  titulo: string
  detalle: string
}

export type MensajeGuardado =
  | { id: string; tipo: "persona"; texto: string; adjunto?: FotoAdjunto }
  | { id: string; tipo: "asistente"; texto: string }
  | { id: string; tipo: "nota"; texto: string }
  | { id: string; tipo: "aprobacion"; jobId: string; texto: string; resuelta: "si" | "no" | null }

export function leerToken(): string | null {
  return sessionStorage.getItem(CLAVE_TOKEN)
}

export function guardarToken(token: string): void {
  sessionStorage.setItem(CLAVE_TOKEN, token)
}

export function leerHilo(): string | null {
  return sessionStorage.getItem(CLAVE_HILO)
}

export function guardarHilo(threadId: string): void {
  sessionStorage.setItem(CLAVE_HILO, threadId)
}

export function olvidarHilo(): void {
  sessionStorage.removeItem(CLAVE_HILO)
  sessionStorage.removeItem(CLAVE_JOB)
  sessionStorage.removeItem(CLAVE_CONSULTA)
}

export function leerJobPendiente(): string | null {
  return sessionStorage.getItem(CLAVE_JOB)
}

export function guardarJobPendiente(jobId: string): void {
  sessionStorage.setItem(CLAVE_JOB, jobId)
}

export function olvidarJobPendiente(): void {
  sessionStorage.removeItem(CLAVE_JOB)
}

export function leerConsultaPendiente(): string | null {
  const valor = sessionStorage.getItem(CLAVE_CONSULTA)
  if (!valor?.trim()) return null
  return valor
}

export function guardarConsultaPendiente(texto: string): void {
  sessionStorage.setItem(CLAVE_CONSULTA, texto)
}

export function olvidarConsultaPendiente(): void {
  sessionStorage.removeItem(CLAVE_CONSULTA)
}

export function leerTranscripto(threadId: string): MensajeGuardado[] {
  return leerEntrada(threadId).mensajes
}

export function guardarTranscripto(
  threadId: string,
  mensajes: readonly MensajeGuardado[],
  jobAplicado?: string,
): void {
  if (!threadId) return
  const actual = leerEntrada(threadId)
  escribirEntrada(threadId, {
    mensajes: mensajes.slice(-TOPE_TRANSCRIPTO),
    jobAplicado: jobAplicado ?? actual.jobAplicado,
  })
}

export function olvidarTranscripto(threadId: string): void {
  if (!threadId) return
  quitarClave(CLAVE_TRANSCRIPTOS, threadId)
}

export function leerJobAplicado(threadId: string): string | null {
  return leerEntrada(threadId).jobAplicado
}

export function olvidarJobAplicado(threadId: string): void {
  if (!threadId) return
  const actual = leerEntrada(threadId)
  if (!actual.jobAplicado) return
  escribirEntrada(threadId, { mensajes: actual.mensajes, jobAplicado: null })
}

export function leerContextoChat(): ContextoChat | null {
  const crudo = sessionStorage.getItem(CLAVE_CONTEXTO)
  if (!crudo) return null
  try {
    const dato: unknown = JSON.parse(crudo)
    if (!dato || typeof dato !== "object" || Array.isArray(dato)) return null
    const registro = dato as Record<string, unknown>
    if (typeof registro.comprobanteId !== "string" || registro.comprobanteId === "") return null
    if (registro.threadId !== null && typeof registro.threadId !== "string") return null
    const threadId = typeof registro.threadId === "string" && registro.threadId !== "" ? registro.threadId : null
    return { comprobanteId: registro.comprobanteId, threadId }
  } catch {
    return null
  }
}

export function guardarContextoChat(contexto: ContextoChat): void {
  sessionStorage.setItem(
    CLAVE_CONTEXTO,
    JSON.stringify({ comprobanteId: contexto.comprobanteId, threadId: contexto.threadId }),
  )
}

export function olvidarContextoChat(): void {
  sessionStorage.removeItem(CLAVE_CONTEXTO)
}

export function olvidarSesion(): void {
  sessionStorage.removeItem(CLAVE_TOKEN)
  sessionStorage.removeItem(CLAVE_HILO)
  sessionStorage.removeItem(CLAVE_JOB)
  sessionStorage.removeItem(CLAVE_TRANSCRIPTOS)
  sessionStorage.removeItem(CLAVE_CONSULTA)
  sessionStorage.removeItem(CLAVE_CONTEXTO)
}

function leerObjeto(clave: string): Record<string, unknown> {
  const crudo = sessionStorage.getItem(clave)
  if (!crudo) return {}
  try {
    const dato: unknown = JSON.parse(crudo)
    if (!dato || typeof dato !== "object" || Array.isArray(dato)) return {}
    return dato as Record<string, unknown>
  } catch {
    return {}
  }
}

function leerEntrada(threadId: string): { mensajes: MensajeGuardado[]; jobAplicado: string | null } {
  const valor = leerObjeto(CLAVE_TRANSCRIPTOS)[threadId]
  if (Array.isArray(valor)) {
    return { mensajes: valor.filter(esMensajeGuardado).slice(-TOPE_TRANSCRIPTO), jobAplicado: null }
  }
  if (!valor || typeof valor !== "object") return { mensajes: [], jobAplicado: null }
  const entrada = valor as Record<string, unknown>
  const mensajes = Array.isArray(entrada.mensajes)
    ? entrada.mensajes.filter(esMensajeGuardado).slice(-TOPE_TRANSCRIPTO)
    : []
  const jobAplicado = typeof entrada.jobAplicado === "string" && entrada.jobAplicado ? entrada.jobAplicado : null
  return { mensajes, jobAplicado }
}

function escribirEntrada(threadId: string, entrada: { mensajes: readonly MensajeGuardado[]; jobAplicado: string | null }): void {
  const mapa = leerObjeto(CLAVE_TRANSCRIPTOS)
  mapa[threadId] = {
    mensajes: entrada.mensajes.slice(-TOPE_TRANSCRIPTO),
    jobAplicado: entrada.jobAplicado,
  }
  sessionStorage.setItem(CLAVE_TRANSCRIPTOS, JSON.stringify(mapa))
}

function quitarClave(clave: string, id: string): void {
  const mapa = leerObjeto(clave)
  if (!Object.hasOwn(mapa, id)) return
  delete mapa[id]
  if (Object.keys(mapa).length === 0) {
    sessionStorage.removeItem(clave)
    return
  }
  sessionStorage.setItem(clave, JSON.stringify(mapa))
}

function esFotoAdjunto(valor: unknown): valor is FotoAdjunto {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return false
  const foto = valor as Record<string, unknown>
  return typeof foto.id === "string" && foto.id !== "" && typeof foto.titulo === "string" && typeof foto.detalle === "string"
}

function esPersonaGuardada(mensaje: Record<string, unknown>): boolean {
  if (!("adjunto" in mensaje) || mensaje.adjunto == null) return true
  if (esFotoAdjunto(mensaje.adjunto)) return true
  delete mensaje.adjunto
  return true
}

function esMensajeGuardado(valor: unknown): valor is MensajeGuardado {
  if (!valor || typeof valor !== "object") return false
  const mensaje = valor as Record<string, unknown>
  if (typeof mensaje.id !== "string" || typeof mensaje.texto !== "string") return false
  if (mensaje.tipo === "asistente" || mensaje.tipo === "nota") return true
  if (mensaje.tipo === "persona") return esPersonaGuardada(mensaje)
  if (mensaje.tipo !== "aprobacion" || typeof mensaje.jobId !== "string") return false
  return mensaje.resuelta === "si" || mensaje.resuelta === "no" || mensaje.resuelta === null
}
