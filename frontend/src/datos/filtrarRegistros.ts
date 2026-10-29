import { ETIQUETA_CATEGORIA, type Categoria, type DocumentoListado } from "../api/tipos"
import { formatMonto } from "../formato"

export type FiltroEstado = "todos" | "borrador" | "confirmado"
export type FiltroCategoria = "todas" | "sin" | Categoria

export type FiltrosRegistros = {
  desde: string
  hasta: string
  incluirSinPeriodo: boolean
  categoria: FiltroCategoria
  estado: FiltroEstado
  moneda: string
  texto: string
}

export const FILTROS_INICIALES: FiltrosRegistros = {
  desde: "",
  hasta: "",
  incluirSinPeriodo: true,
  categoria: "todas",
  estado: "todos",
  moneda: "",
  texto: "",
}

const PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/
const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/

function esPeriodo(valor: string): boolean {
  return PERIODO.test(valor)
}

function esFecha(valor: string): boolean {
  const partes = FECHA.exec(valor)
  if (partes === null) return false
  const anio = Number(partes[1])
  const mes = Number(partes[2])
  const dia = Number(partes[3])
  const fecha = new Date(Date.UTC(anio, mes - 1, dia))
  return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia
}

function finDeMes(periodo: string): string {
  const anio = Number(periodo.slice(0, 4))
  const mes = Number(periodo.slice(5, 7))
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate()
  return `${periodo}-${String(ultimo).padStart(2, "0")}`
}

export function rangoInvalido(filtros: FiltrosRegistros): string | null {
  if (filtros.desde !== "" && !esFecha(filtros.desde)) {
    return "El desde tiene que ser una fecha."
  }
  if (filtros.hasta !== "" && !esFecha(filtros.hasta)) {
    return "El hasta tiene que ser una fecha."
  }
  if (filtros.desde !== "" && filtros.hasta !== "" && filtros.desde > filtros.hasta) {
    return "El desde tiene que ser anterior o igual al hasta."
  }
  return null
}

function periodoItem(item: DocumentoListado): string | null {
  const periodo = item.campos.periodo
  return periodo !== undefined && esPeriodo(periodo) ? periodo : null
}

function pasaPeriodo(item: DocumentoListado, filtros: FiltrosRegistros): boolean {
  const periodo = periodoItem(item)
  if (periodo === null) {
    const hayRango = filtros.desde !== "" || filtros.hasta !== ""
    return !hayRango || filtros.incluirSinPeriodo
  }
  const inicio = `${periodo}-01`
  const fin = finDeMes(periodo)
  if (filtros.desde !== "" && fin < filtros.desde) return false
  if (filtros.hasta !== "" && inicio > filtros.hasta) return false
  return true
}

function pasaCategoria(item: DocumentoListado, categoria: FiltroCategoria): boolean {
  if (categoria === "todas") return true
  if (categoria === "sin") return item.campos.categoria === undefined
  return item.campos.categoria === categoria
}

function pasaEstado(item: DocumentoListado, estado: FiltroEstado): boolean {
  return estado === "todos" || item.estado === estado
}

function pasaMoneda(item: DocumentoListado, moneda: string): boolean {
  const esperada = moneda.trim().toUpperCase()
  if (esperada === "") return true
  return (item.campos.moneda ?? "").trim().toUpperCase() === esperada
}

function valoresTexto(item: DocumentoListado): string[] {
  const campos = item.campos
  const categoria = campos.categoria
  return [
    campos.proveedor ?? "",
    categoria ?? "",
    categoria === undefined ? "Sin categoría" : ETIQUETA_CATEGORIA[categoria],
    campos.periodo ?? "",
    campos.numero_comprobante ?? "",
    campos.monto ?? "",
    campos.moneda ?? "",
    formatMonto(campos.monto, campos.moneda),
    item.estado,
    item.estado === "borrador" ? "Borrador" : "Confirmado",
  ]
}

function pasaTexto(item: DocumentoListado, texto: string): boolean {
  const aguja = texto.trim().toLowerCase()
  if (aguja === "") return true
  return valoresTexto(item).some((valor) => valor.trim().toLowerCase().includes(aguja))
}

function coincide(item: DocumentoListado, filtros: FiltrosRegistros): boolean {
  return (
    pasaPeriodo(item, filtros) &&
    pasaCategoria(item, filtros.categoria) &&
    pasaEstado(item, filtros.estado) &&
    pasaMoneda(item, filtros.moneda) &&
    pasaTexto(item, filtros.texto)
  )
}

export function filtrarRegistros(
  items: readonly DocumentoListado[],
  filtros: FiltrosRegistros,
): DocumentoListado[] {
  if (rangoInvalido(filtros) !== null) return []
  return items.filter((item) => coincide(item, filtros))
}

export function monedasDe(items: readonly DocumentoListado[]): string[] {
  const monedas = new Set<string>()
  for (const item of items) {
    const moneda = (item.campos.moneda ?? "").trim().toUpperCase()
    if (moneda !== "") monedas.add(moneda)
  }
  return [...monedas].sort((a, b) => a.localeCompare(b, "es"))
}
