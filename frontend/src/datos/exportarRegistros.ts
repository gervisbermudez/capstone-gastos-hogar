import { utils, writeFile } from "xlsx"
import { etiquetaCategoria, type DocumentoListado } from "../api/tipos"

const HOJA = "Registros"
const ARCHIVO = "registros.xlsx"

const COLUMNAS = [
  "Proveedor",
  "Categoría",
  "Período",
  "Número",
  "Monto",
  "Moneda",
  "Estado",
] as const

type FilaRegistro = {
  Proveedor: string
  Categoría: string
  Período: string
  Número: string
  Monto: number | null
  Moneda: string
  Estado: "Confirmado" | "Borrador"
}

function texto(valor: string | undefined): string {
  return (valor ?? "").trim()
}

function montoCelda(monto: string | undefined): number | null {
  if (monto == null || monto.trim() === "") return null
  const valor = Number(monto)
  return Number.isFinite(valor) ? valor : null
}

function categoriaCelda(categoria: DocumentoListado["campos"]["categoria"]): string {
  return etiquetaCategoria(categoria)
}

function filaRegistro(item: DocumentoListado): FilaRegistro {
  const proveedor = texto(item.campos.proveedor)
  const periodo = texto(item.campos.periodo)
  return {
    Proveedor: proveedor === "" ? "Sin proveedor" : proveedor,
    Categoría: categoriaCelda(item.campos.categoria),
    Período: periodo === "" ? "Sin período" : periodo,
    Número: texto(item.campos.numero_comprobante),
    Monto: montoCelda(item.campos.monto),
    Moneda: texto(item.campos.moneda).toUpperCase(),
    Estado: item.estado === "confirmado" ? "Confirmado" : "Borrador",
  }
}

export function descargarRegistrosExcel(items: readonly DocumentoListado[]): void {
  const filas = items.map(filaRegistro)
  const hoja = utils.json_to_sheet(filas, { header: [...COLUMNAS] })
  const libro = utils.book_new()
  utils.book_append_sheet(libro, hoja, HOJA)
  writeFile(libro, ARCHIVO)
}
