import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useLocation, useNavigate } from "react-router"
import {
  guardarHogar,
  leerContextoChat,
  leerHilo,
  leerHogar,
  leerToken,
  olvidarContextoChat,
  olvidarHilo,
  olvidarHogar,
  olvidarTranscripto,
} from "./almacen"
import { olvidarResumenes } from "./api/cacheResumen"
import { cliente, esAbort } from "./api/cliente"
import type { Hogar, RolHogar } from "./api/tipos"
import { suscribirEventos } from "./canalBus"
import { useSesion } from "./sesion"

type EstadoHogar = {
  hogares: Hogar[]
  hogarActivo: Hogar | null
  rol: RolHogar | null
  listo: boolean
  elegir: (id: string) => void
  recargar: () => Promise<void>
}

const ContextoHogar = createContext<EstadoHogar | null>(null)

function soltarChat(): void {
  const hilo = leerHilo()
  const contexto = leerContextoChat()
  if (hilo) olvidarTranscripto(hilo)
  if (contexto?.threadId && contexto.threadId !== hilo) olvidarTranscripto(contexto.threadId)
  olvidarHilo()
  olvidarContextoChat()
}

function idElegido(hogares: readonly Hogar[], guardado: string | null): string | null {
  if (guardado && hogares.some((hogar) => hogar.id === guardado)) return guardado
  return hogares.find((hogar) => hogar.rol === "administrador")?.id ?? hogares[0]?.id ?? null
}

function fijarActivo(hogares: readonly Hogar[]): { id: string | null; soltoChat: boolean } {
  const guardado = leerHogar()
  const id = idElegido(hogares, guardado)
  const soltoChat = guardado !== null && guardado !== id
  if (soltoChat) {
    soltarChat()
    olvidarResumenes()
  }
  if (id === null) olvidarHogar()
  else if (guardado !== id) guardarHogar(id)
  return { id, soltoChat }
}

export function ProveedorHogar({ children }: { children: ReactNode }) {
  const { token } = useSesion()
  const navigate = useNavigate()
  const location = useLocation()
  const locationRef = useRef(location)
  locationRef.current = location
  const limpiarRutaChat = useCallback(() => {
    const aqui = locationRef.current
    if (aqui.pathname !== "/chat" || !aqui.search) return
    navigate("/chat", { replace: true })
  }, [navigate])
  const limpiarRutaChatRef = useRef(limpiarRutaChat)
  limpiarRutaChatRef.current = limpiarRutaChat

  const [hogares, setHogares] = useState<Hogar[]>([])
  const [hogarId, setHogarId] = useState<string | null>(() => leerHogar())
  const [listo, setListo] = useState(() => leerToken() === null)
  const [tokenVisto, setTokenVisto] = useState(token)

  if (token !== tokenVisto) {
    setTokenVisto(token)
    setListo(token === null)
    if (token === null) {
      setHogares([])
      setHogarId(null)
    }
  }

  const elegir = useCallback((id: string) => {
    if (!id || leerHogar() === id) {
      if (id) setHogarId(id)
      return
    }
    soltarChat()
    olvidarResumenes()
    guardarHogar(id)
    setHogarId(id)
    limpiarRutaChatRef.current()
  }, [])

  const recargar = useCallback(async () => {
    const lista = await cliente.listarHogares()
    const aplicado = fijarActivo(lista.items)
    setHogares(lista.items)
    setHogarId(aplicado.id)
    if (aplicado.soltoChat) limpiarRutaChatRef.current()
  }, [])

  useEffect(() => {
    if (!token) return
    return suscribirEventos((evento) => {
      if (evento.tipo !== "hogar.membresia") return
      void recargar().catch(() => undefined)
    })
  }, [token, recargar])

  useEffect(() => {
    if (!token) return
    const ctrl = new AbortController()
    let cancelado = false
    setListo(false)
    cliente
      .listarHogares(ctrl.signal)
      .then((lista) => {
        if (cancelado) return
        const aplicado = fijarActivo(lista.items)
        setHogares(lista.items)
        setHogarId(aplicado.id)
        if (aplicado.soltoChat) limpiarRutaChatRef.current()
      })
      .catch((error: unknown) => {
        if (cancelado || esAbort(error)) return
        setHogares([])
        setHogarId(leerHogar())
      })
      .finally(() => {
        if (!cancelado) setListo(true)
      })
    return () => {
      cancelado = true
      ctrl.abort()
    }
  }, [token])

  const hogarActivo = useMemo(
    () => hogares.find((hogar) => hogar.id === hogarId) ?? null,
    [hogares, hogarId],
  )

  const valor = useMemo(
    () => ({
      hogares,
      hogarActivo,
      rol: hogarActivo?.rol ?? null,
      listo,
      elegir,
      recargar,
    }),
    [hogares, hogarActivo, listo, elegir, recargar],
  )

  return <ContextoHogar.Provider value={valor}>{children}</ContextoHogar.Provider>
}

export function useHogar(): EstadoHogar {
  const valor = useContext(ContextoHogar)
  if (!valor) throw new Error("El hogar no está disponible.")
  return valor
}
