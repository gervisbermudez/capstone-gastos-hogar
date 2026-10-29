import { leerHogar, leerToken, olvidarSesion } from "../almacen"
import { olvidarResumenes } from "./cacheResumen"
import {
  ESTADOS_TAREA,
  type Cambio,
  type ConsultaTarea,
  type Credenciales,
  type CamposDocumento,
  type CategoriaCatalogo,
  type CategoriaItem,
  type DocumentoConfirmado,
  type DocumentoDetalle,
  type EstadoTarea,
  type Factura,
  type HiloDetalle,
  type Hogar,
  type Indexado,
  type ListaCategorias,
  type ListaDocumentos,
  type ListaHilos,
  type ListaHogares,
  type ListaMiembros,
  type MiembroHogar,
  type Resumen,
  type RolHogar,
  type RolMensaje,
  type CargaAceptada,
  type CargaEstado,
  type FaseCarga,
  type ListaNotificaciones,
  type ModeloActivo,
  type Notificacion,
  type TareaCreada,
  type TareaEstado,
  type Token,
  type UsuarioActual,
} from "./tipos"

export class ErrorApi extends Error {
  readonly status: number
  readonly campos: Readonly<Record<string, string>>

  constructor(message: string, status: number, campos: Record<string, string> = {}) {
    super(message)
    this.name = "ErrorApi"
    this.status = status
    this.campos = campos
  }
}

let alNoAutorizado = (): void => {}

export function registrarNoAutorizado(fn: () => void): void {
  alNoAutorizado = fn
}

function ponerHogar(headers: Headers): void {
  const hogarId = leerHogar()
  if (hogarId) headers.set("X-Hogar-Id", hogarId)
}

export function esAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

function origen(): string {
  const valor = import.meta.env.VITE_API_URL?.trim()
  if (!valor) throw new ErrorApi("Falta VITE_API_URL en el entorno del frontend.", 0)
  return valor.replace(/\/$/, "")
}

export function urlSocket(path: string): string {
  return `${origen().replace(/^http/i, "ws")}${path}`
}

export function cerrarPorSesion(): void {
  olvidarSesion()
  olvidarResumenes()
  alNoAutorizado()
}

function limpiarMensaje(mensaje: string): string {
  return mensaje.replace(/^Value error,\s*/i, "")
}

function leerCuerpo(cuerpo: unknown): { mensaje: string; campos: Record<string, string> } {
  if (!cuerpo || typeof cuerpo !== "object") {
    return { mensaje: "La API respondió con un error.", campos: {} }
  }
  const detalle = (cuerpo as { detail?: unknown }).detail
  if (typeof detalle === "string" && detalle.trim()) {
    return { mensaje: limpiarMensaje(detalle), campos: {} }
  }
  if (!Array.isArray(detalle)) {
    return { mensaje: "La API respondió con un error.", campos: {} }
  }
  const campos: Record<string, string> = {}
  const partes: string[] = []
  for (const item of detalle) {
    if (!item || typeof item !== "object") continue
    const crudo = "msg" in item && typeof item.msg === "string" ? item.msg : "Dato inválido"
    const msg = limpiarMensaje(crudo)
    const crudoLoc = "loc" in item && Array.isArray(item.loc) ? (item.loc as unknown[]) : []
    const loc = crudoLoc.map((parte) => String(parte))
    const campo = loc.filter((parte) => parte !== "body" && parte !== "query").at(-1)
    if (campo && !campos[campo]) campos[campo] = msg
    partes.push(msg)
  }
  return { mensaje: partes[0] ?? "Datos inválidos", campos }
}

type Pedido = {
  method?: string
  cuerpo?: unknown
  archivo?: File
  privado?: boolean
  signal?: AbortSignal
  esperado: number | number[]
}

function falloDeEstado(status: number, json: unknown): ErrorApi {
  if (status === 401) return new ErrorApi("Email o contraseña incorrectos.", 401)
  const leido = leerCuerpo(json)
  if (status === 404 && leido.mensaje === "Not Found") {
    return new ErrorApi("La API no tiene esa ruta.", 404, leido.campos)
  }
  return new ErrorApi(leido.mensaje, status, leido.campos)
}

async function enviar(path: string, opciones: Omit<Pedido, "esperado">): Promise<Response> {
  const headers = new Headers()
  const privado = opciones.privado !== false
  if (privado) {
    const token = leerToken()
    if (!token) {
      olvidarSesion()
      olvidarResumenes()
      alNoAutorizado()
      throw new ErrorApi("La sesión venció.", 401)
    }
    headers.set("Authorization", `Bearer ${token}`)
    ponerHogar(headers)
  }

  let body: BodyInit | undefined
  if (opciones.archivo) {
    const datos = new FormData()
    datos.append("archivo", opciones.archivo)
    body = datos
  } else if (opciones.cuerpo !== undefined) {
    headers.set("Content-Type", "application/json")
    body = JSON.stringify(opciones.cuerpo)
  }

  let respuesta: Response
  try {
    respuesta = await fetch(`${origen()}${path}`, {
      method: opciones.method ?? "GET",
      headers,
      body,
      signal: opciones.signal,
    })
  } catch (error) {
    if (esAbort(error)) throw error
    throw new ErrorApi("No se pudo conectar con la API.", 0)
  }

  if (respuesta.status === 401 && privado) {
    olvidarSesion()
    olvidarResumenes()
    alNoAutorizado()
    throw new ErrorApi("La sesión venció.", 401)
  }

  return respuesta
}

