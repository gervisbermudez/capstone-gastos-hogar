import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import {
  Alert,
  Box,
  Button,
  Card,
  CloseButton,
  Dialog,
  EmptyState,
  Field,
  Flex,
  Heading,
  Input,
  Menu,
  Portal,
  Stack,
  Table,
  Text,
  Textarea,
} from "@chakra-ui/react"
import { ErrorApi, cliente, esAbort } from "../api/cliente"
import type { CategoriaCatalogo, CategoriaItem } from "../api/tipos"
import { EsqueletoTabla, Hueso } from "../componentes/esqueleto"
import { IconoPuntos } from "../componentes/revision/iconos"

const SOMBRA = "0 12px 40px rgba(28, 27, 23, 0.06)"
const BORDE = "borde"
const HOVER_FILA = "rgba(245, 203, 92, 0.45)"

const itemMenu = {
  px: 3,
  py: 2,
  mx: 1,
  borderRadius: "12px",
  cursor: "pointer",
  color: "fg",
  _highlighted: { bg: "bg.subtle" },
} as const

const itemPeligro = {
  ...itemMenu,
  color: "estadoTexto.falla",
  _highlighted: { bg: "estado.fallaFondo", color: "estado.falla" },
} as const

type Pedido = "guardar" | "eliminar"

function alertaDe(falla: ErrorApi): string | null {
  const otras = Object.keys(falla.campos).some((clave) => clave !== "nombre" && clave !== "descripcion")
  if (otras) return falla.message
  if (falla.campos.nombre === falla.message || falla.campos.descripcion === falla.message) return null
  return falla.message
}

function ordenar(items: CategoriaItem[]): CategoriaItem[] {
  return [...items].sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }))
}

function catalogoDe(nombre: string, descripcion: string): CategoriaCatalogo {
  const texto = descripcion.trim()
  return {
    nombre: nombre.trim(),
    descripcion: texto === "" ? null : texto,
  }
}

function fraseConteo(cantidad: number): string {
  return cantidad === 1 ? "1 categoría" : `${cantidad} categorías`
}

function Descripcion({ valor }: { valor: string | null }) {
  const vacia = valor === null || valor.trim() === ""
  return (
    <Text fontSize="sm" color={vacia ? "fg.muted" : "fg"} whiteSpace="pre-wrap" overflowWrap="anywhere">
      {vacia ? "Sin descripción" : valor}
    </Text>
  )
}

function AlertaError({
  texto,
  onReintentar,
  reintentoBloqueado = false,
}: {
  texto: string
  onReintentar?: () => void
  reintentoBloqueado?: boolean
}) {
  return (
    <Alert.Root status="error">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>{texto}</Alert.Description>
        {onReintentar ? (
          <Button
            type="button"
            mt={3}
            size="sm"
            alignSelf="flex-start"
            variant="outline"
            colorPalette="gray"
            disabled={reintentoBloqueado}
            onClick={onReintentar}
          >
            Reintentar
          </Button>
        ) : null}
      </Alert.Content>
    </Alert.Root>
  )
}

function Encabezado({ children }: { children: ReactNode }) {
  return (
    <Table.ColumnHeader
      bg="transparent"
      color="fg.muted"
      fontSize="xs"
      fontWeight="medium"
      letterSpacing="0.06em"
      whiteSpace="nowrap"
      borderColor={BORDE}
      verticalAlign="middle"
      px={4}
      py={3}
    >
      {children}
    </Table.ColumnHeader>
  )
}

function Celda({ children }: { children: ReactNode }) {
  return (
    <Table.Cell borderColor={BORDE} verticalAlign="middle" px={4} py={3}>
      {children}
    </Table.Cell>
  )
}

