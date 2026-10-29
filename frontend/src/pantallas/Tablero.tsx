import { Alert, Button, Card, CloseButton, Drawer, EmptyState, Flex, Grid, Heading, Portal, Stack, Text } from "@chakra-ui/react"
import { useState, type ReactNode } from "react"
import { Link } from "react-router"
import { GraficoCategorias, GraficoMeses } from "../componentes/GraficosResumen"
import { FiltrosTablero } from "../componentes/tablero/FiltrosTablero"
import { ListaConfirmados } from "../componentes/tablero/ListaConfirmados"
import { PanelBorradores } from "../componentes/tablero/PanelBorradores"
import { ResumenCifras, sumarMontos } from "../componentes/tablero/ResumenCifras"
import { EsqueletoGrafico, EsqueletoTabla } from "../componentes/esqueleto"
import { useTablero } from "../datos/useTablero"
import { useHogar } from "../hogar"
import { useSesion } from "../sesion"

const SOMBRA = "0 12px 40px rgba(28, 27, 23, 0.06)"

function saludoDe(email: string | null, nombre: string | null): string {
  const alias = nombre?.trim() ?? ""
  if (alias) return `Hola, ${alias}`
  const local = email?.split("@")[0]?.trim() ?? ""
  return local ? `Hola, ${local}` : "Hola"
}

function totalGastado(totales: readonly string[]): string | null {
  if (totales.length === 0) return "0.00"
  return sumarMontos(totales)
}

