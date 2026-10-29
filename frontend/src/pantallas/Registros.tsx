import { useEffect, useState } from "react"
import { Alert, Button, CloseButton, Dialog, EmptyState, Flex, Heading, Pagination, Portal, Skeleton, Stack, Text } from "@chakra-ui/react"
import { Link } from "react-router"
import { ErrorApi, cliente } from "../api/cliente"
import type { DocumentoListado } from "../api/tipos"
import { toaster } from "../avisos"
import { FiltrosRegistros } from "../componentes/FiltrosRegistros"
import { TablaRegistros } from "../componentes/TablaRegistros"
import { descargarRegistrosExcel } from "../datos/exportarRegistros"
import { useRegistros } from "../datos/useRegistros"

const TAMANO_PAGINA = 10

const botonSolido = {
  bg: "fg",
  color: "fg.sobreSolido",
  _hover: { bg: "solido.hover", color: "fg.sobreSolido" },
} as const

type Pedido = {
  tipo: "anular" | "eliminar"
  item: DocumentoListado
}

function nombreDe(item: DocumentoListado): string {
  return item.campos.proveedor?.trim() ?? ""
}

function DialogoAccion({
  pedido,
  ocupado,
  error,
  onCerrar,
  onConfirmar,
}: {
  pedido: Pedido | null
  ocupado: boolean
  error: string | null
  onCerrar: () => void
  onConfirmar: () => void
}) {
  const anular = pedido?.tipo === "anular"
  const nombre = pedido ? nombreDe(pedido.item) : ""
  return (
    <Dialog.Root
      role="alertdialog"
      open={pedido !== null}
      onOpenChange={(detalle) => {
        if (!detalle.open) onCerrar()
      }}
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
            maxW="28rem"
            _dark={{ borderWidth: "1px", borderColor: "borde" }}
          >
            <Dialog.Header>
              <Dialog.Title fontWeight="500" fontSize="1.5rem" letterSpacing="-0.03em" color="fg">
                {anular ? "Anular comprobante" : "Eliminar comprobante"}
              </Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <Stack gap={4}>
                <Dialog.Description color="fg.muted">
                  {anular ? (
                    nombre ? (
                      <>
                        ¿Anulás el comprobante de{" "}
                        <Text as="span" fontWeight="medium" color="fg" overflowWrap="anywhere">
                          {nombre}
                        </Text>
                        ? Sale del resumen y de las consultas.
                      </>
                    ) : (
                      "¿Anulás este comprobante? Sale del resumen y de las consultas."
                    )
                  ) : nombre ? (
                    <>
                      ¿Eliminás el comprobante de{" "}
                      <Text as="span" fontWeight="medium" color="fg" overflowWrap="anywhere">
                        {nombre}
                      </Text>
                      ? Se borra el archivo y no se puede deshacer.
                    </>
                  ) : (
                    "¿Eliminás este comprobante? Se borra el archivo y no se puede deshacer."
                  )}
                </Dialog.Description>
                {error ? (
                  <Alert.Root status="error">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Description>{error}</Alert.Description>
                    </Alert.Content>
                  </Alert.Root>
                ) : null}
              </Stack>
            </Dialog.Body>
            <Dialog.Footer gap={3}>
              <Button type="button" variant="ghost" borderRadius="full" color="fg" disabled={ocupado} onClick={onCerrar}>
                Cancelar
              </Button>
              <Button
                type="button"
                borderRadius="full"
                loading={ocupado}
                disabled={ocupado || pedido === null}
                aria-label={
                  anular
                    ? nombre
                      ? `Confirmar anulación de ${nombre}`
                      : "Confirmar anulación"
                    : nombre
                      ? `Confirmar eliminación de ${nombre}`
                      : "Confirmar eliminación"
                }
                onClick={onConfirmar}
                css={botonSolido}
              >
                {anular ? "Anular" : "Eliminar"}
              </Button>
            </Dialog.Footer>
            <Dialog.CloseTrigger asChild>
              <CloseButton aria-label="Cerrar" color="fg" disabled={ocupado} />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}

function fraseConteo(visibles: number, total: number): string {
  if (visibles === total) {
    return total === 1 ? "1 comprobante." : `${total} comprobantes.`
  }
  return `${visibles} de ${total} comprobantes.`
}

export function Registros() {
  const {
    filtros,
    setFiltro,
    limpiar,
    rangoInvalido,
    items,
    visibles,
    monedas,
    cargando,
    error,
    reintentar,
    actualizarItem,
  } = useRegistros()
  const [pagina, setPagina] = useState(1)
  const [pedido, setPedido] = useState<Pedido | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [errorAccion, setErrorAccion] = useState<string | null>(null)

  useEffect(() => {
    setPagina(1)
  }, [filtros])

  const cargaInicial = cargando && items === null
  const hayItems = items !== null && items.length > 0
  const totalPaginas = Math.max(1, Math.ceil(visibles.length / TAMANO_PAGINA))
  const paginaSegura = Math.min(pagina, totalPaginas)
  const inicio = (paginaSegura - 1) * TAMANO_PAGINA
  const enPagina = visibles.slice(inicio, inicio + TAMANO_PAGINA)
  const mostrarPaginacion = rangoInvalido === null && visibles.length > TAMANO_PAGINA

  function abrirAccion(tipo: Pedido["tipo"], item: DocumentoListado) {
    if (ocupado) return
    if (tipo === "anular" && (item.estado !== "confirmado" || item.anulado === true)) return
    setErrorAccion(null)
    setPedido({ tipo, item })
  }

  function cerrarAccion() {
    if (ocupado) return
    setPedido(null)
    setErrorAccion(null)
  }

  async function confirmarAccion() {
    if (!pedido || ocupado) return
    setOcupado(true)
    setErrorAccion(null)
    try {
      if (pedido.tipo === "anular") {
        const actualizado = await cliente.anular(pedido.item.id)
        actualizarItem(pedido.item.id, {
          estado: actualizado.estado,
          campos: actualizado.campos,
          anulado: actualizado.anulado,
          indexado: actualizado.indexado,
          cambios: actualizado.cambios,
        })
        toaster.create({ title: "Comprobante anulado", type: "success" })
      } else {
        await cliente.eliminar(pedido.item.id)
        actualizarItem(pedido.item.id, null)
        toaster.create({ title: "Comprobante eliminado", type: "success" })
      }
      setPedido(null)
    } catch (falla) {
      setErrorAccion(
        falla instanceof ErrorApi
          ? falla.message
          : pedido.tipo === "anular"
            ? "No se pudo anular el comprobante."
            : "No se pudo eliminar el comprobante.",
      )
    } finally {
      setOcupado(false)
    }
  }

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
          Registros
        </Heading>
        <Text fontSize="sm" color="fg.muted">
          Todos los comprobantes cargados, borradores y confirmados.
        </Text>
        {items !== null ? (
          <Text fontSize="sm" fontWeight="medium" color="fg">
            {rangoInvalido ? fraseConteo(items.length, items.length) : fraseConteo(visibles.length, items.length)}
          </Text>
        ) : null}
      </Stack>

      <FiltrosRegistros
        filtros={filtros}
        monedas={monedas}
        rangoInvalido={rangoInvalido}
        puedeDescargar={rangoInvalido === null && visibles.length > 0}
        onCambio={setFiltro}
        onLimpiar={limpiar}
        onDescargar={() => descargarRegistrosExcel(visibles)}
      />

      {error !== null ? (
        <Alert.Root status="error">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{error}</Alert.Description>
            <Button
              type="button"
              mt={3}
              size="sm"
              alignSelf="flex-start"
              variant="outline"
              colorPalette="gray"
              onClick={reintentar}
            >
              Reintentar
            </Button>
          </Alert.Content>
        </Alert.Root>
      ) : null}

      {cargaInicial ? <Skeleton height="16rem" borderRadius="20px" /> : null}

      {error === null && !cargaInicial && items !== null && items.length === 0 ? (
        <EmptyState.Root>
          <EmptyState.Content>
            <EmptyState.Title>Todavía no hay comprobantes</EmptyState.Title>
            <EmptyState.Description>Cuando cargues uno, aparece en esta tabla.</EmptyState.Description>
            <Button
              asChild
              mt={3}
              size="sm"
              css={{
                bg: "fg",
                color: "fg.sobreSolido",
                _hover: { bg: "solido.hover", color: "fg.sobreSolido" },
              }}
            >
              <Link to="/cargar">Cargar un comprobante</Link>
            </Button>
          </EmptyState.Content>
        </EmptyState.Root>
      ) : null}

      {hayItems && rangoInvalido === null && visibles.length === 0 ? (
        <EmptyState.Root>
          <EmptyState.Content>
            <EmptyState.Title>Ningún comprobante coincide</EmptyState.Title>
            <EmptyState.Description>Probá otro período o texto.</EmptyState.Description>
          </EmptyState.Content>
        </EmptyState.Root>
      ) : null}

      {rangoInvalido === null && enPagina.length > 0 ? (
        <TablaRegistros
          items={enPagina}
          bloqueadoId={ocupado && pedido ? pedido.item.id : null}
          onAnular={(item) => abrirAccion("anular", item)}
          onEliminar={(item) => abrirAccion("eliminar", item)}
        />
      ) : null}

      <DialogoAccion
        pedido={pedido}
        ocupado={ocupado}
        error={errorAccion}
        onCerrar={cerrarAccion}
        onConfirmar={() => void confirmarAccion()}
      />

      {mostrarPaginacion ? (
        <Pagination.Root
          count={visibles.length}
          pageSize={TAMANO_PAGINA}
          page={paginaSegura}
          onPageChange={(detalle) => setPagina(detalle.page)}
        >
          <Flex gap={2} align="center" wrap="wrap">
            <Pagination.PrevTrigger asChild>
              <Button type="button" size="sm" variant="outline" borderRadius="full" color="fg">
                Anterior
              </Button>
            </Pagination.PrevTrigger>
            <Pagination.Items
              render={(item) => (
                <Pagination.Item key={item.value} type="page" value={item.value} asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    borderRadius="full"
                    color="fg"
                    css={{ "&[data-selected]": { bg: "fg", color: "fg.sobreSolido" } }}
                  >
                    {item.value}
                  </Button>
                </Pagination.Item>
              )}
            />
            <Pagination.NextTrigger asChild>
              <Button type="button" size="sm" variant="outline" borderRadius="full" color="fg">
                Siguiente
              </Button>
            </Pagination.NextTrigger>
          </Flex>
        </Pagination.Root>
      ) : null}
    </Stack>
  )
}