function MenuCategoria({
  item,
  bloqueado,
  onEditar,
  onPedirBaja,
}: {
  item: CategoriaItem
  bloqueado: boolean
  onEditar: (item: CategoriaItem) => void
  onPedirBaja: (id: string) => void
}) {
  return (
    <Menu.Root positioning={{ placement: "bottom-end" }}>
      <Menu.Trigger asChild>
        <Button
          type="button"
          aria-label={`Acciones de ${item.nombre}`}
          size="sm"
          variant="ghost"
          borderRadius="full"
          flexShrink={0}
          minW={8}
          h={8}
          px={2}
          color="fg"
          disabled={bloqueado}
          _hover={{ bg: "bg.hover", color: "fg" }}
        >
          <IconoPuntos />
        </Button>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner zIndex={2000}>
          <Menu.Content
            bg="bg.panel"
            borderWidth="1px"
            borderColor="borde"
            borderRadius="16px"
            boxShadow={SOMBRA}
            minW="11rem"
            py={1}
          >
            <Menu.Item value="editar" onClick={() => onEditar(item)} css={itemMenu}>
              Editar
            </Menu.Item>
            <Menu.Item value="eliminar" onClick={() => onPedirBaja(item.id)} css={itemPeligro}>
              Eliminar
            </Menu.Item>
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  )
}

function TarjetaCategoria({
  item,
  bloqueado,
  onEditar,
  onPedirBaja,
}: {
  item: CategoriaItem
  bloqueado: boolean
  onEditar: (item: CategoriaItem) => void
  onPedirBaja: (id: string) => void
}) {
  return (
    <Card.Root
      size="sm"
      bg="bg.panel"
      borderWidth="0"
      borderRadius="20px"
      boxShadow={SOMBRA}
      _dark={{ borderWidth: "1px", borderColor: "borde" }}
    >
      <Card.Body>
        <Stack gap={3}>
          <Flex justify="space-between" gap={3} align="flex-start">
            <Text minW={0} fontWeight="medium" color="fg" overflowWrap="anywhere">
              {item.nombre}
            </Text>
            <MenuCategoria item={item} bloqueado={bloqueado} onEditar={onEditar} onPedirBaja={onPedirBaja} />
          </Flex>
          <Descripcion valor={item.descripcion} />
        </Stack>
      </Card.Body>
    </Card.Root>
  )
}

