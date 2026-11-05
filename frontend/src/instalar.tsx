import { Button, CloseButton, Dialog, Portal, Text } from "@chakra-ui/react"
import { useCallback, useState, useSyncExternalStore } from "react"

interface EventoInstalar extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

declare global {
  interface Window {
    __ofertaInstalar: EventoInstalar | null
    __aplicacionInstalada?: boolean
  }
}

function estaInstalada() {
  return window.__aplicacionInstalada === true || window.matchMedia("(display-mode: standalone)").matches
}

function suscribir(oyente: () => void) {
  const media = window.matchMedia("(display-mode: standalone)")
  media.addEventListener("change", oyente)
  window.addEventListener("capstone-instalar", oyente)
  return () => {
    media.removeEventListener("change", oyente)
    window.removeEventListener("capstone-instalar", oyente)
  }
}

export function BotonInstalar({ completo = false }: { completo?: boolean }) {
  const visible = useSyncExternalStore(suscribir, () => !estaInstalada(), () => false)
  const [ayuda, setAyuda] = useState(false)

  const instalar = useCallback(() => {
    const pendiente = window.__ofertaInstalar
    if (!pendiente) {
      setAyuda(true)
      return
    }
    void pendiente
      .prompt()
      .then(() => pendiente.userChoice)
      .finally(() => {
        window.__ofertaInstalar = null
        window.dispatchEvent(new Event("capstone-instalar"))
      })
  }, [])

  if (!visible) return null

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size={completo ? "md" : "sm"}
        w={completo ? "100%" : undefined}
        borderRadius="full"
        color="fg"
        fontWeight="600"
        _hover={{ bg: "bg.hover", color: "fg" }}
        onClick={instalar}
      >
        {completo ? "Instalar aplicación" : "Instalar"}
      </Button>
      <Dialog.Root open={ayuda} onOpenChange={(detalle) => setAyuda(detalle.open)}>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content bg="bg.panel" color="fg" borderRadius="l3">
              <Dialog.Header>
                <Dialog.Title>Instalar Capstone</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>
                <Text color="fg" lineHeight="1.5">
                  En Chrome o Edge, abrí el menú de la barra de direcciones y elegí Instalar Capstone.
                </Text>
              </Dialog.Body>
              <Dialog.CloseTrigger asChild>
                <CloseButton aria-label="Cerrar" color="fg" />
              </Dialog.CloseTrigger>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </>
  )
}
