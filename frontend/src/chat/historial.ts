import type { Hilo } from "../api/tipos"

export const GRUPOS = ["Hoy", "Ayer", "Esta semana", "Anteriores"] as const

export type GrupoHistorial = (typeof GRUPOS)[number]

export type HiloVisible = Hilo & { cuando: string }

export type GrupoHilos = {
  etiqueta: GrupoHistorial
  items: HiloVisible[]
}

const UN_MINUTO = 60_000
const UNA_HORA = 60 * UN_MINUTO
const UN_DIA = 24 * UNA_HORA

const FORMATO_HORA = new Intl.DateTimeFormat("es-AR", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

const FORMATO_DIA = new Intl.DateTimeFormat("es-AR", { weekday: "long" })

const FORMATO_FECHA = new Intl.DateTimeFormat("es-AR", {
  day: "numeric",
  month: "short",
  year: "numeric",
})

function leerFecha(iso: string): Date | null {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return null
  return fecha
}

function diasCalendario(fecha: Date, ahora: Date): number {
  const diaFecha = Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate())
  const diaAhora = Date.UTC(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())
  return Math.round((diaAhora - diaFecha) / UN_DIA)
}

function normalizarTexto(texto: string): string {
  return texto.trim().normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es")
}

function limpiarAbreviatura(texto: string): string {
  return texto.trim().toLocaleLowerCase("es").replace(/\.+$/u, "")
}

function horaLocal(fecha: Date): string {
  const partes = FORMATO_HORA.formatToParts(fecha)
  const hora = partes.find((parte) => parte.type === "hour")?.value ?? ""
  const minuto = partes.find((parte) => parte.type === "minute")?.value ?? ""
  return `${hora}:${minuto}`
}

function diaCorto(fecha: Date): string {
  return limpiarAbreviatura(FORMATO_DIA.format(fecha))
}

function fechaCorta(fecha: Date, ahora: Date): string {
  const partes = FORMATO_FECHA.formatToParts(fecha)
  const dia = partes.find((parte) => parte.type === "day")?.value ?? ""
  const mes = limpiarAbreviatura(partes.find((parte) => parte.type === "month")?.value ?? "")
  if (fecha.getFullYear() === ahora.getFullYear()) return `${dia} ${mes}`
  const anio = partes.find((parte) => parte.type === "year")?.value ?? String(fecha.getFullYear())
  return `${dia} ${mes} ${anio}`
}

function fraccionMicros(iso: string): number {
  const coincidencia = /T\d{2}:\d{2}:\d{2}\.(\d+)/.exec(iso)
  if (!coincidencia) return 0
  const digitos = coincidencia[1].slice(0, 6).padEnd(6, "0")
  const valor = Number(digitos)
  return Number.isFinite(valor) ? valor : 0
}

export function etiquetaCuando(iso: string, ahora: Date = new Date()): string {
  const fecha = leerFecha(iso)
  if (!fecha) return ""

  const transcurrido = ahora.getTime() - fecha.getTime()
  if (Math.abs(transcurrido) < UN_MINUTO) return "ahora"
  if (transcurrido >= UN_MINUTO && transcurrido < UNA_HORA) {
    const minutos = Math.max(1, Math.floor(transcurrido / UN_MINUTO))
    return `hace ${minutos} min`
  }

  const dias = diasCalendario(fecha, ahora)
  if (dias === 0) return horaLocal(fecha)
  if (dias === 1) return "ayer"
  if (dias >= 2 && dias <= 7) return diaCorto(fecha)
  return fechaCorta(fecha, ahora)
}

function compararThread(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function compararHilos(a: Hilo, b: Hilo): number {
  const fechaA = leerFecha(a.actualizado_en)
  const fechaB = leerFecha(b.actualizado_en)
  if (!fechaA && !fechaB) return compararThread(a.thread_id, b.thread_id)
  if (!fechaA) return 1
  if (!fechaB) return -1

  const instanteA = fechaA.getTime()
  const instanteB = fechaB.getTime()
  if (instanteA !== instanteB) return instanteB - instanteA

  const microA = fraccionMicros(a.actualizado_en)
  const microB = fraccionMicros(b.actualizado_en)
  if (microA !== microB) return microB - microA
  return compararThread(a.thread_id, b.thread_id)
}

function grupoDe(iso: string, ahora: Date): GrupoHistorial {
  const fecha = leerFecha(iso)
  if (!fecha) return "Anteriores"
  const dias = diasCalendario(fecha, ahora)
  if (dias === 0) return "Hoy"
  if (dias === 1) return "Ayer"
  if (dias >= 2 && dias <= 7) return "Esta semana"
  return "Anteriores"
}

export function agruparHilos(
  hilos: readonly Hilo[],
  consulta: string,
  ahora: Date = new Date(),
): GrupoHilos[] {
  const busqueda = normalizarTexto(consulta)
  const ordenados = hilos.filter((hilo) => {
    if (busqueda === "") return true
    return normalizarTexto(hilo.titulo).includes(busqueda)
  })
  ordenados.sort(compararHilos)

  const porGrupo = new Map<GrupoHistorial, HiloVisible[]>()
  for (const hilo of ordenados) {
    const etiqueta = grupoDe(hilo.actualizado_en, ahora)
    const item: HiloVisible = {
      ...hilo,
      cuando: etiquetaCuando(hilo.actualizado_en, ahora),
    }
    const items = porGrupo.get(etiqueta)
    if (items) items.push(item)
    else porGrupo.set(etiqueta, [item])
  }

  const grupos: GrupoHilos[] = []
  for (const etiqueta of GRUPOS) {
    const items = porGrupo.get(etiqueta)
    if (items && items.length > 0) grupos.push({ etiqueta, items })
  }
  return grupos
}
