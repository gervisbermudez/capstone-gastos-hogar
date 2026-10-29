import type { CamposDocumento, Factura } from "./api/tipos"

export type BorradorFactura = {
  proveedor: string
  categoria: string
  periodo: string
  monto: string
  moneda: string
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

export function armarFactura(
  form: BorradorFactura,
): { ok: true; factura: Factura } | { ok: false; errores: ErroresFactura } {
  const errores: ErroresFactura = {}
  const proveedor = form.proveedor.trim()
  const categoria = form.categoria.trim()
  const periodo = form.periodo.trim()
  const montoTexto = form.monto.trim()
  if (!proveedor) errores.proveedor = "Falta el proveedor"
  if (!categoria) errores.categoria = "Falta la categoría"
  if (!periodo) errores.periodo = "Falta el período"
  else if (!PERIODO.test(periodo)) errores.periodo = "El período tiene que ser YYYY-MM"
  const monto = normalizarMonto(form.monto)
  if (!montoTexto) errores.monto = "Falta el monto"
  else if (!monto) errores.monto = "El monto tiene que ser un número con dos decimales"
  const moneda = form.moneda.trim() || "ARS"
  if (Object.keys(errores).length > 0 || !monto || categoria === "") {
    return { ok: false, errores }
  }
  return {
    ok: true,
    factura: {
      proveedor,
      categoria,
      periodo: form.periodo,
      monto,
      moneda,
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
    numero_comprobante: campos.numero_comprobante ?? "",
  }
}

export function periodoDe(fecha: Date): string {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`
}
