import { Portal, Spinner, Stack, Toast, Toaster, createToaster } from "@chakra-ui/react"

export const toaster = createToaster({
  placement: "bottom-end",
  pauseOnPageIdle: true,
})

function esEstado(tipo: string | undefined): tipo is "success" | "warning" | "error" {
  return tipo === "success" || tipo === "warning" || tipo === "error"
}

function IconoEstado({ tipo }: { tipo: "success" | "warning" | "error" }) {
  const trazo = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  }
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" style={{ flexShrink: 0, color: "var(--toast-accent)" }}>
      {tipo === "success" ? (
        <>
          <circle cx="12" cy="12" r="9" {...trazo} />
          <path d="m8 12.5 3 3 5.5-6.5" {...trazo} />
        </>
      ) : null}
      {tipo === "warning" ? (
        <>
          <path d="M12 3.5 21.5 20H2.5L12 3.5Z" {...trazo} />
          <path d="M12 9.5v5" {...trazo} />
          <path d="M12 17.5h.01" {...trazo} />
        </>
      ) : null}
      {tipo === "error" ? (
        <>
          <circle cx="12" cy="12" r="9" {...trazo} />
          <path d="m9 9 6 6M15 9l-6 6" {...trazo} />
        </>
      ) : null}
    </svg>
  )
}

export function Avisos() {
  return (
    <Portal>
      <Toaster toaster={toaster} aria-label="Avisos">
        {(aviso) => (
          <Toast.Root>
            {aviso.type === "loading" ? (
              <Spinner size="sm" color="var(--toast-accent)" />
            ) : esEstado(aviso.type) ? (
              <IconoEstado tipo={aviso.type} />
            ) : (
              <Toast.Indicator />
            )}
            <Stack gap="1" flex="1" maxW="100%">
              {aviso.title ? <Toast.Title>{aviso.title}</Toast.Title> : null}
              {aviso.description ? <Toast.Description>{aviso.description}</Toast.Description> : null}
            </Stack>
            {aviso.action ? <Toast.ActionTrigger>{aviso.action.label}</Toast.ActionTrigger> : null}
            {aviso.closable ? <Toast.CloseTrigger aria-label="Cerrar aviso" /> : null}
          </Toast.Root>
        )}
      </Toaster>
    </Portal>
  )
}
