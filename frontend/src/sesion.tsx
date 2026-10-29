import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useNavigate } from "react-router"
import { guardarToken, leerToken, olvidarHilo, olvidarSesion } from "./almacen"
import { olvidarResumenes } from "./api/cacheResumen"
import { ErrorApi, cliente, esAbort, registrarNoAutorizado } from "./api/cliente"
import type { UsuarioActual } from "./api/tipos"
import { olvidarVistas } from "./vistas"

type Sesion = {
  token: string | null
  email: string | null
  nombre: string | null
  listo: boolean
  entrar: (accessToken: string) => void
  salir: () => void
  aplicarUsuario: (usuario: UsuarioActual) => void
  actualizarNombre: (nombre: string | null) => void
}

const ContextoSesion = createContext<Sesion | null>(null)

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [token, setToken] = useState<string | null>(() => leerToken())
  const [email, setEmail] = useState<string | null>(null)
  const [nombre, setNombre] = useState<string | null>(null)
  const [listo, setListo] = useState(() => leerToken() === null)
  const versionUsuario = useRef(0)

  const salir = useCallback(() => {
    olvidarSesion()
    olvidarResumenes()
    olvidarVistas()
    setToken(null)
    setEmail(null)
    setNombre(null)
    setListo(true)
  }, [])

  const entrar = useCallback((accessToken: string) => {
    olvidarHilo()
    olvidarResumenes()
    guardarToken(accessToken)
    setToken(accessToken)
    setListo(true)
  }, [])

  const aplicarUsuario = useCallback((usuario: UsuarioActual) => {
    versionUsuario.current += 1
    setEmail(usuario.email)
    setNombre(usuario.nombre)
  }, [])

  const actualizarNombre = useCallback((nombre: string | null) => {
    versionUsuario.current += 1
    setNombre(nombre)
  }, [])

  useEffect(() => {
    registrarNoAutorizado(() => {
      salir()
      navigate("/ingreso", { replace: true })
    })
  }, [navigate, salir])

  useEffect(() => {
    if (!token) {
      setEmail(null)
      setNombre(null)
      setListo(true)
      return
    }
    const ctrl = new AbortController()
    let cancelado = false
    const version = versionUsuario.current
    cliente
      .yo(ctrl.signal)
      .then((usuario) => {
        if (!cancelado && versionUsuario.current === version) {
          setEmail(usuario.email)
          setNombre(usuario.nombre)
        }
      })
      .catch((error: unknown) => {
        if (cancelado || esAbort(error) || error instanceof ErrorApi) return
      })
      .finally(() => {
        if (!cancelado) setListo(true)
      })
    return () => {
      cancelado = true
      ctrl.abort()
    }
  }, [token])

  const valor = useMemo(
    () => ({ token, email, nombre, listo, entrar, salir, aplicarUsuario, actualizarNombre }),
    [token, email, nombre, listo, entrar, salir, aplicarUsuario, actualizarNombre],
  )

  return <ContextoSesion.Provider value={valor}>{children}</ContextoSesion.Provider>
}

export function useSesion(): Sesion {
  const valor = useContext(ContextoSesion)
  if (!valor) throw new Error("La sesión no está disponible.")
  return valor
}
