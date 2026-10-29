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
  navigateRef.current = navigate

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
      tomarLista(lista.items, lista.no_leidas, gen)
      return lista
    })
  }, [tomarLista])

  const marcarLeida = useCallback(async (id: string) => {
    const actual = itemsRef.current.find((item) => item.id === id)
    if (!actual || actual.leida) return
    const siguientes = itemsRef.current.map((item) => (item.id === id ? { ...item, leida: true } : item))
    tomarLista(siguientes, Math.max(0, sinLeerRef.current - 1), ++listaGen.current)
    try {
      await cliente.marcarNotificacionLeida(id)
    } catch {
      await pedirLista().catch(() => undefined)
    }
  }, [pedirLista, tomarLista])

  const marcarTodas = useCallback(async () => {
    if (!itemsRef.current.some((item) => !item.leida)) return
    tomarLista(
      itemsRef.current.map((item) => ({ ...item, leida: true })),
      0,
      ++listaGen.current,
    )
    try {
      await cliente.marcarNotificacionesLeidas()
    } catch {
      await pedirLista().catch(() => undefined)
    }
  }, [pedirLista, tomarLista])

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
      if (!aviso) return
      if (itemsRef.current.some((item) => item.id === aviso.id)) return
      const siguientes = [aviso, ...itemsRef.current].slice(0, 40)
      tomarLista(siguientes, sinLeerRef.current + 1, ++listaGen.current)
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
      try {
        socket = new WebSocket(urlSocket("/sesion/ws"))
      } catch {
        timer = window.setTimeout(conectar, espera)
        espera = Math.min(espera * 2, 15000)
        return
      }
      socket.addEventListener("open", () => {
        abierto = true
        try {
          socket?.send(JSON.stringify({ token }))
        } catch {
          socket?.close()
        }
      })
      socket.addEventListener("message", (evento) => {
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
      socket.addEventListener("close", (evento) => {
        publicarConexion(false)
        setConectado(false)
        if (cancelado) return
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
      if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
        socket.close()
      }
    }
  }, [marcarLeida, pedirLista, token])

  const valor = useMemo<Canal>(
    () => ({ notificaciones, noLeidas, conectado, marcarLeida, marcarTodas }),
    [conectado, marcarLeida, marcarTodas, noLeidas, notificaciones],
  )

  return <ContextoCanal.Provider value={valor}>{children}</ContextoCanal.Provider>
}

export function useCanal(): Canal {
  const canal = useContext(ContextoCanal)
  if (!canal) throw new Error("useCanal fuera del proveedor")
  return canal
}
