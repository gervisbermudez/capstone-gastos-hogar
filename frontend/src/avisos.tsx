import { Portal, Spinner, Stack, Toast, Toaster, createToaster } from "@chakra-ui/react"

export const toaster = createToaster({
  placement: "bottom-end",
  pauseOnPageIdle: true,
})

export function Avisos() {
  return (
    <Portal>
      <Toaster toaster={toaster}>
        {(aviso) => (
          <Toast.Root>
            {aviso.type === "loading" ? <Spinner size="sm" /> : <Toast.Indicator />}
            <Stack gap="1" flex="1" maxW="100%">
              {aviso.title ? <Toast.Title>{aviso.title}</Toast.Title> : null}
              {aviso.description ? <Toast.Description>{aviso.description}</Toast.Description> : null}
            </Stack>
            {aviso.closable ? <Toast.CloseTrigger /> : null}
          </Toast.Root>
        )}
      </Toaster>
    </Portal>
  )
}
