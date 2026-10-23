import type { CamposDocumento, Categoria, Factura } from "./api/tipos"

export type BorradorFactura = {
  proveedor: string
  categoria: Categoria | ""
  periodo: string
  monto: string
  moneda: string
  vencimiento: string
  numero_comprobante: string
}

export type ErroresFactura = Partial<Record<keyof BorradorFactura, string>>

const PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/
const MONTO = /^\d+\.\d{2}$/

export function normalizarMonto(entrada: string): string | null {
  const limpio = entrada.trim().replace(/\s/g, "")
  const conPunto =
    limpio.includes(",") && !limpio.includes(".") ? limpio.replace(",", ".") : limpio
  if (/^\d+$/.test(conPunto)) return `${conPunto}.00`
  if (/^\d+\.\d$/.test(conPunto)) return `${conPunto}0`
  if (MONTO.test(conPunto)) return conPunto
  return null
}

function fechaValida(valor: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false
  const [anio, mes, dia] = valor.split("-").map(Number)
  if (anio === undefined || mes === undefined || dia === undefined) return false
  const fecha = new Date(Date.UTC(anio, mes - 1, dia))
  return (
    fecha.getUTCFullYear() === anio &&
    fecha.getUTCMonth() === mes - 1 &&
    fecha.getUTCDate() === dia
  )
}

export function armarFactura(
  form: BorradorFactura,
): { ok: true; factura: Factura } | { ok: false; errores: ErroresFactura } {
  const errores: ErroresFactura = {}
  const proveedor = form.proveedor.trim()
  if (!proveedor) errores.proveedor = "Falta el proveedor"
  if (form.categoria !== "servicios" && form.categoria !== "expensas" && form.categoria !== "alquiler") {
    errores.categoria = "Elegí servicios, expensas o alquiler"
  }
  if (!PERIODO.test(form.periodo)) errores.periodo = "El período tiene que ser YYYY-MM"
  const monto = normalizarMonto(form.monto)
  if (!monto) errores.monto = "El monto tiene que ser un número con dos decimales"
  const moneda = form.moneda.trim() || "ARS"
  let vencimiento: string | null = null
  const vencimientoTexto = form.vencimiento.trim()
  if (vencimientoTexto) {
    if (!fechaValida(vencimientoTexto)) errores.vencimiento = "La fecha tiene que ser YYYY-MM-DD"
    else vencimiento = vencimientoTexto
  }
  if (Object.keys(errores).length > 0 || !monto || form.categoria === "") {
    return { ok: false, errores }
  }
  return {
    ok: true,
    factura: {
      proveedor,
      categoria: form.categoria,
      periodo: form.periodo,
      monto,
      moneda,
      vencimiento,
      numero_comprobante: form.numero_comprobante.trim() || null,
    },
  }
}

export function desdeCampos(campos: CamposDocumento): BorradorFactura {
  return {
    proveedor: campos.proveedor ?? "",
    categoria: campos.categoria ?? "",
    periodo: campos.periodo ?? "",
    monto: campos.monto ?? "",
    moneda: campos.moneda ?? "ARS",
    vencimiento: campos.vencimiento ?? "",
    numero_comprobante: campos.numero_comprobante ?? "",
  }
}

export function periodoDe(fecha: Date): string {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`
}
