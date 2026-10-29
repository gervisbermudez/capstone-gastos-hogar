import { type JSX, type ReactNode } from "react"

function Icono({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block", flexShrink: 0, width: 16, height: 16 }}
    >
      {children}
    </svg>
  )
}

export function IconoProveedor(): JSX.Element {
  return (
    <Icono>
      <path d="M2.2 6.35h11.6" />
      <path d="M3.15 6.35 4.05 4.15h7.9l.9 2.2" />
      <path d="M3.4 6.35V13.35h9.2V6.35" />
      <path d="M6.65 13.35V9.4h2.7v3.95" />
    </Icono>
  )
}

export function IconoCategoria(): JSX.Element {
  return (
    <Icono>
      <path d="M7.9 2.35H12.6c.6 0 1.05.45 1.05 1.05V8.1L7.55 13.7 2.25 8.4 7.9 2.35Z" />
      <circle cx="11.15" cy="4.9" r="0.75" />
    </Icono>
  )
}

export function IconoPeriodo(): JSX.Element {
  return (
    <Icono>
      <rect x="2.25" y="3.15" width="11.5" height="10.6" rx="1.6" />
      <path d="M2.25 6.6h11.5" />
      <path d="M5.2 1.9v2.4M10.8 1.9v2.4" />
    </Icono>
  )
}

export function IconoMoneda(): JSX.Element {
  return (
    <Icono>
      <rect x="1.6" y="3.85" width="12.8" height="8.3" rx="1.5" />
      <circle cx="8" cy="8" r="1.9" />
      <circle cx="4.35" cy="8" r="0.45" fill="currentColor" stroke="none" />
      <circle cx="11.65" cy="8" r="0.45" fill="currentColor" stroke="none" />
    </Icono>
  )
}

export function IconoComprobante(): JSX.Element {
  return (
    <Icono>
      <path d="M4.1 2.15h5.05L12.7 5.7V13.8H4.1Z" />
      <path d="M9.15 2.3V5.7H12.55" />
      <path d="M6.05 8.7h4.2M5.75 11.15h4.2" />
      <path d="M7.2 7.55 6.6 12.25M9.7 7.55 9.1 12.25" />
    </Icono>
  )
}

export function IconoPersona(): JSX.Element {
  return (
    <Icono>
      <circle cx="8" cy="5.35" r="2.15" />
      <path d="M3.15 13.4c.5-2.35 2.35-3.55 4.85-3.55s4.35 1.2 4.85 3.55" />
    </Icono>
  )
}

export function IconoFecha(): JSX.Element {
  return (
    <Icono>
      <circle cx="8" cy="8" r="5.25" />
      <path d="M8 4.7V8l2.35 1.6" />
    </Icono>
  )
}

export function IconoBusqueda(): JSX.Element {
  return (
    <Icono>
      <circle cx="6.9" cy="6.9" r="4.15" />
      <path d="m10.05 10.05 3.15 3.15" />
    </Icono>
  )
}

export function IconoArchivo(): JSX.Element {
  return (
    <Icono>
      <path d="M9.15 6.5V10.15a1.35 1.35 0 0 1-2.7 0V4.85a2.85 2.85 0 0 1 5.7 0v4.15a4.15 4.15 0 0 1-8.3 0V6.35" />
    </Icono>
  )
}

export function IconoChat(): JSX.Element {
  return (
    <Icono>
      <path d="M2.5 3.25h11c.7 0 1.25.55 1.25 1.25v5.5c0 .7-.55 1.25-1.25 1.25H6.7L3.5 13.75V11.25H2.5c-.7 0-1.25-.55-1.25-1.25V4.5c0-.7.55-1.25 1.25-1.25Z" />
    </Icono>
  )
}