async function leerJson(respuesta: Response, esperado: number[]): Promise<unknown> {
  const texto = await respuesta.text()
  let json: unknown = null
  if (texto) {
    try {
      json = JSON.parse(texto) as unknown
    } catch {
      if (!esperado.includes(respuesta.status)) {
        throw new ErrorApi("La API respondió con un error.", respuesta.status)
      }
      throw new ErrorApi("La API devolvió una respuesta que no es JSON.", respuesta.status)
    }
  }

  if (!esperado.includes(respuesta.status)) throw falloDeEstado(respuesta.status, json)
  return json
}

async function pedir(path: string, opciones: Pedido): Promise<unknown> {
  const respuesta = await enviar(path, opciones)
  const esperado = Array.isArray(opciones.esperado) ? opciones.esperado : [opciones.esperado]
  return leerJson(respuesta, esperado)
}

async function rechazarSiNoEs200(respuesta: Response): Promise<void> {
  if (respuesta.status === 200) return
  const texto = await respuesta.text()
  let json: unknown = null
  if (texto) {
    try {
      json = JSON.parse(texto) as unknown
    } catch {
      throw new ErrorApi("La API respondió con un error.", respuesta.status)
    }
  }
  throw falloDeEstado(respuesta.status, json)
}

function exigirToken(valor: unknown): Token {
  if (!valor || typeof valor !== "object") throw new ErrorApi("La API no devolvió el token.", 0)
  const candidato = valor as Partial<Token>
  if (
    typeof candidato.access_token !== "string" ||
    candidato.access_token === "" ||
    candidato.token_type !== "bearer" ||
    typeof candidato.user_id !== "string" ||
    candidato.user_id === ""
  ) {
    throw new ErrorApi("La API no devolvió el token.", 0)
  }
  return {
    access_token: candidato.access_token,
    token_type: "bearer",
    user_id: candidato.user_id,
  }
}

function exigirTareaCreada(valor: unknown): TareaCreada {
  if (!valor || typeof valor !== "object") {
    throw new ErrorApi("La API no devolvió el job.", 0)
  }
  const candidato = valor as Partial<TareaCreada>
  if (
    typeof candidato.job_id !== "string" ||
    candidato.job_id === "" ||
    candidato.status !== "PENDING" ||
    typeof candidato.thread_id !== "string" ||
    candidato.thread_id === ""
  ) {
    throw new ErrorApi("La API no devolvió el job.", 0)
  }
  return {
    job_id: candidato.job_id,
    status: "PENDING",
    thread_id: candidato.thread_id,
  }
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null
}

function camposDe(valor: unknown): CamposDocumento {
  if (!esObjeto(valor)) return {}
  return valor as CamposDocumento
}

function esIndexado(valor: unknown): valor is Indexado {
  return valor === "ok" || valor === "error" || valor === "omitido"
}

function cambiosDe(valor: unknown): Cambio[] {
  if (!Array.isArray(valor)) return []
  const cambios: Cambio[] = []
  for (const item of valor) {
    if (!esObjeto(item) || typeof item.campo !== "string" || item.campo === "") continue
    cambios.push({
      campo: item.campo,
      antes: typeof item.antes === "string" ? item.antes : null,
      despues: typeof item.despues === "string" ? item.despues : null,
    })
  }
  return cambios
}

function datosConfirmado(valor: Record<string, unknown>): Pick<DocumentoConfirmado, "anulado" | "indexado" | "cambios"> {
  return {
    anulado: valor.anulado === true,
    indexado: esIndexado(valor.indexado) ? valor.indexado : null,
    cambios: cambiosDe(valor.cambios),
  }
}

function nombreDeUsuario(valor: unknown): string | null {
  if (valor == null) return null
  if (typeof valor !== "string") throw new ErrorApi("La API no devolvió la sesión.", 0)
  const texto = valor.trim()
  return texto === "" ? null : texto
}

function asegurarUsuario(valor: unknown): UsuarioActual {
  if (!esObjeto(valor) || typeof valor.user_id !== "string" || valor.user_id === "" || typeof valor.email !== "string") {
    throw new ErrorApi("La API no devolvió la sesión.", 0)
  }
  return { user_id: valor.user_id, email: valor.email, nombre: nombreDeUsuario(valor.nombre) }
}

function esProveedor(valor: unknown): valor is ModeloActivo["proveedor"] {
  return valor === "openai" || valor === "gemini"
}

