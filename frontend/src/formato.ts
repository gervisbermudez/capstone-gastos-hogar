const CODIGO_MONEDA = /^[A-Za-z]{3}$/
const PERIODO = /^(\d{4})-(0[1-9]|1[0-2])$/
const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
]

export function formatMonto(monto: string | undefined, moneda?: string): string {
  if (monto == null || monto.trim() === "") return "Sin monto"
  const valor = Number(monto)
  if (!Number.isFinite(valor)) return monto
  const propuesta = moneda?.trim() ?? ""
  const codigo = CODIGO_MONEDA.test(propuesta) ? propuesta.toUpperCase() : "ARS"
  try {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: codigo }).format(valor)
  } catch {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(valor)
  }
}

export function formatPeriodo(periodo: string | undefined): string {
  if (periodo == null || periodo.trim() === "") return "Sin período"
  const limpio = periodo.trim()
  const coincidencia = PERIODO.exec(limpio)
  if (!coincidencia) return limpio
  const mes = Number(coincidencia[2])
  return `${MESES[mes - 1]} ${coincidencia[1]}`
}

export function formatFecha(iso: string | undefined): string {
  if (iso == null || iso.trim() === "") return "Sin fecha"
  const limpio = iso.trim()
  const fecha = new Date(limpio)
  if (Number.isNaN(fecha.getTime())) return limpio
  return new Intl.DateTimeFormat("es-AR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(fecha)
}
