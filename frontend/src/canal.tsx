import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useNavigate } from "react-router"
import { toaster } from "./avisos"
import { cargaEnPantalla } from "./cargaActiva"
import {
  jobEnPantalla,
  leerEvento,
  notificacionDe,
  panelEstaAbierto,
  publicarConexion,
  publicarEvento,
  registrarMarcaRecurso,
  type EventoCanal,
} from "./canalBus"
import { cerrarPorSesion, cliente, urlSocket } from "./api/cliente"
import type { Notificacion } from "./api/tipos"
import { useSesion } from "./sesion"

type Canal = {
  notificaciones: Notificacion[]
  noLeidas: number
  conectado: boolean
  marcarLeida: (id: string) => Promise<void>
  marcarTodas: () => Promise<void>
  limpiarLeidas: () => Promise<void>
}

const ContextoCanal = createContext<Canal | null>(null)

function tonoToast(notificacion: Notificacion): "success" | "warning" | "error" | "info" {
  const etiqueta = notificacion.accion?.etiqueta
  if (etiqueta === "Reintentar" || etiqueta === "Volver a cargar") return "error"
  if (etiqueta === "Revisar") return "warning"
  if (etiqueta === "Ver respuesta" || notificacion.tipo === "carga.estado") return "success"
  return "info"
}

function silenciar(evento: EventoCanal): boolean {
  if (panelEstaAbierto()) return true
  if (evento.tipo === "chat.estado" && jobEnPantalla(evento.recurso?.id)) return true
  if (evento.tipo === "carga.estado" && cargaEnPantalla()) return true
  return false
}

function fusionarLista(
  locales: Notificacion[],
  servidor: Notificacion[],
  noLeidasServidor: number,
  confirmadas: ReadonlySet<string>,
  ocultas: ReadonlySet<string>,
) {
  const visibles = servidor.filter((item) => !ocultas.has(item.id))
  const idsServidor = new Set(visibles.map((item) => item.id))
  const localPorId = new Map(locales.map((item) => [item.id, item]))
  const soloLocales = locales.filter((item) => {
    if (ocultas.has(item.id) || idsServidor.has(item.id)) return false
    if (item.leida && confirmadas.has(item.id)) return false
    return true
  })
  const base = visibles.map((item) => {
    const local = localPorId.get(item.id)
    if (local?.leida && !item.leida) return { ...item, leida: true }
    return item
  })
  const sinLeer = noLeidasServidor + soloLocales.filter((item) => !item.leida).length
  return { items: [...soloLocales, ...base].slice(0, 40), sinLeer }
}

