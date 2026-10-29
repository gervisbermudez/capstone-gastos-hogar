import { useEffect, useRef, useState } from "react"
import { guardarResumen, generacionResumenes, leerResumenGuardado } from "../api/cacheResumen"
import { ErrorApi, cliente, esAbort } from "../api/cliente"
import { etiquetaCategoria, type DocumentoConfirmado, type DocumentoListado, type Resumen } from "../api/tipos"
import { toaster } from "../avisos"
import { suscribirEventos } from "../canalBus"
import { suscribirBorradorListo } from "../cargaActiva"
import { formatPeriodo } from "../formato"
import { sumarMontos } from "../componentes/tablero/ResumenCifras"
import {
  FILTROS_INICIALES,
  filtrarRegistros,
  monedasDe,
  rangoInvalido,
  type FiltrosRegistros,
} from "./filtrarRegistros"

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

// /resumen exige YYYY-MM. Una punta vacía deja ese lado abierto.
const DESDE_ABIERTO = "1970-01"
const HASTA_ABIERTO = "2099-12"

export type PeriodoTablero = {
  desde: string
  hasta: string
  etiqueta: string
}

export type DatosTablero = {
  periodo: PeriodoTablero
  resumen: Resumen | null
  filtros: FiltrosRegistros
  setFiltro: <K extends keyof FiltrosRegistros>(clave: K, valor: FiltrosRegistros[K]) => void
  limpiar: () => void
  rangoInvalido: string | null
  filtrosDistintos: number
  monedas: string[]
  monedasPendientes: boolean
  cargandoResumen: boolean
  errorResumen: string | null
  borradores: DocumentoListado[] | null
  cargandoDocs: boolean
  errorDocs: string | null
  reintentar: () => void
  descartarBorrador: (id: string) => void
  descartando: string | null
  mostrarPasos: boolean
  sinCoincidencias: boolean
  vistaFiltrada: boolean
}

function mensajeError(error: unknown, fallback: string): string {
  return error instanceof ErrorApi ? error.message : fallback
}

function isoFecha(fecha: Date): string {
  const mes = String(fecha.getMonth() + 1).padStart(2, "0")
  const dia = String(fecha.getDate()).padStart(2, "0")
  return `${fecha.getFullYear()}-${mes}-${dia}`
}

function filtrosAnio(ahora = new Date()): FiltrosRegistros {
  return {
    ...FILTROS_INICIALES,
    desde: `${ahora.getFullYear()}-01-01`,
    hasta: isoFecha(ahora),
  }
}

