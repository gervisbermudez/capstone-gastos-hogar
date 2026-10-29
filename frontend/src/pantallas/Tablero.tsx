import { Alert, Button, Card, EmptyState, Flex, Grid, Heading, Stack, Text } from "@chakra-ui/react"
import type { ReactNode } from "react"
import { Link } from "react-router"
import { GraficoCategorias, GraficoMeses } from "../componentes/GraficosResumen"
import { ListaConfirmados } from "../componentes/tablero/ListaConfirmados"
import { PanelBorradores } from "../componentes/tablero/PanelBorradores"
import { ResumenCifras, sumarMontos } from "../componentes/tablero/ResumenCifras"
import { EsqueletoGrafico, EsqueletoTabla } from "../componentes/esqueleto"
import { useTablero } from "../datos/useTablero"
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
          Tres pasos
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
          <Flex gap={3} align="center">
            <Text fontWeight="medium">3.</Text>
            <Button asChild size="sm" variant="outline">
              <Link to="/chat">Preguntar en el chat</Link>
            </Button>
          </Flex>
        </Stack>
      </Card.Body>
    </Card.Root>
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
  } = useTablero()

  const resumenVisible = !errorResumen && !cargandoResumen ? resumen : null

  return (
    <Stack gap={{ base: 6, md: 8 }}>
      <ResumenCifras
        saludo={saludoDe(email, nombre)}
        etiquetaPeriodo={periodo.etiqueta}
        total={resumenVisible ? totalGastado(resumenVisible.por_mes.map((mes) => mes.total)) : null}
        confirmados={resumenVisible ? resumenVisible.comprobantes.length : null}
        borradores={borradores ? borradores.length : null}
        categorias={resumenVisible ? resumenVisible.por_categoria.length : null}
        cargando={cargandoResumen}
      />

      {errorResumen ? (
        <AlertaError titulo="No se pudo leer el resumen" detalle={errorResumen} alReintentar={reintentar} />
      ) : null}

      {errorDocs ? <AlertaError detalle={errorDocs} alReintentar={reintentar} /> : null}

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

      <PanelBorradores
        borradores={borradores}
        cargando={cargandoDocs}
        hayError={errorDocs !== null}
        descartando={descartando}
        alDescartar={descartarBorrador}
      />
    </Stack>
  )
}