function asegurarModelo(valor: unknown): ModeloActivo {
  if (!esObjeto(valor) || !esProveedor(valor.proveedor)) {
    throw new ErrorApi("La API no devolvió el modelo.", 0)
  }
  if (valor.modelo != null && typeof valor.modelo !== "string") {
    throw new ErrorApi("La API no devolvió el modelo.", 0)
  }
  const texto = typeof valor.modelo === "string" ? valor.modelo.trim() : ""
  return { proveedor: valor.proveedor, modelo: texto === "" ? null : texto }
}

function textoOpcional(valor: unknown): string | undefined {
  return typeof valor === "string" && valor.trim() !== "" ? valor : undefined
}

function asegurarDetalle(valor: unknown): DocumentoDetalle {
  if (!esObjeto(valor) || typeof valor.id !== "string" || valor.id === "") {
    throw new ErrorApi("La API no devolvió el comprobante.", 0)
  }
  const campos = camposDe(valor.campos)
  if (valor.estado === "borrador") {
    const creado_en = textoOpcional(valor.creado_en)
    const autor = emailAutor(valor)
    return {
      id: valor.id,
      estado: "borrador",
      campos,
      texto: typeof valor.texto === "string" ? valor.texto : "",
      advertencias: Array.isArray(valor.advertencias)
        ? valor.advertencias.filter((item): item is string => typeof item === "string")
        : [],
      ...(creado_en ? { creado_en } : {}),
      ...(autor ? { autor_email: autor } : {}),
    }
  }
  if (valor.estado === "confirmado") {
    const confirmado_en = textoOpcional(valor.confirmado_en)
    const autor = emailAutor(valor)
    return {
      id: valor.id,
      estado: "confirmado",
      campos,
      ...datosConfirmado(valor),
      ...(confirmado_en ? { confirmado_en } : {}),
      ...(autor ? { autor_email: autor } : {}),
    }
  }
  throw new ErrorApi("La API no devolvió el comprobante.", 0)
}

function asegurarConfirmado(valor: unknown, mensaje: string): DocumentoConfirmado {
  const detalle = asegurarDetalle(valor)
  if (detalle.estado !== "confirmado") throw new ErrorApi(mensaje, 0)
  return detalle
}

function emailAutor(valor: unknown): string | undefined {
  if (!esObjeto(valor) || typeof valor.autor_email !== "string") return undefined
  const texto = valor.autor_email.trim()
  return texto === "" ? undefined : texto
}

function asegurarLista(valor: unknown): ListaDocumentos {
  if (!esObjeto(valor) || !Array.isArray(valor.items)) {
    throw new ErrorApi("La API no devolvió los comprobantes.", 0)
  }
  return {
    items: valor.items.map((item) => {
      const detalle = asegurarDetalle(item)
      const autor = emailAutor(item)
      if (detalle.estado === "confirmado") {
        return {
          id: detalle.id,
          estado: detalle.estado,
          campos: detalle.campos,
          anulado: detalle.anulado,
          indexado: detalle.indexado,
          cambios: detalle.cambios,
          ...(autor ? { autor_email: autor } : {}),
        }
      }
      return {
        id: detalle.id,
        estado: detalle.estado,
        campos: detalle.campos,
        ...(autor ? { autor_email: autor } : {}),
      }
    }),
  }
}

function esCategoriaGasto(valor: unknown): valor is string {
  return typeof valor === "string" && valor.trim() !== ""
}

function asegurarResumen(valor: unknown): Resumen {
  if (
    !esObjeto(valor) ||
    !Array.isArray(valor.por_mes) ||
    !Array.isArray(valor.por_categoria) ||
    !Array.isArray(valor.comprobantes)
  ) {
    throw new ErrorApi("La API no devolvió el resumen.", 0)
  }
  return {
    por_mes: valor.por_mes.map((item) => {
      if (!esObjeto(item) || typeof item.periodo !== "string" || typeof item.total !== "string") {
        throw new ErrorApi("La API no devolvió el resumen.", 0)
      }
      return { periodo: item.periodo, total: item.total }
    }),
    por_categoria: valor.por_categoria.map((item) => {
      if (!esObjeto(item) || !esCategoriaGasto(item.categoria) || typeof item.total !== "string") {
        throw new ErrorApi("La API no devolvió el resumen.", 0)
      }
      return { categoria: item.categoria, total: item.total }
    }),
    comprobantes: valor.comprobantes.map((item) => {
      const detalle = asegurarDetalle(item)
      if (detalle.estado !== "confirmado") throw new ErrorApi("La API no devolvió el resumen.", 0)
      return detalle
    }),
  }
}

function esRol(valor: unknown): valor is RolMensaje {
  return valor === "persona" || valor === "asistente" || valor === "nota"
}

function asegurarListaHilos(valor: unknown): ListaHilos {
  if (!esObjeto(valor) || !Array.isArray(valor.items)) {
    throw new ErrorApi("La API no devolvió las conversaciones.", 0)
  }
  return {
    items: valor.items.map((item) => {
      if (
        !esObjeto(item) ||
        typeof item.thread_id !== "string" ||
        item.thread_id === "" ||
        typeof item.titulo !== "string" ||
        typeof item.actualizado_en !== "string"
      ) {
        throw new ErrorApi("La API no devolvió las conversaciones.", 0)
      }
      return {
        thread_id: item.thread_id,
        titulo: item.titulo,
        actualizado_en: item.actualizado_en,
      }
    }),
  }
}

