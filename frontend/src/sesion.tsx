import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { useNavigate } from "react-router"
import { guardarToken, leerToken, olvidarHilo, olvidarSesion } from "./almacen"
import { ErrorApi, cliente, esAbort, registrarNoAutorizado } from "./api/cliente"
import { olvidarVistas } from "./vistas"

type Sesion = {
  token: string | null
  email: string | null
  listo: boolean
  entrar: (accessToken: string) => void
  salir: () => void
}

const ContextoSesion = createContext<Sesion | null>(null)

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [token, setToken] = useState<string | null>(() => leerToken())
  const [email, setEmail] = useState<string | null>(null)
  const [listo, setListo] = useState(() => leerToken() === null)

  const salir = useCallback(() => {
    olvidarSesion()
    olvidarVistas()
    setToken(null)
    setEmail(null)
    setListo(true)
  }, [])

  const entrar = useCallback((accessToken: string) => {
    olvidarHilo()
    guardarToken(accessToken)
    setToken(accessToken)
    setListo(true)
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
      setListo(true)
      return
    }
    const ctrl = new AbortController()
    let cancelado = false
    cliente
      .yo(ctrl.signal)
      .then((usuario) => {
        if (!cancelado) setEmail(usuario.email)
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
    () => ({ token, email, listo, entrar, salir }),
    [token, email, listo, entrar, salir],
  )

  return <ContextoSesion.Provider value={valor}>{children}</ContextoSesion.Provider>
}

export function useSesion(): Sesion {
  const valor = useContext(ContextoSesion)
  if (!valor) throw new Error("La sesión no está disponible.")
  return valor
}