function TablaCategorias({
  items,
  bloqueado,
  onEditar,
  onPedirBaja,
}: {
  items: CategoriaItem[]
  bloqueado: boolean
  onEditar: (item: CategoriaItem) => void
  onPedirBaja: (id: string) => void
}) {
  return (
    <>
      <Stack gap={3} display={{ base: "flex", md: "none" }}>
        {items.map((item) => (
          <TarjetaCategoria
            key={item.id}
            item={item}
            bloqueado={bloqueado}
            onEditar={onEditar}
            onPedirBaja={onPedirBaja}
          />
        ))}
      </Stack>
      <Box
        display={{ base: "none", md: "block" }}
        bg="bg.panel"
        borderRadius="20px"
        boxShadow={SOMBRA}
        overflow="hidden"
        _dark={{ borderWidth: "1px", borderColor: "borde" }}
      >
        <Table.ScrollArea>
          <Table.Root size="sm" w="max-content" minW="100%">
            <Table.Header>
              <Table.Row bg="bg.panel">
                <Encabezado>Nombre</Encabezado>
                <Encabezado>Descripción</Encabezado>
                <Encabezado>
                  <Text as="span" srOnly>
                    Acciones
                  </Text>
                </Encabezado>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {items.map((item) => (
                <Table.Row
                  key={item.id}
                  bg="bg.panel"
                  _hover={{ bg: HOVER_FILA }}
                  css={{ "&:last-child td": { borderBottomWidth: 0 } }}
                >
                  <Celda>
                    <Text fontWeight="medium" color="fg" overflowWrap="anywhere">
                      {item.nombre}
                    </Text>
                  </Celda>
                  <Celda>
                    <Descripcion valor={item.descripcion} />
                  </Celda>
                  <Celda>
                    <MenuCategoria item={item} bloqueado={bloqueado} onEditar={onEditar} onPedirBaja={onPedirBaja} />
                  </Celda>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Table.ScrollArea>
      </Box>
    </>
  )
}

const botonSolido = {
  bg: "fg",
  color: "fg.sobreSolido",
  _hover: { bg: "solido.hover", color: "fg.sobreSolido" },
} as const

export function Categorias() {
  const [items, setItems] = useState<CategoriaItem[] | null>(null)
  const [cargando, setCargando] = useState(true)
  const [errorLista, setErrorLista] = useState<string | null>(null)
  const [intento, setIntento] = useState(0)
  const [busqueda, setBusqueda] = useState("")
  const [nombre, setNombre] = useState("")
  const [descripcion, setDescripcion] = useState("")
  const [errorNombre, setErrorNombre] = useState<string | null>(null)
  const [errorDescripcion, setErrorDescripcion] = useState<string | null>(null)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [formularioAbierto, setFormularioAbierto] = useState(false)
  const [bajaId, setBajaId] = useState<string | null>(null)
  const [pedido, setPedido] = useState<Pedido | null>(null)
  const vivo = useRef(true)
  const enCurso = useRef(false)
  const nombreInput = useRef<HTMLInputElement>(null)
  const alertaAccion = useRef<HTMLDivElement>(null)

  const ocupado = pedido !== null
  const botonesBloqueados = ocupado || cargando
  const cargaInicial = cargando && items === null
  const listaVacia = !cargando && errorLista === null && items !== null && items.length === 0
  const consulta = busqueda.trim().toLocaleLowerCase("es")
  const visibles =
    items === null
      ? []
      : consulta === ""
        ? items
        : items.filter((item) => {
            const texto = `${item.nombre} ${item.descripcion ?? ""}`.toLocaleLowerCase("es")
            return texto.includes(consulta)
          })
  const enBaja = items?.find((item) => item.id === bajaId) ?? null

  function limpiarFormulario() {
    setEditandoId(null)
    setNombre("")
    setDescripcion("")
    setErrorNombre(null)
    setErrorDescripcion(null)
    setErrorAccion(null)
  }

  function cerrarFormulario() {
    setFormularioAbierto(false)
  }

  function mostrarFalla(falla: unknown, respaldo: string) {
    if (!(falla instanceof ErrorApi)) {
      setErrorNombre(null)
      setErrorDescripcion(null)
      setErrorAccion(respaldo)
      return
    }
    setErrorNombre(falla.campos.nombre ?? null)
    setErrorDescripcion(falla.campos.descripcion ?? null)
    setErrorAccion(alertaDe(falla))
    if (falla.campos.nombre) nombreInput.current?.focus()
  }

  function alCambiarNombre(valor: string) {
    setNombre(valor)
    setErrorNombre(null)
    setErrorAccion(null)
  }

  function alCambiarDescripcion(valor: string) {
    setDescripcion(valor)
    setErrorDescripcion(null)
    setErrorAccion(null)
  }

  function empezarAlta() {
    if (enCurso.current || cargando) return
    setBajaId(null)
    limpiarFormulario()
    setFormularioAbierto(true)
  }

  function empezarEdicion(item: CategoriaItem) {
    if (enCurso.current || cargando) return
    setBajaId(null)
    setErrorNombre(null)
    setErrorDescripcion(null)
    setErrorAccion(null)
    setEditandoId(item.id)
    setNombre(item.nombre)
    setDescripcion(item.descripcion ?? "")
    setFormularioAbierto(true)
  }

  function alCambioFormulario(detalle: { open: boolean }) {
    if (ocupado && !detalle.open) return
    setFormularioAbierto(detalle.open)
    if (!detalle.open) limpiarFormulario()
  }

  function pedirBaja(id: string) {
    if (enCurso.current || cargando) return
    setErrorAccion(null)
    setBajaId(id)
  }

  function alCambioBaja(detalle: { open: boolean }) {
    if (pedido === "eliminar" && !detalle.open) return
    if (!detalle.open) {
      setBajaId(null)
      setErrorAccion(null)
    }
  }

  function reintentar() {
    if (cargando || enCurso.current) return
    setCargando(true)
    setErrorLista(null)
    setIntento((valor) => valor + 1)
  }

  async function alEnviar(event: FormEvent) {
    event.preventDefault()
    if (enCurso.current || cargando) return
    if (nombre.trim() === "") {
      setErrorNombre("Completá el nombre.")
      setErrorDescripcion(null)
      setErrorAccion(null)
      nombreInput.current?.focus()
      return
    }
    const cuerpo = catalogoDe(nombre, descripcion)
    const idEnEdicion = editandoId
    enCurso.current = true
    setPedido("guardar")
    setBajaId(null)
    setErrorNombre(null)
    setErrorDescripcion(null)
    setErrorAccion(null)
    try {
      if (idEnEdicion) {
        const actualizada = await cliente.actualizarCategoria(idEnEdicion, cuerpo)
        if (!vivo.current) return
        setItems((actual) => {
          if (!actual) return [actualizada]
          let encontrado = false
          const siguientes = actual.map((item) => {
            if (item.id !== idEnEdicion) return item
            encontrado = true
            return actualizada
          })
          return ordenar(encontrado ? siguientes : [...siguientes, actualizada])
        })
        setErrorLista(null)
        cerrarFormulario()
      } else {
        const creada = await cliente.crearCategoria(cuerpo)
        if (!vivo.current) return
        setItems((actual) => ordenar(actual ? [...actual, creada] : [creada]))
        setErrorLista(null)
        cerrarFormulario()
      }
    } catch (falla: unknown) {
      if (!vivo.current) return
      mostrarFalla(falla, idEnEdicion ? "No se pudo guardar la categoría." : "No se pudo agregar la categoría.")
    } finally {
      enCurso.current = false
      if (vivo.current) setPedido(null)
    }
  }

  async function confirmarBaja(id: string) {
    if (enCurso.current || cargando) return
    const editabaEsa = editandoId === id
    enCurso.current = true
    setPedido("eliminar")
    setErrorNombre(null)
    setErrorDescripcion(null)
    setErrorAccion(null)
    try {
      await cliente.eliminarCategoria(id)
      if (!vivo.current) return
      setItems((actual) => (actual ? actual.filter((item) => item.id !== id) : actual))
      setBajaId((actual) => (actual === id ? null : actual))
      setErrorLista(null)
      if (editabaEsa) cerrarFormulario()
    } catch (falla: unknown) {
      if (!vivo.current) return
      mostrarFalla(falla, "No se pudo eliminar la categoría.")
    } finally {
      enCurso.current = false
      if (vivo.current) setPedido(null)
    }
  }

  useEffect(() => {
    vivo.current = true
    return () => {
      vivo.current = false
    }
  }, [])

  useEffect(() => {
    if (!errorAccion) return
    alertaAccion.current?.scrollIntoView({ block: "nearest" })
  }, [errorAccion])

  useEffect(() => {
    if (!formularioAbierto) return
    const id = window.setTimeout(() => nombreInput.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [formularioAbierto, editandoId])

  useEffect(() => {
    const ctrl = new AbortController()
    setCargando(true)
    cliente
      .listarCategorias(ctrl.signal)
      .then((lista) => {
        setItems(lista.items)
        setErrorLista(null)
      })
      .catch((falla: unknown) => {
        if (esAbort(falla)) return
        setItems(null)
        setErrorLista(falla instanceof ErrorApi ? falla.message : "No se pudieron cargar las categorías.")
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setCargando(false)
      })
    return () => ctrl.abort()
  }, [intento])

  return (
    <Stack gap={{ base: 6, md: 8 }}>
      <Flex justify="space-between" align={{ base: "stretch", md: "flex-end" }} gap={4} wrap="wrap">
        <Stack gap={2} flex="1" minW={0}>
          <Heading
            as="h1"
            color="fg"
            fontSize={{ base: "2rem", md: "2.5rem" }}
            fontWeight="medium"
            letterSpacing="-0.03em"
            lineHeight="1.1"
          >
            Categorías
          </Heading>
          <Text fontSize="sm" color="fg.muted" maxW="40rem">
            El listado es el catálogo. El alta y la edición van aparte, y al revisar un gasto podés asignar una de
            estas categorías.
          </Text>
        </Stack>
        <Button
          type="button"
          alignSelf={{ base: "flex-start", md: "flex-end" }}
          borderRadius="full"
          disabled={botonesBloqueados}
          onClick={empezarAlta}
          css={botonSolido}
        >
          Nueva categoría
        </Button>
      </Flex>

      {errorLista !== null ? (
        <AlertaError texto={errorLista} onReintentar={reintentar} reintentoBloqueado={botonesBloqueados} />
      ) : null}

      {cargaInicial ? (
        <Stack gap={4}>
          <Flex justify="space-between" align="baseline" gap={3}>
            <Hueso alto="1.15rem" ancho="6rem" />
            <Hueso alto="0.85rem" ancho="5rem" />
          </Flex>
          <Hueso alto="2.5rem" radio="16px" />
          <EsqueletoTabla etiqueta="Cargando categorías" filas={5} columnas={3} />
        </Stack>
      ) : null}

      {listaVacia ? (
        <EmptyState.Root>
          <EmptyState.Content>
            <EmptyState.Title>Todavía no hay categorías</EmptyState.Title>
            <EmptyState.Description>Creá la primera para asignarla a un gasto.</EmptyState.Description>
          </EmptyState.Content>
        </EmptyState.Root>
      ) : null}

      {items !== null && items.length > 0 ? (
        <Stack gap={4}>
          <Flex justify="space-between" align="baseline" gap={3} wrap="wrap">
            <Heading as="h2" fontSize="lg" fontWeight="medium" color="fg">
              Listado
            </Heading>
            <Text fontSize="sm" color="fg.muted">
              {consulta === "" ? fraseConteo(items.length) : `${visibles.length} de ${fraseConteo(items.length)}`}
            </Text>
          </Flex>
          <Input
            aria-label="Buscar categorías"
            placeholder="Buscar por nombre o descripción"
            value={busqueda}
            bg="bg.panel"
            onChange={(event) => setBusqueda(event.target.value)}
          />
          {visibles.length === 0 ? (
            <Text fontSize="sm" color="fg.muted">
              Ninguna categoría coincide con la búsqueda.
            </Text>
          ) : (
            <TablaCategorias
              items={visibles}
              bloqueado={botonesBloqueados}
              onEditar={empezarEdicion}
              onPedirBaja={pedirBaja}
            />
          )}
        </Stack>
      ) : null}

      <Dialog.Root
        open={formularioAbierto}
        onOpenChange={alCambioFormulario}
        closeOnEscape={!ocupado}
        closeOnInteractOutside={!ocupado}
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
              maxW="32rem"
              _dark={{ borderWidth: "1px", borderColor: "borde" }}
            >
              <Dialog.Header>
                <Dialog.Title fontWeight="500" fontSize="1.5rem" letterSpacing="-0.03em" color="fg">
                  {editandoId ? "Editar categoría" : "Nueva categoría"}
                </Dialog.Title>
              </Dialog.Header>
              <form
                noValidate
                aria-label={editandoId ? "Editar categoría" : "Nueva categoría"}
                onSubmit={(event) => void alEnviar(event)}
              >
                <Dialog.Body>
                  <Stack gap={4}>
                    <Dialog.Description color="fg.muted">
                      El nombre es el que vas a ver al asignarla a un gasto.
                    </Dialog.Description>
                    {errorAccion && formularioAbierto ? (
                      <div ref={alertaAccion}>
                        <AlertaError texto={errorAccion} />
                      </div>
                    ) : null}
                    <Field.Root required invalid={Boolean(errorNombre)} disabled={ocupado}>
                      <Field.Label color="fg">Nombre</Field.Label>
                      <Input
                        ref={nombreInput}
                        name="nombre"
                        autoComplete="off"
                        maxLength={80}
                        value={nombre}
                        disabled={ocupado}
                        onChange={(event) => alCambiarNombre(event.target.value)}
                      />
                      {errorNombre ? <Field.ErrorText color="estadoTexto.falla">{errorNombre}</Field.ErrorText> : null}
                    </Field.Root>
                    <Field.Root invalid={Boolean(errorDescripcion)} disabled={ocupado}>
                      <Field.Label color="fg">Descripción</Field.Label>
                      <Textarea
                        name="descripcion"
                        autoComplete="off"
                        rows={3}
                        maxLength={280}
                        resize="vertical"
                        value={descripcion}
                        disabled={ocupado}
                        onChange={(event) => alCambiarDescripcion(event.target.value)}
                      />
                      <Field.HelperText color="fg.muted">Opcional.</Field.HelperText>
                      {errorDescripcion ? (
                        <Field.ErrorText color="estadoTexto.falla">{errorDescripcion}</Field.ErrorText>
                      ) : null}
                    </Field.Root>
                  </Stack>
                </Dialog.Body>
                <Dialog.Footer gap={3}>
                  <Dialog.ActionTrigger asChild>
                    <Button type="button" variant="ghost" borderRadius="full" color="fg" disabled={ocupado}>
                      Cancelar
                    </Button>
                  </Dialog.ActionTrigger>
                  <Button type="submit" borderRadius="full" loading={pedido === "guardar"} disabled={ocupado && pedido !== "guardar"} css={botonSolido}>
                    {editandoId ? "Guardar" : "Agregar"}
                  </Button>
                </Dialog.Footer>
              </form>
              <Dialog.CloseTrigger asChild>
                <CloseButton aria-label="Cerrar" color="fg" disabled={ocupado} />
              </Dialog.CloseTrigger>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

      <Dialog.Root
        role="alertdialog"
        open={bajaId !== null}
        onOpenChange={alCambioBaja}
        closeOnEscape={pedido !== "eliminar"}
        closeOnInteractOutside={pedido !== "eliminar"}
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
                  Eliminar categoría
                </Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>
                <Stack gap={4}>
                  <Dialog.Description color="fg.muted">
                    {enBaja ? (
                      <>
                        ¿Eliminar{" "}
                        <Text as="span" fontWeight="medium" color="fg" overflowWrap="anywhere">
                          {enBaja.nombre}
                        </Text>
                        ? Los gastos que ya la tienen asignada conservan ese nombre.
                      </>
                    ) : (
                      "¿Eliminar esta categoría? Los gastos que ya la tienen asignada conservan ese nombre."
                    )}
                  </Dialog.Description>
                  {errorAccion && bajaId !== null ? (
                    <div ref={alertaAccion}>
                      <AlertaError texto={errorAccion} />
                    </div>
                  ) : null}
                </Stack>
              </Dialog.Body>
              <Dialog.Footer gap={3}>
                <Button
                  type="button"
                  variant="ghost"
                  borderRadius="full"
                  color="fg"
                  disabled={pedido === "eliminar"}
                  onClick={() => alCambioBaja({ open: false })}
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  borderRadius="full"
                  loading={pedido === "eliminar"}
                  disabled={!bajaId || (ocupado && pedido !== "eliminar")}
                  aria-label={enBaja ? `Confirmar eliminación de ${enBaja.nombre}` : "Confirmar eliminación"}
                  onClick={() => {
                    if (bajaId) void confirmarBaja(bajaId)
                  }}
                  css={botonSolido}
                >
                  Eliminar
                </Button>
              </Dialog.Footer>
              <Dialog.CloseTrigger asChild>
                <CloseButton aria-label="Cerrar" color="fg" disabled={pedido === "eliminar"} />
              </Dialog.CloseTrigger>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </Stack>
  )
}
