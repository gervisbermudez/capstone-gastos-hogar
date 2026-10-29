import { leerHogar } from "../almacen"
import type { Resumen } from "./tipos"

const resumenes = new Map<string, Resumen>()
let generacion = 0

function clave(desde: string, hasta: string): string {
  return `${leerHogar() ?? ""}:${desde}:${hasta}`
}

export function generacionResumenes(): number {
  return generacion
}

export function leerResumenGuardado(desde: string, hasta: string): Resumen | null {
  return resumenes.get(clave(desde, hasta)) ?? null
}

export function guardarResumen(desde: string, hasta: string, resumen: Resumen): void {
  resumenes.set(clave(desde, hasta), resumen)
}

export function olvidarResumenes(): void {
  resumenes.clear()
  generacion += 1
}
