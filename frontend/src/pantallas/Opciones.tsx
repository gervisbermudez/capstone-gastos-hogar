import {
  Alert,
  Box,
  Button,
  Card,
  CloseButton,
  Dialog,
  Field,
  Flex,
  Heading,
  Input,
  Portal,
  Stack,
  Switch,
  Text,
} from "@chakra-ui/react"
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router"
import { ErrorApi, cliente, esAbort } from "../api/cliente"
import type { Hogar, MiembroHogar, ModeloActivo, RolHogar, UsuarioActual } from "../api/tipos"
import { toaster } from "../avisos"
import { suscribirEventos } from "../canalBus"
import { EsqueletoLineas } from "../componentes/esqueleto"
import { useHogar } from "../hogar"
import { useSesion } from "../sesion"
import { useTema } from "../temaModo"

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

function Tarjeta({ id, titulo, children }: { id?: string; titulo: string; children: ReactNode }) {
  return (
    <Card.Root
      id={id}
      scrollMargin="1rem"
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

function FormularioNombre({
  nombre,
  onActualizado,
}: {
  nombre: string | null
  onActualizado: (nombre: string | null) => void
}) {
  const [escrito, setEscrito] = useState(nombre ?? "")
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const vivo = useVivo()

  useEffect(() => {
    setEscrito(nombre ?? "")
  }, [nombre])

  async function alEnviar(event: FormEvent) {
    event.preventDefault()
    if (enviando) return
    const texto = escrito.trim()
    setEnviando(true)
    setError(null)
    try {
      const usuario = await cliente.cambiarNombre(texto === "" ? null : texto)
      onActualizado(usuario.nombre)
      toaster.create({ title: "Nombre actualizado", type: "success" })
      if (!vivo.current) return
      setEscrito(usuario.nombre ?? "")
    } catch (falla) {
      if (!vivo.current) return
      setError(mensajeDe(falla, "No se pudo guardar el nombre."))
    } finally {
      if (vivo.current) setEnviando(false)
    }
  }

  return (
    <form noValidate onSubmit={(event) => void alEnviar(event)}>
      <Stack gap={4}>
        {error ? <Alerta>{error}</Alerta> : null}
        <Field.Root>
          <Field.Label color="fg" fontWeight="medium">
            Nombre
          </Field.Label>
          <Input
            type="text"
            autoComplete="nickname"
            name="nombre"
            value={escrito}
            onChange={(event) => {
              setEscrito(event.target.value)
              setError(null)
            }}
          />
          <Field.HelperText color="fg.muted">
            Se muestra en lugar del email. Para entrar y para borrar la cuenta se sigue usando el email.
          </Field.HelperText>
        </Field.Root>
        <BotonSol loading={enviando}>Guardar</BotonSol>
      </Stack>
    </form>
  )
}

function FormularioEmail({ onActualizado }: { onActualizado: (usuario: UsuarioActual) => void }) {
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
      onActualizado(usuario)
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

function etiquetaProveedor(proveedor: ModeloActivo["proveedor"]): string {
  return proveedor === "openai" ? "OpenAI" : "Gemini"
}

function BloqueApariencia() {
  const { oscuro, alternar } = useTema()

  return (
    <Tarjeta id="apariencia" titulo="Apariencia">
      <Switch.Root
        size="sm"
        checked={oscuro}
        onCheckedChange={(detalle) => {
          if (detalle.checked !== oscuro) alternar()
        }}
      >
        <Switch.HiddenInput />
        <Switch.Control bg="bg.hover" _checked={{ bg: "marca.sol" }}>
          <Switch.Thumb bg="fg" _checked={{ bg: "marca.carbon" }} />
        </Switch.Control>
        <Switch.Label color="fg" fontSize="sm">
          Oscuro
        </Switch.Label>
      </Switch.Root>
    </Tarjeta>
  )
}

function BloqueModelo() {
  const [activo, setActivo] = useState<ModeloActivo | null>(null)
  const [falla, setFalla] = useState(false)
  const vivo = useVivo()

  useEffect(() => {
    const ctrl = new AbortController()
    cliente
      .modelo(ctrl.signal)
      .then((valor) => {
        if (!vivo.current) return
        setActivo(valor)
      })
      .catch((error: unknown) => {
        if (!vivo.current || esAbort(error)) return
        setFalla(true)
      })
    return () => ctrl.abort()
  }, [vivo])

  return (
    <Tarjeta id="modelo" titulo="Modelo">
      <Stack gap={2}>
        {falla ? (
          <Text color="fg" lineHeight="1.5">
            No se pudo leer el modelo.
          </Text>
        ) : activo === null ? (
          <EsqueletoLineas etiqueta="Leyendo el modelo" anchos={["6.5rem", "11rem"]} />
        ) : activo.modelo === null ? (
          <Text color="fg" lineHeight="1.5">
            No hay un modelo configurado.
          </Text>
        ) : (
          <Stack gap={1}>
            <Text fontSize="sm" color="fg.muted">
              {etiquetaProveedor(activo.proveedor)}
            </Text>
            <Text fontWeight="medium" color="fg">
              {activo.modelo}
            </Text>
          </Stack>
        )}
        <Text color="fg.muted" lineHeight="1.5">
          Esta pantalla no pide ni muestra claves.
        </Text>
      </Stack>
    </Tarjeta>
  )
}

function etiquetaRol(rol: RolHogar): string {
  return rol === "administrador" ? "Administrador" : "Asociado"
}

function direccionEscrita(valor: string): string | null {
  const texto = valor.trim()
  return texto === "" ? null : texto
}

function VistaHogar({ hogar, onDejado }: { hogar: Hogar; onDejado: () => Promise<void> }) {
  const [abierto, setAbierto] = useState(false)
  const [saliendo, setSaliendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const vivo = useVivo()

  useEffect(() => {
    setAbierto(false)
    setError(null)
  }, [hogar.id])

  function abrir() {
    if (saliendo) return
    setError(null)
    setAbierto(true)
  }

  function alCambioAbierto(detalle: { open: boolean }) {
    if (saliendo && !detalle.open) return
    setAbierto(detalle.open)
    if (!detalle.open) setError(null)
  }

  async function alConfirmar(event: FormEvent) {
    event.preventDefault()
    if (saliendo) return
    setSaliendo(true)
    setError(null)
    try {
      await cliente.dejarHogar(hogar.id)
    } catch (falla) {
      if (!vivo.current) return
      setError(mensajeDe(falla, "No se pudo desasociar."))
      setSaliendo(false)
      return
    }
    toaster.create({ title: "Te desasociaste", type: "success" })
    if (!vivo.current) return
    setAbierto(false)
    try {
      await onDejado()
    } catch {
      if (vivo.current) setError("Te desasociaste, pero no se pudo actualizar la lista.")
    } finally {
      if (vivo.current) setSaliendo(false)
    }
  }

  return (
    <Stack gap={4}>
      <Text color="fg.muted" lineHeight="1.5">
        En este hogar sos asociado. Si te vas, las cargas quedan en el hogar. El administrador puede borrarlas.
      </Text>
      <Stack gap={1}>
        <Text fontSize="sm" color="fg.muted">
          Nombre
        </Text>
        <Text fontWeight="medium" color="fg" overflowWrap="anywhere">
          {hogar.nombre}
        </Text>
      </Stack>
      <Stack gap={1}>
        <Text fontSize="sm" color="fg.muted">
          Dirección
        </Text>
        <Text color="fg" overflowWrap="anywhere">
          {hogar.direccion ?? "Sin dirección"}
        </Text>
      </Stack>
      <BotonFalla onClick={abrir} loading={saliendo}>
        Desasociarme
      </BotonFalla>
      <Dialog.Root
        role="alertdialog"
        open={abierto}
        onOpenChange={alCambioAbierto}
        closeOnEscape={!saliendo}
        closeOnInteractOutside={!saliendo}
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
                <Dialog.Title fontWeight="500" fontSize="1.5rem" letterSpacing="-0.03em" color="fg">
                  Desasociarte de este hogar
                </Dialog.Title>
              </Dialog.Header>
              <form noValidate onSubmit={(event) => void alConfirmar(event)}>
                <Dialog.Body>
                  <Stack gap={4}>
                    <Dialog.Description color="fg.muted">
                      Dejás de ver{" "}
                      <Text as="span" fontWeight="medium" color="fg" overflowWrap="anywhere">
                        {hogar.nombre}
                      </Text>
                      . Las cargas quedan en el hogar y el administrador puede borrarlas. También puede volverte a sumar.
                    </Dialog.Description>
                    {error ? <Alerta>{error}</Alerta> : null}
                  </Stack>
                </Dialog.Body>
                <Dialog.Footer gap={3}>
                  <Dialog.ActionTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      borderRadius="full"
                      color="fg"
                      disabled={saliendo}
                      _hover={{ bg: "bg.hover", color: "fg" }}
                    >
                      Cancelar
                    </Button>
                  </Dialog.ActionTrigger>
                  <BotonFalla type="submit" loading={saliendo}>
                    Desasociarme
                  </BotonFalla>
                </Dialog.Footer>
              </form>
              <Dialog.CloseTrigger asChild>
                <CloseButton aria-label="Cerrar" color="fg" disabled={saliendo} />
              </Dialog.CloseTrigger>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </Stack>
  )
}

function FormularioEditarHogar({ hogar, onGuardado }: { hogar: Hogar; onGuardado: () => Promise<void> }) {
  const [nombre, setNombre] = useState(hogar.nombre)
  const [direccion, setDireccion] = useState(hogar.direccion ?? "")
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const vivo = useVivo()

  useEffect(() => {
    setNombre(hogar.nombre)
    setDireccion(hogar.direccion ?? "")
  }, [hogar.id, hogar.nombre, hogar.direccion])

  async function alEnviar(event: FormEvent) {
    event.preventDefault()
    if (enviando) return
    const texto = nombre.trim()
    if (!texto) {
      setError("Completá el nombre.")
      return
    }
    setEnviando(true)
    setError(null)
    try {
      await cliente.actualizarHogar(hogar.id, {
        nombre: texto,
        direccion: direccionEscrita(direccion),
      })
      await onGuardado()
      toaster.create({ title: "Hogar actualizado", type: "success" })
    } catch (falla) {
      if (!vivo.current) return
      setError(mensajeDe(falla, "No se pudo guardar el hogar."))
    } finally {
      if (vivo.current) setEnviando(false)
    }
  }

  return (
    <form noValidate onSubmit={(event) => void alEnviar(event)}>
      <Stack gap={4}>
        {error ? <Alerta>{error}</Alerta> : null}
        <Field.Root required>
          <Field.Label color="fg" fontWeight="medium">
            Nombre
          </Field.Label>
          <Input
            type="text"
            name="hogar-nombre"
            autoComplete="off"
            maxLength={80}
            value={nombre}
            onChange={(event) => {
              setNombre(event.target.value)
              setError(null)
            }}
          />
        </Field.Root>
        <Field.Root>
          <Field.Label color="fg" fontWeight="medium">
            Dirección
          </Field.Label>
          <Input
            type="text"
            name="hogar-direccion"
            autoComplete="street-address"
            maxLength={160}
            value={direccion}
            onChange={(event) => {
              setDireccion(event.target.value)
              setError(null)
            }}
          />
          <Field.HelperText color="fg.muted">Si la dejás vacía, se borra.</Field.HelperText>
        </Field.Root>
        <BotonSol loading={enviando}>Guardar</BotonSol>
      </Stack>
    </form>
  )
}

function ListaMiembros({ hogarId }: { hogarId: string }) {
  const [items, setItems] = useState<MiembroHogar[] | null>(null)
  const [cargando, setCargando] = useState(true)
  const [errorLista, setErrorLista] = useState<string | null>(null)
  const [email, setEmail] = useState("")
  const [errorAlta, setErrorAlta] = useState<string | null>(null)
  const [sumando, setSumando] = useState(false)
  const [quitando, setQuitando] = useState<string | null>(null)
  const [errorQuitar, setErrorQuitar] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const vivo = useVivo()

  useEffect(() => {
    return suscribirEventos((evento) => {
      if (evento.tipo !== "hogar.membresia" || evento.recurso?.id !== hogarId) return
      setVersion((valor) => valor + 1)
    })
  }, [hogarId])

  useEffect(() => {
    const ctrl = new AbortController()
    setCargando(true)
    cliente
      .listarMiembros(hogarId, ctrl.signal)
      .then((lista) => {
        if (!vivo.current) return
        setItems(lista.items)
        setErrorLista(null)
      })
      .catch((falla: unknown) => {
        if (!vivo.current || esAbort(falla)) return
        setErrorLista(mensajeDe(falla, "No se pudieron cargar los miembros."))
      })
      .finally(() => {
        if (vivo.current && !ctrl.signal.aborted) setCargando(false)
      })
    return () => ctrl.abort()
  }, [hogarId, version, vivo])

  async function alSumar(event: FormEvent) {
    event.preventDefault()
    if (sumando || quitando) return
    const texto = email.trim()
    if (!texto) {
      setErrorAlta("Completá el email.")
      return
    }
    setSumando(true)
    setErrorAlta(null)
    try {
      await cliente.agregarMiembro(hogarId, texto)
      toaster.create({ title: "Miembro sumado", type: "success" })
      if (!vivo.current) return
      setEmail("")
      setVersion((valor) => valor + 1)
    } catch (falla) {
      if (!vivo.current) return
      setErrorAlta(mensajeDe(falla, "No se pudo sumar el miembro."))
    } finally {
      if (vivo.current) setSumando(false)
    }
  }

  async function alQuitar(userId: string) {
    if (quitando || sumando) return
    setQuitando(userId)
    setErrorQuitar(null)
    try {
      await cliente.quitarMiembro(hogarId, userId)
      toaster.create({ title: "Miembro quitado", type: "success" })
      if (!vivo.current) return
      setVersion((valor) => valor + 1)
    } catch (falla) {
      if (!vivo.current) return
      setErrorQuitar(mensajeDe(falla, "No se pudo quitar el miembro."))
    } finally {
      if (vivo.current) setQuitando(null)
    }
  }

  return (
    <Stack gap={4}>
      <Text as="h3" fontWeight="medium" color="fg">
        Miembros
      </Text>
      {errorLista ? <Alerta>{errorLista}</Alerta> : null}
      {cargando && items === null ? (
        <EsqueletoLineas etiqueta="Cargando miembros" anchos={["14rem", "11rem"]} />
      ) : null}
      {items ? (
        <Stack gap={3}>
          {items.map((miembro) => (
            <Flex key={miembro.user_id} justify="space-between" align="center" gap={3} minW={0}>
              <Stack gap={0} minW={0}>
                <Text fontWeight="medium" color="fg" overflowWrap="anywhere">
                  {miembro.email}
                </Text>
                <Text fontSize="sm" color="fg.muted" overflowWrap="anywhere">
                  {miembro.nombre ? `${miembro.nombre} · ${etiquetaRol(miembro.rol)}` : etiquetaRol(miembro.rol)}
                </Text>
              </Stack>
              {miembro.rol === "asociado" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  flexShrink={0}
                  borderRadius="full"
                  color="estadoTexto.falla"
                  loading={quitando === miembro.user_id}
                  disabled={quitando !== null || sumando}
                  onClick={() => void alQuitar(miembro.user_id)}
                >
                  Quitar
                </Button>
              ) : null}
            </Flex>
          ))}
        </Stack>
      ) : null}
      {errorQuitar ? <Alerta>{errorQuitar}</Alerta> : null}
      <form noValidate onSubmit={(event) => void alSumar(event)}>
        <Stack gap={4}>
          {errorAlta ? <Alerta>{errorAlta}</Alerta> : null}
          <Field.Root required>
            <Field.Label color="fg" fontWeight="medium">
              Email
            </Field.Label>
            <Input
              type="email"
              inputMode="email"
              autoComplete="off"
              name="miembro-email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
                setErrorAlta(null)
              }}
            />
            <Field.HelperText color="fg.muted">Tiene que ser el email de una cuenta que ya existe.</Field.HelperText>
          </Field.Root>
          <BotonSol loading={sumando} disabled={quitando !== null}>
            Sumar
          </BotonSol>
        </Stack>
      </form>
    </Stack>
  )
}

function FormularioNuevoHogar() {
  const { elegir, recargar } = useHogar()
  const [nombre, setNombre] = useState("")
  const [direccion, setDireccion] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const vivo = useVivo()

  async function alEnviar(event: FormEvent) {
    event.preventDefault()
    if (enviando) return
    const texto = nombre.trim()
    if (!texto) {
      setError("Completá el nombre.")
      return
    }
    setEnviando(true)
    setError(null)
    try {
      const creado = await cliente.crearHogar({
        nombre: texto,
        direccion: direccionEscrita(direccion),
      })
      await recargar()
      elegir(creado.id)
      toaster.create({ title: "Hogar creado", type: "success" })
      if (!vivo.current) return
      setNombre("")
      setDireccion("")
    } catch (falla) {
      if (!vivo.current) return
      setError(mensajeDe(falla, "No se pudo crear el hogar."))
    } finally {
      if (vivo.current) setEnviando(false)
    }
  }

  return (
    <Tarjeta titulo="Nuevo hogar">
      <form noValidate onSubmit={(event) => void alEnviar(event)}>
        <Stack gap={4}>
          {error ? <Alerta>{error}</Alerta> : null}
          <Field.Root required>
            <Field.Label color="fg" fontWeight="medium">
              Nombre
            </Field.Label>
            <Input
              type="text"
              name="hogar-nuevo-nombre"
              autoComplete="off"
              maxLength={80}
              value={nombre}
              onChange={(event) => {
                setNombre(event.target.value)
                setError(null)
              }}
            />
          </Field.Root>
          <Field.Root>
            <Field.Label color="fg" fontWeight="medium">
              Dirección
            </Field.Label>
            <Input
              type="text"
              name="hogar-nuevo-direccion"
              autoComplete="street-address"
              maxLength={160}
              value={direccion}
              onChange={(event) => {
                setDireccion(event.target.value)
                setError(null)
              }}
            />
            <Field.HelperText color="fg.muted">
              La dirección es opcional. Quedás como administrador.
            </Field.HelperText>
          </Field.Root>
          <BotonSol loading={enviando}>Crear hogar</BotonSol>
        </Stack>
      </form>
    </Tarjeta>
  )
}

function ListaPertenencia({
  hogares,
  activoId,
  onElegir,
}: {
  hogares: Hogar[]
  activoId: string | null
  onElegir: (id: string) => void
}) {
  return (
    <Stack as="ul" gap={2} m={0} p={0} listStyleType="none" aria-label="Hogares a los que pertenecés">
      {hogares.map((hogar) => {
        const activo = hogar.id === activoId
        return (
          <Box as="li" key={hogar.id}>
            <Button
              type="button"
              variant="ghost"
              justifyContent="space-between"
              alignItems="center"
              gap={3}
              w="100%"
              h="auto"
              py={2}
              px={3}
              borderRadius="12px"
              fontWeight="normal"
              bg={activo ? "bg.subtle" : "transparent"}
              color="fg"
              aria-pressed={activo}
              onClick={() => onElegir(hogar.id)}
            >
              <Text as="span" fontWeight="medium" color="fg" textAlign="left" overflowWrap="anywhere">
                {hogar.nombre}
              </Text>
              <Text as="span" fontSize="sm" color="fg.muted" flexShrink={0}>
                {etiquetaRol(hogar.rol)}
              </Text>
            </Button>
          </Box>
        )
      })}
    </Stack>
  )
}

function BloqueHogar() {
  const { hogares, hogarActivo, rol, elegir, recargar } = useHogar()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { pathname, hash } = useLocation()
  const pedido = params.get("hogar")
  const esAdmin = rol === "administrador" && hogarActivo !== null

  useEffect(() => {
    if (!pedido || !hogares.some((hogar) => hogar.id === pedido)) return
    if (hogarActivo?.id !== pedido) elegir(pedido)
    const siguientes = new URLSearchParams(params)
    siguientes.delete("hogar")
    const search = siguientes.toString()
    navigate(
      { pathname, search: search ? `?${search}` : "", hash: hash || "#hogar" },
      { replace: true },
    )
  }, [pedido, hogares, hogarActivo, elegir, params, navigate, pathname, hash])

  return (
    <>
      <Tarjeta id="hogar" titulo="Hogares">
        {hogares.length === 0 || hogarActivo === null ? (
          <Text color="fg" lineHeight="1.5">
            No hay un hogar activo.
          </Text>
        ) : (
          <Stack gap={6}>
            <ListaPertenencia hogares={hogares} activoId={hogarActivo.id} onElegir={elegir} />
            <Box as="hr" border="0" borderTopWidth="1px" borderColor="borde" />
            {esAdmin ? (
              <Stack gap={6}>
                <FormularioEditarHogar hogar={hogarActivo} onGuardado={recargar} />
                <Box as="hr" border="0" borderTopWidth="1px" borderColor="borde" />
                <ListaMiembros hogarId={hogarActivo.id} />
              </Stack>
            ) : (
              <VistaHogar hogar={hogarActivo} onDejado={recargar} />
            )}
          </Stack>
        )}
      </Tarjeta>
      <FormularioNuevoHogar />
    </>
  )
}

export function Opciones() {
  const { email, nombre, salir, aplicarUsuario, actualizarNombre } = useSesion()
  const { hash } = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    if (!hash || hash === "#") return
    const id = hash.slice(1)
    const marco = requestAnimationFrame(() => {
      const nodo = document.getElementById(id)
      const main = nodo?.closest("main")
      if (!(nodo instanceof HTMLElement) || !(main instanceof HTMLElement)) return
      const delta = nodo.getBoundingClientRect().top - main.getBoundingClientRect().top
      main.scrollTo({ top: main.scrollTop + delta - 16 })
    })
    return () => cancelAnimationFrame(marco)
  }, [hash])

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
          Los hogares a los que pertenecés, el nombre, el email, la contraseña, la apariencia, el modelo y la sesión de esta pestaña.
        </Text>
      </Stack>

      <BloqueHogar />

      <Tarjeta id="cuenta" titulo="Cuenta">
        <Stack gap={6}>
          <FormularioNombre nombre={nombre} onActualizado={actualizarNombre} />
          <Stack gap={1}>
            <Text fontSize="sm" color="fg.muted">
              Email actual
            </Text>
            <Text fontWeight="medium" color="fg" overflowWrap="anywhere">
              {email ?? "No pudimos leer el email de la sesión."}
            </Text>
          </Stack>
          <FormularioEmail onActualizado={aplicarUsuario} />
          <Box as="hr" border="0" borderTopWidth="1px" borderColor="borde" />
          <FormularioPassword />
        </Stack>
      </Tarjeta>

      <BloqueApariencia />

      <BloqueModelo />

      <Tarjeta id="sesion" titulo="Sesión">
        <Stack gap={4}>
          <Text color="fg" lineHeight="1.5">
            La sesión de esta pestaña dura 15 minutos. Si cerrás la pestaña, la sesión se borra.
          </Text>
          <BotonSol type="button" onClick={alSalir}>
            Salir
          </BotonSol>
        </Stack>
      </Tarjeta>

      <Box pt={{ base: 4, md: 8 }} borderTopWidth="1px" borderColor="borde">
        <BloqueEliminar email={email} onSalir={alSalir} />
      </Box>
    </Stack>
  )
}
