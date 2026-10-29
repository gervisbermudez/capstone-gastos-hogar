export type Categoria = "servicios" | "expensas" | "alquiler"

export type CategoriaItem = {
  id: string
  nombre: string
  descripcion: string | null
}

export type ListaCategorias = {
  items: CategoriaItem[]
}

export type CategoriaCatalogo = {
  nombre: string
  descripcion: string | null
}

export type EstadoDocumento = "borrador" | "confirmado"

export type EstadoTarea =
  | "PENDING"
  | "RUNNING"
  | "AWAITING_APPROVAL"
  | "FAILED"
  | "DONE"

export type Credenciales = {
  email: string
  password: string
}

export type Token = {
  access_token: string
  token_type: "bearer"
  user_id: string
}

export type UsuarioActual = {
  user_id: string
  email: string
  nombre: string | null
}

export type ModeloActivo = {
  proveedor: "openai" | "gemini"
  modelo: string | null
}

export type CamposDocumento = {
  proveedor?: string
  categoria?: string
  periodo?: string
  monto?: string
  moneda?: string
  numero_comprobante?: string
}

export type DocumentoBorrador = {
  id: string
  estado: "borrador"
  campos: CamposDocumento
  texto: string
  advertencias: string[]
  creado_en?: string
  autor_email?: string
}

export type Indexado = "ok" | "error" | "omitido"

export type Cambio = {
  campo: string
  antes: string | null
  despues: string | null
}

export type DocumentoConfirmado = {
  id: string
  estado: "confirmado"
  campos: CamposDocumento
  anulado: boolean
  indexado: Indexado | null
  cambios: Cambio[]
  confirmado_en?: string
  autor_email?: string
}

export type DocumentoDetalle = DocumentoBorrador | DocumentoConfirmado

export type DocumentoListado = {
  id: string
  estado: EstadoDocumento
  campos: CamposDocumento
  anulado?: boolean
  indexado?: Indexado | null
  cambios?: Cambio[]
  autor_email?: string
}

export type RolHogar = "administrador" | "asociado"

export type Hogar = {
  id: string
  nombre: string
  direccion: string | null
  rol: RolHogar
}

export type ListaHogares = {
  items: Hogar[]
}

export type MiembroHogar = {
  user_id: string
  email: string
  nombre: string | null
  rol: RolHogar
}

export type ListaMiembros = {
  items: MiembroHogar[]
}

export type ListaDocumentos = {
  items: DocumentoListado[]
}

export type Factura = {
  proveedor: string
  categoria: string
  periodo: string
  monto: string
  moneda: string
  numero_comprobante: string | null
}

export type TotalMes = {
  periodo: string
  total: string
}

export type TotalCategoria = {
  categoria: string
  total: string
}

export type Resumen = {
  por_mes: TotalMes[]
  por_categoria: TotalCategoria[]
  comprobantes: DocumentoConfirmado[]
}

export type ConsultaTarea = {
  query: string
  thread_id: string | null
}

export type TareaCreada = {
  job_id: string
  status: "PENDING"
  thread_id: string
}

export type TareaEstado = {
  job_id: string
  status: EstadoTarea
  thread_id: string
  result: string | null
}

export type AccionNotificacion = {
  etiqueta: string
  ruta: string
}

export type RecursoEvento = {
  clase: string
  id: string
}

export type Notificacion = {
  id: string
  tipo: string
  titulo: string
  cuerpo: string
  accion: AccionNotificacion | null
  recurso: RecursoEvento | null
  leida: boolean
  creada_en: string
}

export type ListaNotificaciones = {
  items: Notificacion[]
  no_leidas: number
}

export type CargaAceptada = {
  job_id: string
  status: "PENDING"
}

export type FaseCarga = "recibida" | "extrayendo" | "lista" | "falla"

export type CargaEstado = {
  job_id: string
  fase: FaseCarga
  documento_id: string | null
  mensaje: string | null
}

export type RolMensaje = "persona" | "asistente" | "nota"

export type MensajeHilo = {
  rol: RolMensaje
  texto: string
  creado_en: string
}

export type Hilo = {
  thread_id: string
  titulo: string
  actualizado_en: string
}

export type HiloDetalle = {
  thread_id: string
  mensajes: MensajeHilo[]
}

export type ListaHilos = {
  items: Hilo[]
}

export const ESTADOS_TAREA: readonly EstadoTarea[] = [
  "PENDING",
  "RUNNING",
  "AWAITING_APPROVAL",
  "FAILED",
  "DONE",
]

export const CATEGORIAS: readonly Categoria[] = ["servicios", "expensas", "alquiler"]

export const ETIQUETA_CATEGORIA: Record<Categoria, string> = {
  servicios: "Servicios",
  expensas: "Expensas",
  alquiler: "Alquiler",
}

export function esCategoriaFija(valor: string): valor is Categoria {
  return valor === "servicios" || valor === "expensas" || valor === "alquiler"
}

export function valorCategoria(nombre: string): string {
  const texto = nombre.trim()
  const clave = texto.toLowerCase()
  return esCategoriaFija(clave) ? clave : texto
}

export function etiquetaCategoria(valor: string | null | undefined): string {
  if (valor == null || valor.trim() === "") return "Sin categoría"
  const texto = valor.trim()
  const clave = texto.toLowerCase()
  if (esCategoriaFija(clave)) return ETIQUETA_CATEGORIA[clave]
  return texto
}

export function esBorrador(doc: DocumentoDetalle): doc is DocumentoBorrador {
  return doc.estado === "borrador"
}