function descripcionDeCategoria(valor: Record<string, unknown>, mensaje: string): string | null {
  if (!Object.hasOwn(valor, "descripcion")) throw new ErrorApi(mensaje, 0)
  const descripcion = valor.descripcion
  if (descripcion === null || typeof descripcion === "string") return descripcion
  throw new ErrorApi(mensaje, 0)
}

function asegurarCategoria(valor: unknown, mensaje = "La API no devolvió la categoría."): CategoriaItem {
  if (!esObjeto(valor) || typeof valor.id !== "string" || valor.id === "" || typeof valor.nombre !== "string") {
    throw new ErrorApi(mensaje, 0)
  }
  return {
    id: valor.id,
    nombre: valor.nombre,
    descripcion: descripcionDeCategoria(valor, mensaje),
  }
}

function esRolHogar(valor: unknown): valor is RolHogar {
  return valor === "administrador" || valor === "asociado"
}

function direccionDe(valor: unknown, mensaje: string): string | null {
  if (valor == null) return null
  if (typeof valor !== "string") throw new ErrorApi(mensaje, 0)
  const texto = valor.trim()
  return texto === "" ? null : texto
}

function asegurarHogar(valor: unknown, mensaje = "La API no devolvió el hogar."): Hogar {
  if (!esObjeto(valor) || typeof valor.id !== "string" || valor.id === "" || typeof valor.nombre !== "string") {
    throw new ErrorApi(mensaje, 0)
  }
  if (valor.nombre.trim() === "" || !esRolHogar(valor.rol)) throw new ErrorApi(mensaje, 0)
  return {
    id: valor.id,
    nombre: valor.nombre,
    direccion: direccionDe(valor.direccion, mensaje),
    rol: valor.rol,
  }
}

function asegurarListaHogares(valor: unknown): ListaHogares {
  if (!esObjeto(valor) || !Array.isArray(valor.items)) {
    throw new ErrorApi("La API no devolvió los hogares.", 0)
  }
  return {
    items: valor.items.map((item) => asegurarHogar(item, "La API no devolvió los hogares.")),
  }
}

function asegurarMiembro(valor: unknown, mensaje = "La API no devolvió el miembro."): MiembroHogar {
  if (
    !esObjeto(valor) ||
    typeof valor.user_id !== "string" ||
    valor.user_id === "" ||
    typeof valor.email !== "string" ||
    valor.email === "" ||
    !esRolHogar(valor.rol)
  ) {
    throw new ErrorApi(mensaje, 0)
  }
  return {
    user_id: valor.user_id,
    email: valor.email,
    nombre: nombreOpcional(valor.nombre, mensaje),
    rol: valor.rol,
  }
}

function nombreOpcional(valor: unknown, mensaje: string): string | null {
  if (valor == null) return null
  if (typeof valor !== "string") throw new ErrorApi(mensaje, 0)
  const texto = valor.trim()
  return texto === "" ? null : texto
}

function asegurarListaMiembros(valor: unknown): ListaMiembros {
  if (!esObjeto(valor) || !Array.isArray(valor.items)) {
    throw new ErrorApi("La API no devolvió los miembros.", 0)
  }
  return {
    items: valor.items.map((item) => asegurarMiembro(item, "La API no devolvió los miembros.")),
  }
}

function asegurarListaCategorias(valor: unknown): ListaCategorias {
  if (!esObjeto(valor) || !Array.isArray(valor.items)) {
    throw new ErrorApi("La API no devolvió las categorías.", 0)
  }
  return {
    items: valor.items.map((item) => asegurarCategoria(item, "La API no devolvió las categorías.")),
  }
}

function asegurarHilo(valor: unknown): HiloDetalle {
  if (
    !esObjeto(valor) ||
    typeof valor.thread_id !== "string" ||
    valor.thread_id === "" ||
    !Array.isArray(valor.mensajes)
  ) {
    throw new ErrorApi("La API no devolvió la conversación.", 0)
  }
  return {
    thread_id: valor.thread_id,
    mensajes: valor.mensajes.map((item) => {
      if (!esObjeto(item) || !esRol(item.rol) || typeof item.texto !== "string" || typeof item.creado_en !== "string") {
        throw new ErrorApi("La API no devolvió la conversación.", 0)
      }
      return { rol: item.rol, texto: item.texto, creado_en: item.creado_en }
    }),
  }
}

function esEstado(valor: unknown): valor is EstadoTarea {
  return typeof valor === "string" && ESTADOS_TAREA.includes(valor as EstadoTarea)
}

