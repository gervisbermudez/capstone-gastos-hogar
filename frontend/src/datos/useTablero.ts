import { useEffect, useRef, useState } from "react"
import { guardarResumen, generacionResumenes, leerResumenGuardado } from "../api/cacheResumen"
import { ErrorApi, cliente, esAbort } from "../api/cliente"
import type { DocumentoListado, Resumen } from "../api/tipos"
import { toaster } from "../avisos"
import { suscribirBorradorListo } from "../cargaActiva"
import { periodoDe } from "../formulario"

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

export type PeriodoTablero = {
  desde: string
  hasta: string
  etiqueta: string
}

export type DatosTablero = {
  periodo: PeriodoTablero
  resumen: Resumen | null
  cargandoResumen: boolean
  errorResumen: string | null
  borradores: DocumentoListado[] | null
  cargandoDocs: boolean
  errorDocs: string | null
  reintentar: () => void
  descartarBorrador: (id: string) => void
  descartando: string | null
  mostrarPasos: boolean
}

function mensajeError(error: unknown, fallback: string): string {
  return error instanceof ErrorApi ? error.message : fallback
}

function etiquetaPeriodo(desde: string, hasta: string): string {
  const anioDesde = desde.slice(0, 4)
  const anioHasta = hasta.slice(0, 4)
  const mesDesde = MESES[Number(desde.slice(5, 7)) - 1]
  const mesHasta = MESES[Number(hasta.slice(5, 7)) - 1]
  if (desde === hasta) return `${mesDesde} ${anioDesde}`
  if (anioDesde === anioHasta) return `${mesDesde}\u2013${mesHasta} ${anioHasta}`
  return `${mesDesde} ${anioDesde}\u2013${mesHasta} ${anioHasta}`
}

export function useTablero(): DatosTablero {
  const ahora = new Date()
  const desde = `${ahora.getFullYear()}-01`
  const hasta = periodoDe(ahora)
  const [intento, setIntento] = useState(0)
  const [resumen, setResumen] = useState<Resumen | null>(() => leerResumenGuardado(desde, hasta))
  const [borradores, setBorradores] = useState<DocumentoListado[] | null>(null)
  const [errorResumen, setErrorResumen] = useState<string | null>(null)
  const [errorClave, setErrorClave] = useState<string | null>(null)
  const [errorDocs, setErrorDocs] = useState<string | null>(null)
  const [cargandoDocs, setCargandoDocs] = useState(true)
  const [descartando, setDescartando] = useState<string | null>(null)
  const descartandoRef = useRef<string | null>(null)
  const listaVisible = useRef(false)

  const claveActual = `${desde}:${hasta}`
  const guardado = leerResumenGuardado(desde, hasta)
  const errorDeOtroRango = errorClave !== null && errorClave !== claveActual
  const errorVista = errorDeOtroRango ? null : errorResumen
  // El mapa manda en este render: otro rango o un olvido no dejan totales viejos.
  const resumenDifiere = errorVista === null && resumen !== guardado
  if (errorDeOtroRango) {
    setErrorClave(null)
    setErrorResumen(null)
  }
  if (resumenDifiere) {
    setResumen(guardado)
  }
  const resumenVista = errorVista ? null : resumenDifiere ? guardado : resumen
  const cargandoResumen = errorVista === null && resumenVista === null

  function reintentar() {
    setIntento((valor) => valor + 1)
  }

  async function descartarBorrador(id: string) {
    if (descartandoRef.current) return
    descartandoRef.current = id
    setDescartando(id)
    try {
      await cliente.descartar(id)
      reintentar()
    } catch (error) {
      toaster.create({
        title: mensajeError(error, "No se pudo descartar el borrador."),
        type: "error",
      })
    } finally {
      descartandoRef.current = null
      setDescartando(null)
    }
  }

  useEffect(() => {
    const ctrl = new AbortController()
    if (!listaVisible.current) setCargandoDocs(true)
    cliente
      .listarDocumentos(ctrl.signal)
      .then((lista) => {
        listaVisible.current = true
        setBorradores(lista.items.filter((item) => item.estado === "borrador"))
        setErrorDocs(null)
      })
      .catch((error: unknown) => {
        if (esAbort(error)) return
        listaVisible.current = false
        setBorradores(null)
        setErrorDocs(mensajeError(error, "No se pudieron cargar los borradores."))
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setCargandoDocs(false)
      })
    return () => ctrl.abort()
  }, [intento])

  useEffect(() => suscribirBorradorListo(() => setIntento((valor) => valor + 1)), [])

  useEffect(() => {
    const ctrl = new AbortController()
    let vigente = true
    const clave = `${desde}:${hasta}`
    const generacion = generacionResumenes()
    cliente
      .resumen(desde, hasta, ctrl.signal)
      .then((datos) => {
        if (!vigente || generacionResumenes() !== generacion) return
        guardarResumen(desde, hasta, datos)
        setResumen(datos)
        setErrorResumen(null)
        setErrorClave(null)
      })
      .catch((error: unknown) => {
        if (!vigente || esAbort(error) || generacionResumenes() !== generacion) return
        setResumen(null)
        setErrorResumen(mensajeError(error, "No se pudo cargar el resumen."))
        setErrorClave(clave)
      })
    return () => {
      vigente = false
      ctrl.abort()
    }
  }, [desde, hasta, intento])

  const resumenListo = resumenVista !== null
  const mostrarPasos =
    resumenListo &&
    resumenVista !== null &&
    !cargandoDocs &&
    !errorDocs &&
    borradores !== null &&
    borradores.length === 0 &&
    resumenVista.comprobantes.length === 0

  return {
    periodo: { desde, hasta, etiqueta: etiquetaPeriodo(desde, hasta) },
    resumen: resumenVista,
    cargandoResumen,
    errorResumen: errorVista,
    borradores,
    cargandoDocs,
    errorDocs,
    reintentar,
    descartarBorrador,
    descartando,
    mostrarPasos,
  }
}
