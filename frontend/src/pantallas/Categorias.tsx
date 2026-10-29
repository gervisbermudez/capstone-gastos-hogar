import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import {
  Alert,
  Box,
  Button,
  Card,
  EmptyState,
  Field,
  Flex,
  Heading,
  Input,
  Skeleton,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react"
import { ErrorApi, cliente, esAbort } from "../api/cliente"
import type { CategoriaCatalogo, CategoriaItem } from "../api/tipos"

const SOMBRA = "0 12px 40px rgba(28, 27, 23, 0.06)"
const BORDE = "borde"
const HOVER_FILA = "rgba(245, 203, 92, 0.45)"

type Pedido = "guardar" | "eliminar"

type Manejadores = {
  onEditar: (item: CategoriaItem) => void
  onPedirBaja: (id: string) => void
  onConfirmarBaja: (id: string) => void
  onCancelarBaja: () => void
}

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

function Encabezado({ children }: { children: string }) {
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

function Acciones({
  item,
  confirmando,
  bloqueado,
  eliminando,
  onEditar,
  onPedirBaja,
  onConfirmarBaja,
  onCancelarBaja,
}: Manejadores & {
  item: CategoriaItem
  confirmando: boolean
  bloqueado: boolean
  eliminando: boolean
}) {
  if (confirmando) {
    return (
      <Stack gap={2} align="flex-start">
        <Text fontSize="sm" color="fg.muted">
          ¿Eliminar esta categoría?
        </Text>
        <Flex gap={2} wrap="wrap">
          <Button
            type="button"
            size="sm"
            borderRadius="full"
            loading={eliminando}
            disabled={bloqueado && !eliminando}
            aria-label={`Confirmar eliminación de ${item.nombre}`}
            onClick={() => void onConfirmarBaja(item.id)}
            css={{
              bg: "fg",
              color: "fg.sobreSolido",
              _hover: { bg: "solido.hover", color: "fg.sobreSolido" },
            }}
          >
            Confirmar
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            borderRadius="full"
            color="fg"
            disabled={bloqueado}
            aria-label={`Cancelar eliminación de ${item.nombre}`}
            onClick={onCancelarBaja}
          >
            Cancelar
          </Button>
        </Flex>
      </Stack>
    )
  }

  return (
    <Flex gap={2} wrap="wrap">
      <Button
        type="button"
        size="sm"
        variant="outline"
        borderRadius="full"
        color="fg"
        disabled={bloqueado}
        aria-label={`Editar ${item.nombre}`}
        onClick={() => onEditar(item)}
      >
        Editar
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        borderRadius="full"
        disabled={bloqueado}
        aria-label={`Eliminar ${item.nombre}`}
        onClick={() => onPedirBaja(item.id)}
        css={{
          color: "estadoTexto.falla",
          borderColor: "estadoTexto.falla",
          _hover: { bg: "estado.fallaFondo", color: "estado.falla" },
        }}
      >
        Eliminar
      </Button>
    </Flex>
  )
}

function TarjetaCategoria({
  item,
  editando,
  ...acciones
}: Manejadores & {
  item: CategoriaItem
  editando: boolean
  confirmando: boolean
  bloqueado: boolean
  eliminando: boolean
}) {
  return (
    <Card.Root
      size="sm"
      bg={editando ? "bg.subtle" : "bg.panel"}
      borderWidth="0"
      borderRadius="20px"
      boxShadow={SOMBRA}
      _dark={{ borderWidth: "1px", borderColor: "borde" }}
    >
      <Card.Body>
        <Stack gap={3}>
          <Text fontWeight="medium" color="fg" overflowWrap="anywhere">
            {item.nombre}
          </Text>
          <Descripcion valor={item.descripcion} />
          <Acciones item={item} {...acciones} />
        </Stack>
      </Card.Body>
    </Card.Root>
  )
}

function TablaCategorias({
  items,
  editandoId,
  confirmandoId,
  bloqueado,
  eliminando,
  ...manejadores
}: Manejadores & {
  items: CategoriaItem[]
  editandoId: string | null
  confirmandoId: string | null
  bloqueado: boolean
  eliminando: boolean
}) {
  return (
    <>
      <Stack gap={3} display={{ base: "flex", md: "none" }}>
        {items.map((item) => (
          <TarjetaCategoria
            key={item.id}
            item={item}
            editando={editandoId === item.id}
            confirmando={confirmandoId === item.id}
            bloqueado={bloqueado}
            eliminando={eliminando && confirmandoId === item.id}
            {...manejadores}
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
                <Encabezado>Acciones</Encabezado>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {items.map((item) => {
                const editando = editandoId === item.id
                return (
                  <Table.Row
                    key={item.id}
                    bg={editando ? "bg.subtle" : "bg.panel"}
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
                      <Acciones
                        item={item}
                        confirmando={confirmandoId === item.id}
                        bloqueado={bloqueado}
                        eliminando={eliminando && confirmandoId === item.id}
                        {...manejadores}
                      />
                    </Celda>
                  </Table.Row>
                )
              })}
            </Table.Body>
          </Table.Root>
        </Table.ScrollArea>
      </Box>
    </>
  )
}

export function Categorias() {
  const [items, setItems] = useState<CategoriaItem[] | null>(null)
  const [cargando, setCargando] = useState(true)
  const [errorLista, setErrorLista] = useState<string | null>(null)
  const [intento, setIntento] = useState(0)
  const [nombre, setNombre] = useState("")
  const [descripcion, setDescripcion] = useState("")
  const [errorNombre, setErrorNombre] = useState<string | null>(null)
  const [errorDescripcion, setErrorDescripcion] = useState<string | null>(null)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null)
  const [pedido, setPedido] = useState<Pedido | null>(null)
  const vivo = useRef(true)
  const enCurso = useRef(false)
  const formulario = useRef<HTMLFormElement>(null)
  const nombreInput = useRef<HTMLInputElement>(null)
  const alertaAccion = useRef<HTMLDivElement>(null)

  const ocupado = pedido !== null
  const botonesBloqueados = ocupado || cargando
  const cargaInicial = cargando && items === null
  const listaVacia = !cargando && errorLista === null && items !== null && items.length === 0

  function volverAlta() {
    setEditandoId(null)
    setNombre("")
    setDescripcion("")
    setErrorNombre(null)
    setErrorDescripcion(null)
    setErrorAccion(null)
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

  function empezarEdicion(item: CategoriaItem) {
    if (enCurso.current || cargando) return
    setConfirmandoId(null)
    setErrorNombre(null)
    setErrorDescripcion(null)
    setErrorAccion(null)
    if (editandoId !== item.id) {
      setEditandoId(item.id)
      setNombre(item.nombre)
      setDescripcion(item.descripcion ?? "")
    }
    formulario.current?.scrollIntoView({ block: "nearest" })
    nombreInput.current?.focus()
  }

  function cancelarEdicion() {
    if (enCurso.current) return
    volverAlta()
  }

  function pedirBaja(id: string) {
    if (enCurso.current || cargando) return
    setConfirmandoId(id)
    setErrorAccion(null)
  }

  function cancelarBaja() {
    if (enCurso.current) return
    setConfirmandoId(null)
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
    setConfirmandoId(null)
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
        volverAlta()
      } else {
        const creada = await cliente.crearCategoria(cuerpo)
        if (!vivo.current) return
        setItems((actual) => ordenar(actual ? [...actual, creada] : [creada]))
        setErrorLista(null)
        volverAlta()
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
      setConfirmandoId((actual) => (actual === id ? null : actual))
      setErrorLista(null)
      if (editabaEsa) volverAlta()
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
      <Stack gap={2}>
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
        <Text fontSize="sm" color="fg.muted">
          Este catálogo no cambia las categorías de los comprobantes. Servicios, Expensas y Alquiler siguen fijas al
          confirmar.
        </Text>
      </Stack>

      <Box
        bg="bg.panel"
        borderRadius="20px"
        boxShadow={SOMBRA}
        p={{ base: 4, md: 5 }}
        _dark={{ borderWidth: "1px", borderColor: "borde" }}
      >
        <form
          ref={formulario}
          noValidate
          aria-label={editandoId ? "Editar categoría" : "Nueva categoría"}
          onSubmit={(event) => void alEnviar(event)}
        >
          <Stack gap={4}>
            <Heading as="h2" fontSize="lg" fontWeight="medium" color="fg">
              {editandoId ? "Editar categoría" : "Nueva categoría"}
            </Heading>
            {errorAccion ? (
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
                value={nombre}
                disabled={ocupado}
                onChange={(event) => alCambiarNombre(event.target.value)}
              />
              {errorNombre ? <Field.ErrorText color="estadoTexto.falla">{errorNombre}</Field.ErrorText> : null}
            </Field.Root>
            <Field.Root invalid={Boolean(errorDescripcion)} disabled={ocupado}>
              <Field.Label color="fg">Descripción</Field.Label>
              <Input
                name="descripcion"
                autoComplete="off"
                value={descripcion}
                disabled={ocupado}
                onChange={(event) => alCambiarDescripcion(event.target.value)}
              />
              <Field.HelperText color="fg.muted">Opcional.</Field.HelperText>
              {errorDescripcion ? (
                <Field.ErrorText color="estadoTexto.falla">{errorDescripcion}</Field.ErrorText>
              ) : null}
            </Field.Root>
            <Flex gap={3} wrap="wrap">
              <Button
                type="submit"
                borderRadius="full"
                loading={pedido === "guardar"}
                disabled={botonesBloqueados && pedido !== "guardar"}
                css={{
                  bg: "fg",
                  color: "fg.sobreSolido",
                  _hover: { bg: "solido.hover", color: "fg.sobreSolido" },
                }}
              >
                {editandoId ? "Guardar" : "Agregar"}
              </Button>
              {editandoId ? (
                <Button
                  type="button"
                  variant="outline"
                  borderRadius="full"
                  color="fg"
                  disabled={botonesBloqueados}
                  aria-label="Cancelar edición"
                  onClick={cancelarEdicion}
                >
                  Cancelar
                </Button>
              ) : null}
            </Flex>
          </Stack>
        </form>
      </Box>

      {errorLista !== null ? (
        <AlertaError texto={errorLista} onReintentar={reintentar} reintentoBloqueado={botonesBloqueados} />
      ) : null}

      {cargaInicial ? <Skeleton height="16rem" borderRadius="20px" /> : null}

      {listaVacia ? (
        <EmptyState.Root>
          <EmptyState.Content>
            <EmptyState.Title>Todavía no hay categorías</EmptyState.Title>
            <EmptyState.Description>Agregá la primera con el formulario.</EmptyState.Description>
          </EmptyState.Content>
        </EmptyState.Root>
      ) : null}

      {items !== null && items.length > 0 ? (
        <TablaCategorias
          items={items}
          editandoId={editandoId}
          confirmandoId={confirmandoId}
          bloqueado={botonesBloqueados}
          eliminando={pedido === "eliminar"}
          onEditar={empezarEdicion}
          onPedirBaja={pedirBaja}
          onConfirmarBaja={(id) => void confirmarBaja(id)}
          onCancelarBaja={cancelarBaja}
        />
      ) : null}
    </Stack>
  )
}