function mesConsulta(fecha: string, abierto: string): string {
  return fecha === "" ? abierto : fecha.slice(0, 7)
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

function etiquetaRango(filtros: FiltrosRegistros): string {
  if (filtros.desde === "" && filtros.hasta === "") return "Todos los períodos"
  if (filtros.desde !== "" && filtros.hasta !== "") {
    return etiquetaPeriodo(filtros.desde.slice(0, 7), filtros.hasta.slice(0, 7))
  }
  if (filtros.desde !== "") return `Desde ${formatPeriodo(filtros.desde.slice(0, 7))}`
  return `Hasta ${formatPeriodo(filtros.hasta.slice(0, 7))}`
}

function etiquetaVista(filtros: FiltrosRegistros): string {
  const partes = [etiquetaRango(filtros)]
  if (filtros.categoria === "sin") partes.push("Sin categoría")
  else if (filtros.categoria !== FILTROS_INICIALES.categoria) partes.push(etiquetaCategoria(filtros.categoria))
  if (filtros.estado === "borrador") partes.push("Borradores")
  if (filtros.estado === "confirmado") partes.push("Confirmados")
  const moneda = filtros.moneda.trim().toUpperCase()
  if (moneda !== "") partes.push(moneda)
  const texto = filtros.texto.trim()
  if (texto !== "") partes.push(texto)
  return partes.join(" · ")
}

function filtrosDistintos(filtros: FiltrosRegistros, base: FiltrosRegistros): number {
  let cantidad = 0
  if (filtros.desde !== base.desde) cantidad += 1
  if (filtros.hasta !== base.hasta) cantidad += 1
  if (filtros.incluirSinPeriodo !== base.incluirSinPeriodo) cantidad += 1
  if (filtros.categoria !== base.categoria) cantidad += 1
  if (filtros.estado !== base.estado) cantidad += 1
  if (filtros.moneda.trim() !== base.moneda.trim()) cantidad += 1
  if (filtros.texto.trim() !== base.texto.trim()) cantidad += 1
  return cantidad
}

function recortaDatos(filtros: FiltrosRegistros): boolean {
  return (
    filtros.categoria !== FILTROS_INICIALES.categoria ||
    filtros.estado !== FILTROS_INICIALES.estado ||
    filtros.moneda.trim() !== FILTROS_INICIALES.moneda ||
    filtros.texto.trim() !== FILTROS_INICIALES.texto
  )
}

function resumirComprobantes(items: readonly DocumentoConfirmado[]): Pick<Resumen, "por_mes" | "por_categoria"> {
  const meses = new Map<string, string[]>()
  const categorias = new Map<string, string[]>()
  for (const item of items) {
    const monto = item.campos.monto
    if (monto === undefined || monto === "") continue
    const periodo = item.campos.periodo
    if (periodo !== undefined && periodo !== "") {
      const lista = meses.get(periodo) ?? []
      lista.push(monto)
      meses.set(periodo, lista)
    }
    const categoria = item.campos.categoria
    if (categoria !== undefined && categoria !== "") {
      const lista = categorias.get(categoria) ?? []
      lista.push(monto)
      categorias.set(categoria, lista)
    }
  }
  const por_mes = [...meses.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .flatMap(([periodo, montos]) => {
      const total = sumarMontos(montos)
      return total === null ? [] : [{ periodo, total }]
    })
  const por_categoria = [...categorias.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "es"))
    .flatMap(([categoria, montos]) => {
      const total = sumarMontos(montos)
      return total === null ? [] : [{ categoria, total }]
    })
  return { por_mes, por_categoria }
}

function vistaResumen(base: Resumen, filtros: FiltrosRegistros): Resumen {
  const comprobantes = filtrarRegistros(base.comprobantes, filtros)
  if (!recortaDatos(filtros)) return { ...base, comprobantes }
  return { ...resumirComprobantes(comprobantes), comprobantes }
}

export function useTablero(): DatosTablero {
  const [iniciales] = useState(() => filtrosAnio())
  const [filtros, setFiltros] = useState(iniciales)
  const aplicadosRef = useRef(iniciales)
  const avisoRango = rangoInvalido(filtros)
  if (avisoRango === null) aplicadosRef.current = filtros
  const aplicados = aplicadosRef.current
  const desde = mesConsulta(aplicados.desde, DESDE_ABIERTO)
  const hasta = mesConsulta(aplicados.hasta, HASTA_ABIERTO)

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
  const resumenVisible = resumenVista === null ? null : vistaResumen(resumenVista, aplicados)
  const borradoresVisibles = borradores === null ? null : filtrarRegistros(borradores, aplicados)
  const vistaFiltrada = filtrosDistintos(aplicados, iniciales) > 0

  function setFiltro<K extends keyof FiltrosRegistros>(clave: K, valor: FiltrosRegistros[K]) {
    setFiltros((actual) => ({ ...actual, [clave]: valor }))
  }

  function limpiar() {
    setFiltros(iniciales)
  }

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

  useEffect(() => {
    const soltarListo = suscribirBorradorListo(() => setIntento((valor) => valor + 1))
    const soltarAviso = suscribirEventos((evento) => {
      if (evento.tipo !== "comprobante.agregado") return
      setIntento((valor) => valor + 1)
    })
    return () => {
      soltarListo()
      soltarAviso()
    }
  }, [])

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

  const vacio =
    resumenVisible !== null &&
    resumenVisible.comprobantes.length === 0 &&
    !cargandoDocs &&
    errorDocs === null &&
    borradoresVisibles !== null &&
    borradoresVisibles.length === 0

  return {
    periodo: { desde, hasta, etiqueta: etiquetaVista(aplicados) },
    resumen: resumenVisible,
    filtros,
    setFiltro,
    limpiar,
    rangoInvalido: avisoRango,
    filtrosDistintos: filtrosDistintos(filtros, iniciales),
    monedas: monedasDe([...(resumenVista?.comprobantes ?? []), ...(borradores ?? [])]),
    monedasPendientes: cargandoResumen && cargandoDocs,
    cargandoResumen,
    errorResumen: errorVista,
    borradores: borradoresVisibles,
    cargandoDocs,
    errorDocs,
    reintentar,
    descartarBorrador,
    descartando,
    mostrarPasos: vacio && !vistaFiltrada,
    sinCoincidencias: vacio && vistaFiltrada,
    vistaFiltrada,
  }
}