function exigirTareaEstado(valor: unknown): TareaEstado {
  if (!valor || typeof valor !== "object") throw new ErrorApi("La API no devolvió la tarea.", 0)
  const candidato = valor as Partial<TareaEstado>
  if (typeof candidato.job_id !== "string" || candidato.job_id === "") {
    throw new ErrorApi("La API no devolvió la tarea.", 0)
  }
  if (!esEstado(candidato.status)) throw new ErrorApi("Estado de tarea desconocido.", 0)
  if (typeof candidato.thread_id !== "string" || candidato.thread_id === "") {
    throw new ErrorApi("La API no devolvió la tarea.", 0)
  }
  const result =
    candidato.result == null ? null : typeof candidato.result === "string" ? candidato.result : null
  return {
    job_id: candidato.job_id,
    status: candidato.status,
    thread_id: candidato.thread_id,
    result,
  }
}

function esLatido(valor: unknown): boolean {
  return esObjeto(valor) && valor.tipo === "ping"
}

async function* eventosPorSocket(jobId: string, signal?: AbortSignal): AsyncGenerator<TareaEstado> {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError")
  const token = leerToken()
  if (!token) {
    olvidarSesion()
    olvidarResumenes()
    alNoAutorizado()
    throw new ErrorApi("La sesión venció.", 401)
  }

  const socket = new WebSocket(urlSocket(`/tasks/${encodeURIComponent(jobId)}/ws`))
  const pendientes: TareaEstado[] = []
  let cerrado = false
  let error: Error | null = null
  let despertar: (() => void) | null = null

  const seguir = () => {
    const fn = despertar
    despertar = null
    fn?.()
  }

  const alAbrir = () => {
    try {
      socket.send(JSON.stringify({ token }))
    } catch {
      error = new ErrorApi("No se pudo conectar con la API.", 0)
      seguir()
    }
  }
  const alMensaje = (evento: MessageEvent<unknown>) => {
    if (typeof evento.data !== "string") return
    let json: unknown
    try {
      json = JSON.parse(evento.data) as unknown
    } catch {
      error = new ErrorApi("La API devolvió un estado que no es JSON.", 0)
      seguir()
      return
    }
    if (esLatido(json)) return
    try {
      pendientes.push(exigirTareaEstado(json))
    } catch (falla) {
      error = falla instanceof Error ? falla : new ErrorApi("La API no devolvió la tarea.", 0)
    }
    seguir()
  }
  const alCerrar = (evento: CloseEvent) => {
    cerrado = true
    if (evento.code === 4401) {
      olvidarSesion()
      olvidarResumenes()
      alNoAutorizado()
      error = new ErrorApi("La sesión venció.", 401)
    } else if (evento.code === 4404) {
      error = new ErrorApi("No existe ese job_id.", 404)
    } else if (evento.code !== 1000 && evento.code !== 1005 && pendientes.length === 0 && !error) {
      error = new ErrorApi("No se pudo conectar con la API.", 0)
    }
    seguir()
  }

  socket.addEventListener("open", alAbrir)
  socket.addEventListener("message", alMensaje)
  socket.addEventListener("close", alCerrar)
  const alAbortar = () => {
    socket.close()
    seguir()
  }
  signal?.addEventListener("abort", alAbortar, { once: true })

  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError")
      const siguiente = pendientes.shift()
      if (siguiente) {
        yield siguiente
        continue
      }
      if (error) throw error
      if (cerrado) return
      await new Promise<void>((resolve) => {
        if (pendientes.length > 0 || cerrado || error || signal?.aborted) {
          resolve()
          return
        }
        despertar = resolve
      })
    }
  } finally {
    signal?.removeEventListener("abort", alAbortar)
    socket.removeEventListener("open", alAbrir)
    socket.removeEventListener("message", alMensaje)
    socket.removeEventListener("close", alCerrar)
    if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
      socket.close()
    }
  }
}

// Camino aparte de enviar(). Estas rutas responden 401 con "La contraseña no coincide."
// y eso no es una sesión vencida. Solo el detail "No autenticado" la cierra, como el resto.
async function pedirCuenta(
  path: string,
  method: "POST" | "DELETE",
  cuerpo: unknown,
  esperado: number[],
): Promise<unknown> {
  const token = leerToken()
  if (!token) {
    olvidarSesion()
    olvidarResumenes()
    alNoAutorizado()
    throw new ErrorApi("La sesión venció.", 401)
  }

  const headers = new Headers()
  headers.set("Authorization", `Bearer ${token}`)
  ponerHogar(headers)
  headers.set("Content-Type", "application/json")

  let respuesta: Response
  try {
    respuesta = await fetch(`${origen()}${path}`, {
      method,
      headers,
      body: JSON.stringify(cuerpo),
    })
  } catch (error) {
    if (esAbort(error)) throw error
    throw new ErrorApi("No se pudo conectar con la API.", 0)
  }

  const texto = await respuesta.text()
  let json: unknown = null
  if (texto) {
    try {
      json = JSON.parse(texto) as unknown
    } catch {
      if (!esperado.includes(respuesta.status)) {
        throw new ErrorApi("La API respondió con un error.", respuesta.status)
      }
      throw new ErrorApi("La API devolvió una respuesta que no es JSON.", respuesta.status)
    }
  }

  if (respuesta.status === 401) {
    const leido = leerCuerpo(json)
    if (leido.mensaje.trim() === "No autenticado") {
      olvidarSesion()
      olvidarResumenes()
      alNoAutorizado()
      throw new ErrorApi("La sesión venció.", 401)
    }
    throw new ErrorApi(leido.mensaje, 401, leido.campos)
  }

  if (!esperado.includes(respuesta.status)) throw falloDeEstado(respuesta.status, json)
  return json
}

