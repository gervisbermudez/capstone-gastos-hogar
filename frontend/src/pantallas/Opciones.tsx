import {
  Alert,
  Box,
  Button,
  Card,
  CloseButton,
  Dialog,
  Field,
  Heading,
  Input,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react"
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import { useNavigate } from "react-router"
import { ErrorApi, cliente } from "../api/cliente"
import { toaster } from "../avisos"
import { useSesion } from "../sesion"

const SOMBRA = "0 12px 40px rgba(28, 27, 23, 0.06)"

function useVivo() {
  const vivo = useRef(true)
  useEffect(() => {
    vivo.current = true
    return () => {
      vivo.current = false
    }
  }, [])
  return vivo
}

function mensajeDe(falla: unknown, respaldo: string): string {
  return falla instanceof ErrorApi ? falla.message : respaldo
}

function mismoEmail(escrito: string, actual: string | null): boolean {
  if (actual === null) return false
  return escrito.trim().toLowerCase() === actual.trim().toLowerCase()
}

function Alerta({ children }: { children: string }) {
  return (
    <Alert.Root
      status="error"
      alignItems="center"
      bg="estado.fallaFondo"
      color="marca.carbon"
      borderWidth="1px"
      borderStyle="solid"
      borderColor="estado.falla"
      borderRadius="16px"
    >
      <Alert.Indicator color="estado.falla" />
      <Alert.Description color="marca.carbon">{children}</Alert.Description>
    </Alert.Root>
  )
}

function Tarjeta({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <Card.Root
      bg="bg.panel"
      color="fg"
      borderWidth="0"
      borderRadius="l3"
      boxShadow={SOMBRA}
      _dark={{ borderWidth: "1px", borderColor: "borde" }}
    >
      <Card.Header>
        <Card.Title as="h2" fontWeight="medium" color="fg" letterSpacing="-0.03em">
          {titulo}
        </Card.Title>
      </Card.Header>
      <Card.Body>{children}</Card.Body>
    </Card.Root>
  )
}

type PropsBoton = {
  children: string
  loading?: boolean
  disabled?: boolean
  type?: "button" | "submit"
  onClick?: () => void
}

function BotonSol({ children, loading, disabled, type = "submit", onClick }: PropsBoton) {
  return (
    <Button
      type={type}
      loading={loading}
      disabled={disabled || loading}
      onClick={onClick}
      alignSelf="flex-start"
      borderRadius="full"
      fontWeight="600"
      bg="marca.sol"
      color="marca.carbon"
      _hover={{ bg: "#e8bc45", color: "marca.carbon" }}
      _active={{ bg: "#e8bc45", color: "marca.carbon" }}
    >
      {children}
    </Button>
  )
}

function BotonFalla({ children, loading, disabled, type = "button", onClick }: PropsBoton) {
  return (
    <Button
      type={type}
      loading={loading}
      disabled={disabled || loading}
      onClick={onClick}
      alignSelf="flex-start"
      borderRadius="full"
      fontWeight="600"
      bg="estado.falla"
      color="marca.papel"
      _hover={{ bg: "estado.falla", color: "marca.papel" }}
      _active={{ bg: "estado.falla", color: "marca.papel" }}
    >
      {children}
    </Button>
  )
}

function FormularioEmail({ onActualizado }: { onActualizado: (email: string) => void }) {
  const [emailNuevo, setEmailNuevo] = useState("")
  const [password, setPassword] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const vivo = useVivo()

  async function alEnviar(event: FormEvent) {
    event.preventDefault()
    if (enviando) return
    if (!emailNuevo.trim() || password === "") {
      setError("Completá el email nuevo y la contraseña actual.")
      return
    }
    setEnviando(true)
    setError(null)
    try {
      const usuario = await cliente.cambiarEmail(emailNuevo.trim(), password)
      onActualizado(usuario.email)
      toaster.create({ title: "Email actualizado", type: "success" })
      if (!vivo.current) return
      setEmailNuevo("")
      setPassword("")
    } catch (falla) {
      if (!vivo.current) return
      setError(mensajeDe(falla, "No se pudo cambiar el email."))
    } finally {
      if (vivo.current) setEnviando(false)
    }
  }

  return (
    <Stack gap={4}>
      <Text as="h3" fontWeight="medium" color="fg">
        Cambiar email
      </Text>
      <form noValidate onSubmit={(event) => void alEnviar(event)}>
        <Stack gap={4}>
          {error ? <Alerta>{error}</Alerta> : null}
          <Field.Root required>
            <Field.Label color="fg" fontWeight="medium">
              Email nuevo
            </Field.Label>
            <Input
              type="email"
              inputMode="email"
              autoComplete="email"
              name="email"
              value={emailNuevo}
              onChange={(event) => {
                setEmailNuevo(event.target.value)
                setError(null)
              }}
            />
          </Field.Root>
          <Field.Root required>
            <Field.Label color="fg" fontWeight="medium">
              Contraseña actual
            </Field.Label>
            <Input
              type="password"
              autoComplete="current-password"
              name="current-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                setError(null)
              }}
            />
          </Field.Root>
          <BotonSol loading={enviando}>Cambiar email</BotonSol>
        </Stack>
      </form>
    </Stack>
  )
}

