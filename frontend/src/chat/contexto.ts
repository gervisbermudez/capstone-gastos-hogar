import type { FotoAdjunto } from "../almacen"
import { ETIQUETA_CATEGORIA, etiquetaCategoria as etiquetaDeGasto, type CamposDocumento, type Categoria } from "../api/tipos"

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"

const CITA = new RegExp(`^\\[comprobante (${UUID})((?:\\s*\\|[^\\]]*)?)\\]\\s*`, "i")

const PREFIJO_CITA = new RegExp(`^\\[comprobante\\s+${UUID}\\b`, "i")

const CATEGORIAS = new Set<string>(Object.keys(ETIQUETA_CATEGORIA))

function parte(valor: string | undefined, vacio: string): string {
  const limpio = (valor ?? "").replace(/[\n\r\]]/g, " ").replace(/\|/g, "/").replace(/\s+/g, " ").trim()
  return limpio || vacio
}

export function citaComprobante(id: string, campos: CamposDocumento | undefined): string {
  const proveedor = parte(campos?.proveedor, "sin proveedor")
  const categoria = parte(campos?.categoria ? etiquetaDeGasto(campos.categoria) : undefined, "sin categoría")
  const periodo = parte(campos?.periodo, "sin período")
  return `[comprobante ${id} | ${proveedor} | ${categoria} | ${periodo}]`
}

export function textoVisible(texto: string): string {
  return texto.replace(CITA, "")
}

function etiquetaCategoria(valor: string): string {
  const limpio = valor.trim()
  const clave = limpio.toLowerCase()
  if (!limpio || clave === "sin categoría") return "Sin categoría"
  if (CATEGORIAS.has(clave)) return ETIQUETA_CATEGORIA[clave as Categoria]
  return limpio
}

function etiquetaPeriodo(valor: string): string {
  const limpio = valor.trim()
  if (!limpio || limpio.toLowerCase() === "sin período") return "Sin período"
  return limpio
}

export function fotoDesdeCita(texto: string): FotoAdjunto | null {
  const coincidencia = texto.match(CITA)
  const id = coincidencia?.[1]
  if (!id) return null
  const partes = (coincidencia[2] ?? "").split("|").slice(1).map((parte) => parte.trim())
  if (partes.length === 0) return { id, titulo: "Comprobante", detalle: "" }
  const proveedor = partes[0] ?? ""
  const titulo = !proveedor || proveedor.toLowerCase() === "sin proveedor" ? "Sin proveedor" : proveedor
  const detalle = partes.length > 1 ? `${etiquetaCategoria(partes[1] ?? "")} · ${etiquetaPeriodo(partes[2] ?? "")}` : ""
  return { id, titulo, detalle }
}

export function esTituloCita(titulo: string): boolean {
  return PREFIJO_CITA.test(titulo.trim())
}

export function tituloVisible(titulo: string): string {
  const visible = textoVisible(titulo).trim()
  if (!visible || esTituloCita(visible)) return "Conversación"
  return visible
}
