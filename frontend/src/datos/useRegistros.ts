import { useEffect, useState } from "react"
import { ErrorApi, cliente, esAbort } from "../api/cliente"
import type { DocumentoListado } from "../api/tipos"
import {
  FILTROS_INICIALES,
  filtrarRegistros,
  monedasDe,
  rangoInvalido,
  type FiltrosRegistros,
} from "./filtrarRegistros"

export type DatosRegistros = {
  filtros: FiltrosRegistros
  setFiltro: <K extends keyof FiltrosRegistros>(clave: K, valor: FiltrosRegistros[K]) => void
  limpiar: () => void
  rangoInvalido: string | null
  items: DocumentoListado[] | null
  visibles: DocumentoListado[]
  monedas: string[]
  cargando: boolean
  error: string | null
  reintentar: () => void
}

export function useRegistros(): DatosRegistros {
  const [filtros, setFiltros] = useState<FiltrosRegistros>(() => ({ ...FILTROS_INICIALES }))
  const [intento, setIntento] = useState(0)
  const [items, setItems] = useState<DocumentoListado[] | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  function setFiltro<K extends keyof FiltrosRegistros>(clave: K, valor: FiltrosRegistros[K]) {
    setFiltros((actual) => ({ ...actual, [clave]: valor }))
  }

  function limpiar() {
    setFiltros({ ...FILTROS_INICIALES })
  }

  function reintentar() {
    setIntento((valor) => valor + 1)
  }

  useEffect(() => {
    const ctrl = new AbortController()
    setCargando(true)
    cliente
      .listarDocumentos(ctrl.signal)
      .then((lista) => {
        setItems(lista.items)
        setError(null)
      })
      .catch((error: unknown) => {
        if (esAbort(error)) return
        setItems(null)
        setError(error instanceof ErrorApi ? error.message : "No se pudieron cargar los registros.")
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setCargando(false)
      })
    return () => ctrl.abort()
  }, [intento])

  return {
    filtros,
    setFiltro,
    limpiar,
    rangoInvalido: rangoInvalido(filtros),
    items,
    visibles: items === null ? [] : filtrarRegistros(items, filtros),
    monedas: monedasDe(items ?? []),
    cargando,
    error,
    reintentar,
  }
}