function Tarjeta({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <Card.Root
      h="100%"
      bg="bg.panel"
      borderWidth="0"
      borderRadius="20px"
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

function PasosIniciales() {
  const { rol } = useHogar()
  const conChat = rol !== "asociado"
  return (
    <Card.Root
      bg="bg.panel"
      borderWidth="0"
      borderRadius="20px"
      boxShadow={SOMBRA}
      _dark={{ borderWidth: "1px", borderColor: "borde" }}
    >
      <Card.Header>
        <Card.Title as="h2" fontWeight="medium" color="fg" letterSpacing="-0.03em">
          {conChat ? "Tres pasos" : "Dos pasos"}
        </Card.Title>
        <Card.Description>Para tener comprobantes en este período.</Card.Description>
      </Card.Header>
      <Card.Body>
        <Stack gap={3}>
          <Flex gap={3} align="center">
            <Text fontWeight="medium">1.</Text>
            <Button asChild size="sm" variant="outline">
              <Link to="/cargar">Cargar un comprobante</Link>
            </Button>
          </Flex>
          <Flex gap={3} align="center">
            <Text fontWeight="medium">2.</Text>
            <Text>Revisarlo y confirmarlo</Text>
          </Flex>
          {conChat ? (
            <Flex gap={3} align="center">
              <Text fontWeight="medium">3.</Text>
              <Button asChild size="sm" variant="outline">
                <Link to="/chat">Preguntar en el chat</Link>
              </Button>
            </Flex>
          ) : null}
        </Stack>
      </Card.Body>
    </Card.Root>
  )
}

function IconoFiltro() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 16 16" fill="none">
      <path
        d="M2.25 3.25h11.5L9.4 8.15v4.1L6.6 13.5V8.15L2.25 3.25Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function VacioFiltros({ todo, onLimpiar }: { todo: boolean; onLimpiar: () => void }) {
  return (
    <EmptyState.Root>
      <EmptyState.Content>
        <EmptyState.Title>
          {todo ? "Nada coincide con los filtros" : "Ningún comprobante coincide con los filtros"}
        </EmptyState.Title>
        <EmptyState.Description>Probá con otro rango, categoría o moneda.</EmptyState.Description>
        <Button type="button" mt={3} size="sm" onClick={onLimpiar}>
          Limpiar filtros
        </Button>
      </EmptyState.Content>
    </EmptyState.Root>
  )
}

function AlertaError({ titulo, detalle, alReintentar }: { titulo?: string; detalle: string; alReintentar: () => void }) {
  return (
    <Alert.Root status="error">
      <Alert.Indicator />
      <Alert.Content>
        {titulo ? <Alert.Title>{titulo}</Alert.Title> : null}
        <Alert.Description>{detalle}</Alert.Description>
        <Button
          type="button"
          mt={3}
          size="sm"
          alignSelf="flex-start"
          variant="outline"
          colorPalette="gray"
          onClick={alReintentar}
        >
          Reintentar
        </Button>
      </Alert.Content>
    </Alert.Root>
  )
}

export function Tablero() {
  const { email, nombre } = useSesion()
  const {
    periodo,
    resumen,
    cargandoResumen,
    errorResumen,
    borradores,
    cargandoDocs,
    errorDocs,
    reintentar,
    descartarBorrador,
    descartando,
    mostrarPasos,
    filtros,
    setFiltro,
    limpiar,
    rangoInvalido,
    filtrosDistintos,
    monedas,
    monedasPendientes,
    sinCoincidencias,
    vistaFiltrada,
  } = useTablero()
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false)

  const resumenVisible = !errorResumen && !cargandoResumen ? resumen : null
  const etiquetaFiltros = filtrosDistintos > 0 ? `Filtros, ${filtrosDistintos} activos` : "Filtros"
  const propsFiltros = {
    filtros,
    monedas,
    rangoInvalido,
    monedasPendientes,
    puedeLimpiar: filtrosDistintos > 0,
    onCambio: setFiltro,
    onLimpiar: limpiar,
  }

  return (
    <Drawer.Root
      placement="end"
      open={filtrosAbiertos}
      onOpenChange={(detalle) => setFiltrosAbiertos(detalle.open)}
    >
    <Stack gap={{ base: 6, md: 8 }}>
      <ResumenCifras
        saludo={saludoDe(email, nombre)}
        etiquetaPeriodo={periodo.etiqueta}
        total={resumenVisible ? totalGastado(resumenVisible.por_mes.map((mes) => mes.total)) : null}
        confirmados={resumenVisible ? resumenVisible.comprobantes.length : null}
        borradores={borradores ? borradores.length : null}
        categorias={resumenVisible ? resumenVisible.por_categoria.length : null}
        cargando={cargandoResumen}
        complemento={
          <Drawer.Trigger asChild>
            <Button
              type="button"
              variant="ghost"
              borderRadius="full"
              color="fg"
              aria-label={etiquetaFiltros}
              aria-expanded={filtrosAbiertos}
              flexShrink={0}
              mt={1}
              px={3}
              position="relative"
              _hover={{ bg: "bg.hover", color: "fg" }}
            >
              <IconoFiltro />
              {filtrosDistintos > 0 ? (
                <Flex
                  aria-hidden="true"
                  position="absolute"
                  top="1"
                  right="1"
                  minW="16px"
                  h="16px"
                  px="1"
                  align="center"
                  justify="center"
                  borderRadius="full"
                  bg="marca.sol"
                  color="marca.carbon"
                  fontSize="10px"
                  fontWeight="medium"
                  lineHeight="1"
                >
                  {filtrosDistintos > 9 ? "9+" : filtrosDistintos}
                </Flex>
              ) : null}
            </Button>
          </Drawer.Trigger>
        }
      />

      {errorResumen ? (
        <AlertaError titulo="No se pudo leer el resumen" detalle={errorResumen} alReintentar={reintentar} />
      ) : null}

      {errorDocs ? <AlertaError detalle={errorDocs} alReintentar={reintentar} /> : null}

      {sinCoincidencias ? (
        <VacioFiltros todo onLimpiar={limpiar} />
      ) : (
        <>
          {mostrarPasos ? <PasosIniciales /> : null}

          {!mostrarPasos && (cargandoResumen || resumenVisible) ? (
            <Grid templateColumns={{ base: "1fr", lg: "repeat(2, minmax(0, 1fr))" }} gap={{ base: 4, lg: 5 }}>
              {cargandoResumen ? (
                <>
                  <Tarjeta titulo="Total por mes">
                    <EsqueletoGrafico variante="barras" />
                  </Tarjeta>
                  <Tarjeta titulo="Total por categoría">
                    <EsqueletoGrafico variante="torta" />
                  </Tarjeta>
                </>
              ) : resumenVisible ? (
                <>
                  <Tarjeta titulo="Total por mes">
                    <GraficoMeses porMes={resumenVisible.por_mes} />
                  </Tarjeta>
                  <Tarjeta titulo="Total por categoría">
                    <GraficoCategorias porCategoria={resumenVisible.por_categoria} />
                  </Tarjeta>
                </>
              ) : null}
            </Grid>
          ) : null}

          {!mostrarPasos && !errorResumen ? (
            <Stack gap={3}>
              <Heading as="h2" size="lg" fontWeight="medium" color="fg" letterSpacing="-0.03em">
                Confirmados en el período
              </Heading>
              {cargandoResumen ? (
                <EsqueletoTabla etiqueta="Cargando comprobantes" filas={4} columnas={5} />
              ) : resumenVisible && resumenVisible.comprobantes.length > 0 ? (
                <ListaConfirmados items={resumenVisible.comprobantes} accion="Ver" />
              ) : vistaFiltrada ? (
                <VacioFiltros todo={false} onLimpiar={limpiar} />
              ) : (
                <EmptyState.Root>
                  <EmptyState.Content>
                    <EmptyState.Title>Todavía no hay comprobantes confirmados</EmptyState.Title>
                    <EmptyState.Description>
                      El monto entra a esta lista y a los gráficos recién cuando confirmás el borrador.
                    </EmptyState.Description>
                    <Button asChild mt={3} size="sm">
                      <Link to="/cargar">Cargar un comprobante</Link>
                    </Button>
                  </EmptyState.Content>
                </EmptyState.Root>
              )}
            </Stack>
          ) : null}
        </>
      )}

      <PanelBorradores
        borradores={borradores}
        cargando={cargandoDocs}
        hayError={errorDocs !== null}
        descartando={descartando}
        alDescartar={descartarBorrador}
      />
    </Stack>
    <Portal>
      <Drawer.Backdrop />
      <Drawer.Positioner>
        <Drawer.Content
          bg="bg.subtle"
          color="fg"
          w="20rem"
          maxW="calc(100vw - 2rem)"
          h="100dvh"
          borderTopLeftRadius="l3"
          borderBottomLeftRadius="l3"
          overflow="hidden"
        >
          <Drawer.Header>
            <Drawer.Title fontWeight="medium" letterSpacing="-0.03em">
              Filtros
            </Drawer.Title>
          </Drawer.Header>
          <Drawer.Body>
            {filtrosAbiertos ? <FiltrosTablero {...propsFiltros} /> : null}
          </Drawer.Body>
          <Drawer.CloseTrigger asChild>
            <CloseButton aria-label="Cerrar" color="fg" />
          </Drawer.CloseTrigger>
        </Drawer.Content>
      </Drawer.Positioner>
    </Portal>
    </Drawer.Root>
  )
}