export function ProveedorCanal({ children }: { children: ReactNode }) {
  const { token } = useSesion()
  const navigate = useNavigate()
  const [notificaciones, setNotificaciones] = useState<Notificacion[]>([])
  const [noLeidas, setNoLeidas] = useState(0)
  const [conectado, setConectado] = useState(false)
  const itemsRef = useRef<Notificacion[]>([])
  const sinLeerRef = useRef(0)
  const listaGen = useRef(0)
  const navigateRef = useRef(navigate)
  const tokenRef = useRef(token)
  const sesionRef = useRef<string | null>(token)
  const ocultasRef = useRef(new Set<string>())
  const confirmadasRef = useRef(new Set<string>())
  navigateRef.current = navigate
  tokenRef.current = token

  const aplicarLista = useCallback((items: Notificacion[], sinLeer: number) => {
    itemsRef.current = items
    sinLeerRef.current = sinLeer
    setNotificaciones(items)
    setNoLeidas(sinLeer)
  }, [])

  const tomarLista = useCallback((items: Notificacion[], sinLeer: number, gen: number) => {
    if (gen !== listaGen.current) return
    aplicarLista(items, sinLeer)
  }, [aplicarLista])

  const pedirLista = useCallback((signal?: AbortSignal) => {
    const gen = ++listaGen.current
    return cliente.listarNotificaciones(signal).then((lista) => {
      if (signal?.aborted) return null
      if (gen !== listaGen.current) return lista
      for (const item of lista.items) confirmadasRef.current.add(item.id)
      const fusion = fusionarLista(
        itemsRef.current,
        lista.items,
        lista.no_leidas,
        confirmadasRef.current,
        ocultasRef.current,
      )
      tomarLista(fusion.items, fusion.sinLeer, gen)
      return lista
    })
  }, [tomarLista])

  const marcarLeida = useCallback(async (id: string) => {
    const actual = itemsRef.current.find((item) => item.id === id)
    if (!actual || actual.leida) return
    const sinLeerPrevio = sinLeerRef.current
    const idsPrevios = new Set(itemsRef.current.map((item) => item.id))
    const siguientes = itemsRef.current.map((item) => (item.id === id ? { ...item, leida: true } : item))
    tomarLista(siguientes, Math.max(0, sinLeerPrevio - 1), ++listaGen.current)
    try {
      await cliente.marcarNotificacionLeida(id)
    } catch {
      if (!tokenRef.current) return
      const restauradas = itemsRef.current.map((item) => (item.id === id ? { ...item, leida: false } : item))
      const llegadas = restauradas.filter((item) => !idsPrevios.has(item.id) && !item.leida).length
      aplicarLista(restauradas, sinLeerPrevio + llegadas)
      await pedirLista().catch(() => undefined)
    }
  }, [aplicarLista, pedirLista, tomarLista])

  const marcarTodas = useCallback(async () => {
    const previas = itemsRef.current
    if (!previas.some((item) => !item.leida)) return
    const sinLeerPrevio = sinLeerRef.current
    const leidaPrevia = new Map(previas.map((item) => [item.id, item.leida]))
    tomarLista(
      previas.map((item) => ({ ...item, leida: true })),
      0,
      ++listaGen.current,
    )
    try {
      await cliente.marcarNotificacionesLeidas()
    } catch {
      if (!tokenRef.current) return
      const restauradas = itemsRef.current.map((item) =>
        leidaPrevia.get(item.id) === false ? { ...item, leida: false } : item,
      )
      const llegadas = restauradas.filter((item) => !leidaPrevia.has(item.id) && !item.leida).length
      aplicarLista(restauradas, sinLeerPrevio + llegadas)
      await pedirLista().catch(() => undefined)
    }
  }, [aplicarLista, pedirLista, tomarLista])

  const limpiarLeidas = useCallback(async () => {
    const previas = itemsRef.current
    const leidas = previas.filter((item) => item.leida)
    if (leidas.length === 0) return
    const sinLeerPrevio = sinLeerRef.current
    const idsQuitadas = leidas.map((item) => item.id)
    for (const id of idsQuitadas) ocultasRef.current.add(id)
    tomarLista(
      previas.filter((item) => !item.leida),
      sinLeerPrevio,
      ++listaGen.current,
    )
    try {
      await Promise.all(idsQuitadas.map((id) => cliente.marcarNotificacionLeida(id)))
      await cliente.limpiarNotificacionesLeidas()
    } catch {
      if (!tokenRef.current) return
      for (const id of idsQuitadas) ocultasRef.current.delete(id)
      const actuales = itemsRef.current
      const porId = new Map(actuales.map((item) => [item.id, item]))
      const llegadas = actuales.filter((item) => !previas.some((itemPrevio) => itemPrevio.id === item.id))
      const restauradas = [
        ...llegadas,
        ...previas.map((item) => porId.get(item.id) ?? item),
      ].slice(0, 40)
      const llegadasSinLeer = llegadas.filter((item) => !item.leida).length
      aplicarLista(restauradas, sinLeerPrevio + llegadasSinLeer)
      await pedirLista().catch(() => undefined)
    }
  }, [aplicarLista, pedirLista, tomarLista])

  useEffect(() => {
    registrarMarcaRecurso((clase, id) => {
      const coinciden = itemsRef.current.filter(
        (item) => !item.leida && item.recurso?.clase === clase && item.recurso.id === id,
      )
      if (coinciden.length === 0) {
        void pedirLista()
          .then((lista) => {
            if (!lista) return
            for (const item of lista.items) {
              if (!item.leida && item.recurso?.clase === clase && item.recurso.id === id) {
                void marcarLeida(item.id)
              }
            }
          })
          .catch(() => undefined)
        return
      }
      for (const item of coinciden) void marcarLeida(item.id)
    })
    return () => registrarMarcaRecurso(() => {})
  }, [marcarLeida, pedirLista])

  useEffect(() => {
    if (sesionRef.current !== token) {
      sesionRef.current = token
      ocultasRef.current.clear()
      confirmadasRef.current.clear()
    }
    if (!token) {
      tomarLista([], 0, ++listaGen.current)
      publicarConexion(false)
      setConectado(false)
      return
    }
    const ctrl = new AbortController()
    void pedirLista(ctrl.signal).catch(() => undefined)
    return () => ctrl.abort()
  }, [pedirLista, token, tomarLista])

  useEffect(() => {
    if (!token) return
    let cancelado = false
    let espera = 1000
    let socket: WebSocket | null = null
    let timer = 0

    const incorporar = (evento: EventoCanal) => {
      const aviso = notificacionDe(evento)
      if (!aviso || ocultasRef.current.has(aviso.id)) return
      if (itemsRef.current.some((item) => item.id === aviso.id)) return
      const siguientes = [aviso, ...itemsRef.current].slice(0, 40)
      aplicarLista(siguientes, sinLeerRef.current + 1)
      if (silenciar(evento)) return
      const accion = aviso.accion
      toaster.create({
        title: aviso.titulo,
        description: aviso.cuerpo,
        type: tonoToast(aviso),
        closable: true,
        action: accion
          ? {
              label: accion.etiqueta,
              onClick: () => {
                void marcarLeida(aviso.id)
                navigateRef.current(accion.ruta)
              },
            }
          : undefined,
      })
    }

    const conectar = () => {
      if (cancelado) return
      let abierto = false
      let instancia: WebSocket
      try {
        instancia = new WebSocket(urlSocket("/sesion/ws"))
      } catch {
        timer = window.setTimeout(conectar, espera)
        espera = Math.min(espera * 2, 15000)
        return
      }
      socket = instancia
      instancia.addEventListener("open", () => {
        if (cancelado || socket !== instancia) {
          if (instancia.readyState === WebSocket.OPEN) instancia.close()
          return
        }
        abierto = true
        try {
          instancia.send(JSON.stringify({ token }))
        } catch {
          instancia.close()
        }
      })
      instancia.addEventListener("message", (evento) => {
        if (cancelado || socket !== instancia) return
        if (typeof evento.data !== "string") return
        let json: unknown
        try {
          json = JSON.parse(evento.data) as unknown
        } catch {
          return
        }
        const leido = leerEvento(json)
        if (leido === "ping" || leido === null) return
        if (leido === "listo") {
          publicarConexion(true)
          setConectado(true)
          espera = 1000
          void pedirLista().catch(() => undefined)
          return
        }
        incorporar(leido)
        publicarEvento(leido)
      })
      instancia.addEventListener("close", (evento) => {
        if (cancelado || socket !== instancia) return
        publicarConexion(false)
        setConectado(false)
        if (evento.code === 4401 && abierto) {
          cerrarPorSesion()
          return
        }
        timer = window.setTimeout(conectar, espera)
        espera = Math.min(espera * 2, 15000)
      })
    }

    conectar()
    return () => {
      cancelado = true
      window.clearTimeout(timer)
      publicarConexion(false)
      setConectado(false)
      // close() en CONNECTING hace que Chrome anote el fallo del handshake.
      // Si todavía negocia, el open de arriba lo cierra al pasar a OPEN.
      if (socket && socket.readyState === WebSocket.OPEN) socket.close()
    }
  }, [aplicarLista, marcarLeida, pedirLista, token])

  const valor = useMemo<Canal>(
    () => ({ notificaciones, noLeidas, conectado, marcarLeida, marcarTodas, limpiarLeidas }),
    [conectado, limpiarLeidas, marcarLeida, marcarTodas, noLeidas, notificaciones],
  )

  return <ContextoCanal.Provider value={valor}>{children}</ContextoCanal.Provider>
}

export function useCanal(): Canal {
  const canal = useContext(ContextoCanal)
  if (!canal) throw new Error("useCanal fuera del proveedor")
  return canal
}