function FormularioPassword() {
  const [passwordActual, setPasswordActual] = useState("")
  const [passwordNueva, setPasswordNueva] = useState("")
  const [passwordRepeticion, setPasswordRepeticion] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const vivo = useVivo()

  async function alEnviar(event: FormEvent) {
    event.preventDefault()
    if (enviando) return
    if (passwordNueva === "") {
      setError("La contraseña nueva no puede estar vacía.")
      return
    }
    if (passwordNueva !== passwordRepeticion) {
      setError("La contraseña nueva y la repetición no coinciden.")
      return
    }
    if (passwordActual === "") {
      setError("Ingresá la contraseña actual.")
      return
    }
    setEnviando(true)
    setError(null)
    try {
      await cliente.cambiarPassword(passwordActual, passwordNueva)
      toaster.create({ title: "Contraseña actualizada", type: "success" })
      if (!vivo.current) return
      setPasswordActual("")
      setPasswordNueva("")
      setPasswordRepeticion("")
    } catch (falla) {
      if (!vivo.current) return
      setError(mensajeDe(falla, "No se pudo cambiar la contraseña."))
    } finally {
      if (vivo.current) setEnviando(false)
    }
  }

  return (
    <Stack gap={4}>
      <Text as="h3" fontWeight="medium" color="fg">
        Cambiar contraseña
      </Text>
      <form noValidate onSubmit={(event) => void alEnviar(event)}>
        <Stack gap={4}>
          {error ? <Alerta>{error}</Alerta> : null}
          <Field.Root required>
            <Field.Label color="fg" fontWeight="medium">
              Contraseña actual
            </Field.Label>
            <Input
              type="password"
              autoComplete="current-password"
              name="current-password"
              value={passwordActual}
              onChange={(event) => {
                setPasswordActual(event.target.value)
                setError(null)
              }}
            />
          </Field.Root>
          <Field.Root required>
            <Field.Label color="fg" fontWeight="medium">
              Contraseña nueva
            </Field.Label>
            <Input
              type="password"
              autoComplete="new-password"
              name="new-password"
              value={passwordNueva}
              onChange={(event) => {
                setPasswordNueva(event.target.value)
                setError(null)
              }}
            />
          </Field.Root>
          <Field.Root required>
            <Field.Label color="fg" fontWeight="medium">
              Repetí la contraseña
            </Field.Label>
            <Input
              type="password"
              autoComplete="new-password"
              name="confirm-password"
              value={passwordRepeticion}
              onChange={(event) => {
                setPasswordRepeticion(event.target.value)
                setError(null)
              }}
            />
          </Field.Root>
          <BotonSol loading={enviando}>Cambiar contraseña</BotonSol>
        </Stack>
      </form>
    </Stack>
  )
}