const FASES_CARGA: readonly FaseCarga[] = ["recibida", "extrayendo", "lista", "falla"]

function exigirCargaAceptada(valor: unknown): CargaAceptada {
  if (!esObjeto(valor) || typeof valor.job_id !== "string" || valor.job_id === "") {
    throw new ErrorApi("La API no devolvió la carga.", 0)
  }
  if (valor.status !== "PENDING") throw new ErrorApi("La API no devolvió la carga.", 0)
  return { job_id: valor.job_id, status: "PENDING" }
}

function exigirCargaEstado(valor: unknown): CargaEstado {
  if (!esObjeto(valor) || typeof valor.job_id !== "string" || valor.job_id === "") {
    throw new ErrorApi("La API no devolvió la carga.", 0)
  }
  if (typeof valor.fase !== "string" || !FASES_CARGA.includes(valor.fase as FaseCarga)) {
    throw new ErrorApi("La API no devolvió la carga.", 0)
  }
  const documento =
    valor.documento_id == null
      ? null
      : typeof valor.documento_id === "string"
        ? valor.documento_id
        : null
  const mensaje = valor.mensaje == null ? null : typeof valor.mensaje === "string" ? valor.mensaje : null
  return {
    job_id: valor.job_id,
    fase: valor.fase as FaseCarga,
    documento_id: documento,
    mensaje,
  }
}

function exigirAccion(valor: unknown): Notificacion["accion"] {
  if (valor == null) return null
  if (!esObjeto(valor) || typeof valor.etiqueta !== "string" || typeof valor.ruta !== "string") return null
  if (!valor.etiqueta || !valor.ruta) return null
  return { etiqueta: valor.etiqueta, ruta: valor.ruta }
}

function exigirRecurso(valor: unknown): Notificacion["recurso"] {
  if (valor == null) return null
  if (!esObjeto(valor) || typeof valor.clase !== "string" || typeof valor.id !== "string") return null
  if (!valor.clase || !valor.id) return null
  return { clase: valor.clase, id: valor.id }
}

function exigirNotificacion(valor: unknown): Notificacion | null {
  if (!esObjeto(valor) || typeof valor.id !== "string" || valor.id === "") return null
  if (typeof valor.tipo !== "string" || typeof valor.titulo !== "string" || typeof valor.cuerpo !== "string") {
    return null
  }
  if (typeof valor.creada_en !== "string") return null
  return {
    id: valor.id,
    tipo: valor.tipo,
    titulo: valor.titulo,
    cuerpo: valor.cuerpo,
    accion: exigirAccion(valor.accion),
    recurso: exigirRecurso(valor.recurso),
    leida: valor.leida === true,
    creada_en: valor.creada_en,
  }
}

function exigirNotificaciones(valor: unknown): ListaNotificaciones {
  if (!esObjeto(valor) || !Array.isArray(valor.items)) {
    throw new ErrorApi("La API no devolvió las notificaciones.", 0)
  }
  const items: Notificacion[] = []
  for (const item of valor.items) {
    const aviso = exigirNotificacion(item)
    if (aviso) items.push(aviso)
  }
  const noLeidas = typeof valor.no_leidas === "number" && valor.no_leidas >= 0 ? valor.no_leidas : 0
  return { items, no_leidas: noLeidas }
}

