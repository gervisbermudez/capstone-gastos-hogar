const CODIGO_MONEDA = /^[A-Za-z]{3}$/

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