function BloqueEliminar({ email, onSalir }: { email: string | null; onSalir: () => void }) {
  const [abierto, setAbierto] = useState(false)
  const [password, setPassword] = useState("")
  const [emailEscrito, setEmailEscrito] = useState("")
  const [eliminando, setEliminando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const vivo = useVivo()
  const puedeConfirmar = mismoEmail(emailEscrito, email) && password !== "" && !eliminando

  function abrir() {
    if (!email || eliminando) return
    setPassword("")
    setEmailEscrito("")
    setError(null)
    setAbierto(true)
  }

  function alCambioAbierto(detalle: { open: boolean }) {
    if (eliminando && !detalle.open) return
    setAbierto(detalle.open)
    if (!detalle.open) {
      setPassword("")
      setEmailEscrito("")
      setError(null)
    }
  }

  async function alConfirmar(event: FormEvent) {
    event.preventDefault()
    if (eliminando || !email) return
    if (!mismoEmail(emailEscrito, email)) return
    if (password === "") {
      setError("Ingresá la contraseña actual.")
      return
    }
    setEliminando(true)
    setError(null)
    try {
      await cliente.eliminarCuenta(password)
      onSalir()
    } catch (falla) {
      if (!vivo.current) return
      setError(mensajeDe(falla, "No se pudo eliminar la cuenta."))
    } finally {
      if (vivo.current) setEliminando(false)
    }
  }

  return (
    <Tarjeta titulo="Eliminar cuenta">
      <Stack gap={4}>
        <Text color="fg" lineHeight="1.5">
          Se borra la cuenta y no se puede deshacer.
        </Text>
        <BotonFalla onClick={abrir} disabled={!email}>
          Eliminar cuenta
        </BotonFalla>
        <Dialog.Root
          role="alertdialog"
          open={abierto}
          onOpenChange={alCambioAbierto}
          closeOnEscape={!eliminando}
          closeOnInteractOutside={!eliminando}
        >
          <Portal>
            <Dialog.Backdrop />
            <Dialog.Positioner>
              <Dialog.Content
                bg="bg.panel"
                color="fg"
                borderWidth="0"
                borderRadius="l3"
                boxShadow="0 24px 60px rgba(28, 27, 23, 0.12)"
                w="calc(100vw - 2rem)"
                maxW="28rem"
                _dark={{ borderWidth: "1px", borderColor: "borde" }}
              >
                <Dialog.Header>
                  <Dialog.Title
                    fontWeight="500"
                    fontSize="1.5rem"
                    letterSpacing="-0.03em"
                    color="fg"
                  >
                    Eliminar cuenta
                  </Dialog.Title>
                </Dialog.Header>
                <form noValidate onSubmit={(event) => void alConfirmar(event)}>
                  <Dialog.Body>
                    <Stack gap={4}>
                      <Dialog.Description color="fg.muted">
                        Esta acción no se puede deshacer. Ingresá la contraseña actual y escribí{" "}
                        <Text as="span" fontWeight="medium" color="fg" overflowWrap="anywhere">
                          {email}
                        </Text>{" "}
                        para confirmar.
                      </Dialog.Description>
                      {error ? <Alerta>{error}</Alerta> : null}
                      <Field.Root required>
                        <Field.Label color="fg" fontWeight="medium">
                          Contraseña actual
                        </Field.Label>
                        <Input
                          type="password"
                          autoComplete="current-password"
                          name="current-password"
                          value={password}
                          onChange={(event) => {
                            setPassword(event.target.value)
                            setError(null)
                          }}
                        />
                      </Field.Root>
                      <Field.Root required>
                        <Field.Label color="fg" fontWeight="medium">
                          Email
                        </Field.Label>
                        <Input
                          type="email"
                          inputMode="email"
                          autoComplete="email"
                          name="email"
                          value={emailEscrito}
                          onChange={(event) => {
                            setEmailEscrito(event.target.value)
                            setError(null)
                          }}
                        />
                        <Field.HelperText color="fg.muted">
                          Tiene que coincidir con el email de la sesión.
                        </Field.HelperText>
                      </Field.Root>
                    </Stack>
                  </Dialog.Body>
                  <Dialog.Footer gap={3}>
                    <Dialog.ActionTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        borderRadius="full"
                        color="fg"
                        disabled={eliminando}
                        _hover={{ bg: "bg.hover", color: "fg" }}
                      >
                        Cancelar
                      </Button>
                    </Dialog.ActionTrigger>
                    <BotonFalla type="submit" loading={eliminando} disabled={!puedeConfirmar}>
                      Eliminar cuenta
                    </BotonFalla>
                  </Dialog.Footer>
                </form>
                <Dialog.CloseTrigger asChild>
                  <CloseButton aria-label="Cerrar" color="fg" disabled={eliminando} />
                </Dialog.CloseTrigger>
              </Dialog.Content>
            </Dialog.Positioner>
          </Portal>
        </Dialog.Root>
      </Stack>
    </Tarjeta>
  )
}

export function Opciones() {
  const { email, salir, actualizarEmail } = useSesion()
  const navigate = useNavigate()

  function alSalir() {
    salir()
    navigate("/ingreso", { replace: true })
  }

  return (
    <Stack gap={{ base: 6, md: 8 }} w="100%" maxW="40rem">
      <Stack gap={2}>
        <Heading
          as="h1"
          color="fg"
          fontSize={{ base: "2rem", md: "2.5rem" }}
          fontWeight="medium"
          letterSpacing="-0.03em"
          lineHeight="1.1"
        >
          Opciones
        </Heading>
        <Text color="fg.muted" fontSize={{ base: "md", md: "lg" }} lineHeight="1.5">
          El email, la contraseña y la sesión de esta pestaña.
        </Text>
      </Stack>

      <Tarjeta titulo="Cuenta">
        <Stack gap={6}>
          <Stack gap={1}>
            <Text fontSize="sm" color="fg.muted">
              Email actual
            </Text>
            <Text fontWeight="medium" color="fg" overflowWrap="anywhere">
              {email ?? "No pudimos leer el email de la sesión."}
            </Text>
          </Stack>
          <FormularioEmail onActualizado={actualizarEmail} />
          <Box as="hr" border="0" borderTopWidth="1px" borderColor="borde" />
          <FormularioPassword />
        </Stack>
      </Tarjeta>

      <Tarjeta titulo="Sesión">
        <Stack gap={4}>
          <Text color="fg" lineHeight="1.5">
            La sesión de esta pestaña dura 15 minutos. Si cerrás la pestaña, la sesión se borra.
          </Text>
          <BotonSol type="button" onClick={alSalir}>
            Salir
          </BotonSol>
        </Stack>
      </Tarjeta>

      <Tarjeta titulo="Modelo">
        <Text color="fg" lineHeight="1.5">
          El modelo y el índice los configura quien levanta la API. Esta pantalla no pide ni muestra claves.
        </Text>
      </Tarjeta>

      <Box pt={{ base: 4, md: 8 }} borderTopWidth="1px" borderColor="borde">
        <BloqueEliminar email={email} onSalir={alSalir} />
      </Box>
    </Stack>
  )
}