export const cliente = {
  registrar(credenciales: Credenciales): Promise<Token> {
    return pedir("/auth/registro", {
      method: "POST",
      cuerpo: credenciales,
      privado: false,
      esperado: 201,
    }).then(exigirToken)
  },

  ingresar(credenciales: Credenciales): Promise<Token> {
    return pedir("/auth/login", {
      method: "POST",
      cuerpo: credenciales,
      privado: false,
      esperado: 200,
    }).then(exigirToken)
  },

  yo(signal?: AbortSignal): Promise<UsuarioActual> {
    return pedir("/auth/me", { signal, esperado: 200 }).then(asegurarUsuario)
  },

  cambiarEmail(email: string, password: string): Promise<UsuarioActual> {
    return pedirCuenta("/auth/email", "POST", { email, password }, [200]).then(asegurarUsuario)
  },

  cambiarNombre(nombre: string | null): Promise<UsuarioActual> {
    return pedirCuenta("/auth/nombre", "POST", { nombre }, [200]).then(asegurarUsuario)
  },

  modelo(signal?: AbortSignal): Promise<ModeloActivo> {
    return pedir("/auth/modelo", { signal, esperado: 200 }).then(asegurarModelo)
  },

  cambiarPassword(passwordActual: string, passwordNueva: string): Promise<void> {
    return pedirCuenta(
      "/auth/password",
      "POST",
      { password_actual: passwordActual, password_nueva: passwordNueva },
      [204],
    ).then(() => undefined)
  },

  eliminarCuenta(password: string): Promise<void> {
    return pedirCuenta("/auth/cuenta", "DELETE", { password }, [204]).then(() => undefined)
  },

  subir(archivo: File, signal?: AbortSignal): Promise<CargaAceptada> {
    return pedir("/documentos", {
      method: "POST",
      archivo,
      signal,
      esperado: 202,
    }).then(exigirCargaAceptada)
  },

  verCarga(jobId: string, signal?: AbortSignal): Promise<CargaEstado> {
    return pedir(`/cargas/${encodeURIComponent(jobId)}`, {
      signal,
      esperado: 200,
    }).then(exigirCargaEstado)
  },

  listarNotificaciones(signal?: AbortSignal): Promise<ListaNotificaciones> {
    return pedir("/notificaciones", { signal, esperado: 200 }).then(exigirNotificaciones)
  },

  marcarNotificacionLeida(id: string): Promise<void> {
    return pedir(`/notificaciones/${encodeURIComponent(id)}/leida`, {
      method: "POST",
      esperado: 204,
    }).then(() => undefined)
  },

  marcarNotificacionesLeidas(): Promise<void> {
    return pedir("/notificaciones/leidas", {
      method: "POST",
      esperado: 204,
    }).then(() => undefined)
  },

  limpiarNotificacionesLeidas(): Promise<void> {
    return pedir("/notificaciones/leidas", {
      method: "DELETE",
      esperado: 204,
    }).then(() => undefined)
  },

  listarDocumentos(signal?: AbortSignal): Promise<ListaDocumentos> {
    return pedir("/documentos", { signal, esperado: 200 }).then(asegurarLista)
  },

  verDocumento(id: string, signal?: AbortSignal): Promise<DocumentoDetalle> {
    return pedir(`/documentos/${encodeURIComponent(id)}`, {
      signal,
      esperado: 200,
    }).then(asegurarDetalle)
  },

  hilosDelDocumento(id: string, signal?: AbortSignal): Promise<ListaHilos> {
    return pedir(`/documentos/${encodeURIComponent(id)}/hilos`, {
      signal,
      esperado: 200,
    }).then(asegurarListaHilos)
  },

  confirmar(id: string, factura: Factura): Promise<DocumentoConfirmado> {
    return pedir(`/documentos/${encodeURIComponent(id)}/confirmar`, {
      method: "POST",
      cuerpo: factura,
      esperado: 200,
    }).then((valor) => {
      olvidarResumenes()
      return asegurarConfirmado(valor, "La API no confirmó el comprobante.")
    })
  },

  eliminar(id: string): Promise<void> {
    return pedir(`/documentos/${encodeURIComponent(id)}`, {
      method: "DELETE",
      esperado: 204,
    }).then(() => {
      olvidarResumenes()
    })
  },

  descartar(id: string): Promise<void> {
    return this.eliminar(id)
  },

  anular(id: string): Promise<DocumentoConfirmado> {
    return pedir(`/documentos/${encodeURIComponent(id)}/anular`, {
      method: "POST",
      esperado: 200,
    }).then((valor) => {
      olvidarResumenes()
      return asegurarConfirmado(valor, "La API no devolvió el comprobante.")
    })
  },

  corregir(id: string, factura: Factura): Promise<DocumentoConfirmado> {
    return pedir(`/documentos/${encodeURIComponent(id)}/corregir`, {
      method: "POST",
      cuerpo: factura,
      esperado: 200,
    }).then((valor) => {
      olvidarResumenes()
      return asegurarConfirmado(valor, "La API no devolvió el comprobante.")
    })
  },

  archivo(id: string, signal?: AbortSignal): Promise<Blob> {
    return enviar(`/documentos/${encodeURIComponent(id)}/archivo`, { signal }).then(async (respuesta) => {
      await rechazarSiNoEs200(respuesta)
      return respuesta.blob()
    })
  },

  exportar(desde: string, hasta: string, signal?: AbortSignal): Promise<string> {
    const consulta = new URLSearchParams({ desde, hasta })
    return enviar(`/export?${consulta.toString()}`, { signal }).then(async (respuesta) => {
      await rechazarSiNoEs200(respuesta)
      return respuesta.text()
    })
  },

  resumen(desde: string, hasta: string, signal?: AbortSignal): Promise<Resumen> {
    const consulta = new URLSearchParams({ desde, hasta })
    return pedir(`/resumen?${consulta.toString()}`, {
      signal,
      esperado: 200,
    }).then(asegurarResumen)
  },

  crearTarea(consulta: ConsultaTarea): Promise<TareaCreada> {
    return pedir("/tasks", {
      method: "POST",
      cuerpo: consulta,
      esperado: 202,
    }).then(exigirTareaCreada)
  },

  verTarea(jobId: string, signal?: AbortSignal): Promise<TareaEstado> {
    return pedir(`/tasks/${encodeURIComponent(jobId)}`, { signal, esperado: 200 }).then(exigirTareaEstado)
  },

  eventosTarea(jobId: string, signal?: AbortSignal): AsyncGenerator<TareaEstado> {
    return eventosPorSocket(jobId, signal)
  },

  aprobar(jobId: string, aprobado: boolean): Promise<void> {
    return pedir(`/tasks/${encodeURIComponent(jobId)}/approve`, {
      method: "POST",
      cuerpo: { aprobado },
      esperado: 202,
    }).then(() => undefined)
  },

  listarHilos(signal?: AbortSignal): Promise<ListaHilos> {
    return pedir("/hilos", { signal, esperado: 200 }).then(asegurarListaHilos)
  },

  listarHilosArchivados(signal?: AbortSignal): Promise<ListaHilos> {
    return pedir("/hilos?archivados=true", { signal, esperado: 200 }).then(asegurarListaHilos)
  },

  archivarHilo(threadId: string): Promise<void> {
    return pedir(`/hilos/${encodeURIComponent(threadId)}/archivar`, {
      method: "POST",
      esperado: 204,
    }).then(() => undefined)
  },

  restaurarHilo(threadId: string): Promise<void> {
    return pedir(`/hilos/${encodeURIComponent(threadId)}/desarchivar`, {
      method: "POST",
      esperado: 204,
    }).then(() => undefined)
  },

  eliminarHilo(threadId: string): Promise<void> {
    return pedir(`/hilos/${encodeURIComponent(threadId)}`, {
      method: "DELETE",
      esperado: 204,
    }).then(() => undefined)
  },

  verHilo(threadId: string, signal?: AbortSignal): Promise<HiloDetalle> {
    return pedir(`/hilos/${encodeURIComponent(threadId)}`, {
      signal,
      esperado: 200,
    }).then(asegurarHilo)
  },

  listarCategorias(signal?: AbortSignal): Promise<ListaCategorias> {
    return pedir("/categorias", { signal, esperado: 200 }).then(asegurarListaCategorias)
  },

  crearCategoria(body: CategoriaCatalogo): Promise<CategoriaItem> {
    return pedir("/categorias", {
      method: "POST",
      cuerpo: body,
      esperado: 201,
    }).then((valor) => asegurarCategoria(valor))
  },

  actualizarCategoria(id: string, body: CategoriaCatalogo): Promise<CategoriaItem> {
    return pedir(`/categorias/${encodeURIComponent(id)}`, {
      method: "PATCH",
      cuerpo: body,
      esperado: 200,
    }).then((valor) => asegurarCategoria(valor))
  },

  eliminarCategoria(id: string): Promise<void> {
    return pedir(`/categorias/${encodeURIComponent(id)}`, {
      method: "DELETE",
      esperado: 204,
    }).then(() => undefined)
  },

  listarHogares(signal?: AbortSignal): Promise<ListaHogares> {
    return pedir("/hogares", { signal, esperado: 200 }).then(asegurarListaHogares)
  },

  crearHogar(datos: { nombre: string; direccion?: string | null }): Promise<Hogar> {
    return pedir("/hogares", {
      method: "POST",
      cuerpo: { nombre: datos.nombre, direccion: datos.direccion ?? null },
      esperado: 201,
    }).then((valor) => asegurarHogar(valor))
  },

  actualizarHogar(id: string, datos: { nombre: string; direccion?: string | null }): Promise<Hogar> {
    return pedir(`/hogares/${encodeURIComponent(id)}`, {
      method: "PATCH",
      cuerpo: { nombre: datos.nombre, direccion: datos.direccion ?? null },
      esperado: 200,
    }).then((valor) => asegurarHogar(valor))
  },

  listarMiembros(hogarId: string, signal?: AbortSignal): Promise<ListaMiembros> {
    return pedir(`/hogares/${encodeURIComponent(hogarId)}/miembros`, {
      signal,
      esperado: 200,
    }).then(asegurarListaMiembros)
  },

  agregarMiembro(hogarId: string, email: string): Promise<MiembroHogar> {
    return pedir(`/hogares/${encodeURIComponent(hogarId)}/miembros`, {
      method: "POST",
      cuerpo: { email },
      esperado: 201,
    }).then((valor) => asegurarMiembro(valor))
  },

  quitarMiembro(hogarId: string, userId: string): Promise<void> {
    return pedir(
      `/hogares/${encodeURIComponent(hogarId)}/miembros/${encodeURIComponent(userId)}`,
      {
        method: "DELETE",
        esperado: 204,
      },
    ).then(() => undefined)
  },

  dejarHogar(hogarId: string): Promise<void> {
    return pedir(`/hogares/${encodeURIComponent(hogarId)}/membresia`, {
      method: "DELETE",
      esperado: 204,
    }).then(() => undefined)
  },
}
