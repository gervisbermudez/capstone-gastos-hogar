import { ErrorApi, cliente } from "./api/cliente"
import type { CargaEstado, DocumentoBorrador } from "./api/tipos"
import { toaster } from "./avisos"
import { canalConectado, cargaDeEvento, marcarLeidasDeRecurso, suscribirEventos } from "./canalBus"
import { guardarVista } from "./vistas"

export const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024
export const MENSAJE_TAMANO = "El archivo supera el tamaño máximo."

export type EstadoCarga =
  | { fase: "ociosa" }
  | { fase: "leyendo"; archivo: File }
  | { fase: "extrayendo"; archivo: File; jobId: string }
  | { fase: "lista"; archivo: File; documento: DocumentoBorrador }
  | { fase: "falla"; archivo: File; mensaje: string }

export function cargaEnPantalla(): boolean {
  return oyentes.size > 0
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

type Oyente = (estado: EstadoCarga) => void

let estado: EstadoCarga = { fase: "ociosa" }
let generacion = 0
const oyentes = new Set<Oyente>()
const alListo = new Set<() => void>()

export function leerCarga(): EstadoCarga {
  return estado
}

export function suscribirCarga(oyente: Oyente): () => void {
  oyentes.add(oyente)
  return () => {
    oyentes.delete(oyente)
  }
}

export function suscribirBorradorListo(oyente: () => void): () => void {
  alListo.add(oyente)
  return () => {
    alListo.delete(oyente)
  }
}

function publicar(siguiente: EstadoCarga): void {
  estado = siguiente
  for (const oyente of [...oyentes]) oyente(estado)
}

function avisarListo(): void {
  for (const oyente of [...alListo]) oyente()
}

export function soltarCarga(): void {
  if (estado.fase === "leyendo" || estado.fase === "ociosa") return
  publicar({ fase: "ociosa" })
}

export function consumirListo(): { documento: DocumentoBorrador; archivo: File } | null {
  if (estado.fase !== "lista") return null
  const listo = { documento: estado.documento, archivo: estado.archivo }
  estado = { fase: "ociosa" }
  return listo
}

function mensajeDe(falla: unknown): string {
  return falla instanceof ErrorApi ? falla.message : "No se pudo cargar el comprobante."
}

async function aplicarCarga(estadoCarga: CargaEstado, archivo: File, marca: number): Promise<boolean> {
  if (marca !== generacion) return true
  if (estadoCarga.fase === "recibida" || estadoCarga.fase === "extrayendo") {
    publicar({ fase: "extrayendo", archivo, jobId: estadoCarga.job_id })
    return false
  }
  if (estadoCarga.fase === "lista" && estadoCarga.documento_id) {
    if (oyentes.size === 0) {
      publicar({ fase: "ociosa" })
      return true
    }
    try {
      const documento = await cliente.verDocumento(estadoCarga.documento_id)
      if (marca !== generacion) return true
      if (documento.estado !== "borrador") throw new ErrorApi("La API no devolvió el borrador.", 0)
      marcarLeidasDeRecurso("job", estadoCarga.job_id)
      guardarVista(documento.id, archivo)
      publicar({ fase: "lista", archivo, documento })
    } catch (falla: unknown) {
      if (marca !== generacion) return true
      publicar({ fase: "falla", archivo, mensaje: mensajeDe(falla) })
    }
    avisarListo()
    return true
  }
  if (estadoCarga.fase === "falla") {
    const mensaje = estadoCarga.mensaje || "No se pudo cargar el comprobante."
    publicar({ fase: "falla", archivo, mensaje })
    if (oyentes.size > 0) marcarLeidasDeRecurso("job", estadoCarga.job_id)
    return true
  }
  return false
}

async function seguirCarga(jobId: string, archivo: File, marca: number): Promise<void> {
  const cola: CargaEstado[] = []
  let despertar: (() => void) | null = null
  const soltar = suscribirEventos((evento) => {
    const estadoCarga = cargaDeEvento(evento)
    if (!estadoCarga || estadoCarga.job_id !== jobId) return
    cola.push(estadoCarga)
    const fn = despertar
    despertar = null
    fn?.()
  })
  try {
    const inicial = await cliente.verCarga(jobId)
    if (await aplicarCarga(inicial, archivo, marca)) return
    for (;;) {
      if (marca !== generacion) return
      const desdeCola = cola.shift()
      if (desdeCola) {
        if (await aplicarCarga(desdeCola, archivo, marca)) return
        continue
      }
      if (!canalConectado()) {
        const estadoCarga = await cliente.verCarga(jobId)
        if (await aplicarCarga(estadoCarga, archivo, marca)) return
        await esperar(1000)
        continue
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1000)
        despertar = () => {
          clearTimeout(timer)
          resolve()
        }
      })
    }
  } catch (falla: unknown) {
    if (marca !== generacion) return
    const mensaje = mensajeDe(falla)
    publicar({ fase: "falla", archivo, mensaje })
    if (oyentes.size === 0) {
      toaster.create({
        title: "No se pudo cargar",
        description: mensaje,
        type: "error",
        closable: true,
      })
    }
  } finally {
    soltar()
  }
}

export function iniciarCarga(archivo: File): void {
  if (estado.fase === "leyendo" || estado.fase === "extrayendo") return
  if (archivo.size > TAMANO_MAXIMO_BYTES) {
    publicar({ fase: "falla", archivo, mensaje: MENSAJE_TAMANO })
    return
  }

  const marca = ++generacion
  publicar({ fase: "leyendo", archivo })
  void cliente.subir(archivo).then(
    (aceptada) => {
      if (marca !== generacion) return
      publicar({ fase: "extrayendo", archivo, jobId: aceptada.job_id })
      void seguirCarga(aceptada.job_id, archivo, marca)
    },
    (falla: unknown) => {
      if (marca !== generacion) return
      const mensaje = mensajeDe(falla)
      publicar({ fase: "falla", archivo, mensaje })
      if (oyentes.size === 0) {
        toaster.create({
          title: "No se pudo cargar",
          description: mensaje,
          type: "error",
          closable: true,
        })
      }
    },
  )
}
