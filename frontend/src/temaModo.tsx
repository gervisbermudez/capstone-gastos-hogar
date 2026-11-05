import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"

const CLAVE = "gastos.tema"
const COLOR_BARRA = { claro: "#f7f4ea", oscuro: "#1c1c1a" } as const

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

function pintarDocumento(modo: Modo) {
  const oscuro = modo === "oscuro"
  document.documentElement.classList.toggle("dark", oscuro)
  document.documentElement.style.colorScheme = oscuro ? "dark" : "light"
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", oscuro ? COLOR_BARRA.oscuro : COLOR_BARRA.claro)
}

function aplicarModo(modo: Modo) {
  pintarDocumento(modo)
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
    pintarDocumento(modoRef.current)
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
