import { useEffect, useState } from "react"
import { Alert, Button, EmptyState, Flex, Heading, Pagination, Skeleton, Stack, Text } from "@chakra-ui/react"
import { Link } from "react-router"
import { FiltrosRegistros } from "../componentes/FiltrosRegistros"
import { TablaRegistros } from "../componentes/TablaRegistros"
import { descargarRegistrosExcel } from "../datos/exportarRegistros"
import { useRegistros } from "../datos/useRegistros"

const TAMANO_PAGINA = 10

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
  } = useRegistros()
  const [pagina, setPagina] = useState(1)

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

      {rangoInvalido === null && enPagina.length > 0 ? <TablaRegistros items={enPagina} /> : null}

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
