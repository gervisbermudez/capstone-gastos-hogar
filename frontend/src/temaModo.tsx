import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"

const CLAVE = "gastos.tema"

type Modo = "claro" | "oscuro"

type Tema = {
  modo: Modo
  oscuro: boolean
  alternar: () => void
}

const ContextoTema = createContext<Tema | null>(null)

function modoInicial(): Modo {
  if (document.documentElement.classList.contains("dark")) return "oscuro"
  try {
    return localStorage.getItem(CLAVE) === "oscuro" ? "oscuro" : "claro"
  } catch {
    return "claro"
  }
}

function aplicarModo(modo: Modo) {
  const oscuro = modo === "oscuro"
  document.documentElement.classList.toggle("dark", oscuro)
  document.documentElement.style.colorScheme = oscuro ? "dark" : "light"
  try {
    localStorage.setItem(CLAVE, modo)
  } catch {
    return
  }
}

export function ProveedorTema({ children }: { children: ReactNode }) {
  const [modo, setModo] = useState<Modo>(modoInicial)
  const modoRef = useRef(modo)

  useEffect(() => {
    const oscuro = modoRef.current === "oscuro"
    document.documentElement.classList.toggle("dark", oscuro)
    document.documentElement.style.colorScheme = oscuro ? "dark" : "light"
  }, [])

  const alternar = useCallback(() => {
    const siguiente: Modo = modoRef.current === "oscuro" ? "claro" : "oscuro"
    modoRef.current = siguiente
    aplicarModo(siguiente)
    setModo(siguiente)
  }, [])

  const valor = useMemo(
    () => ({ modo, oscuro: modo === "oscuro", alternar }),
    [modo, alternar],
  )

  return <ContextoTema.Provider value={valor}>{children}</ContextoTema.Provider>
}

export function useTema(): Tema {
  const valor = useContext(ContextoTema)
  if (!valor) throw new Error("El tema no está disponible.")
  return valor
}
