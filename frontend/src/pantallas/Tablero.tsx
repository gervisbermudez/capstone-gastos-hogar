import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  EmptyState,
  Field,
  Flex,
  Grid,
  Heading,
  Input,
  NativeSelect,
  Skeleton,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react"
import type { ReactNode } from "react"
import { Link } from "react-router"
import {
  CATEGORIAS,
  ETIQUETA_CATEGORIA,
  type CamposDocumento,
  type Categoria,
  type EstadoDocumento,
} from "../api/tipos"
import { GraficoCategorias, GraficoMeses } from "../componentes/GraficosResumen"
import { useTablero } from "../datos/useTablero"
import { formatMonto } from "../formato"
import { useSesion } from "../sesion"

const FRASE_GRAFICOS = "Los gráficos son del período completo. El filtro solo achica la lista."
const SOMBRA = "0 12px 40px rgba(28, 27, 23, 0.06)"

function saludoDe(email: string | null): string {
  const nombre = email?.split("@")[0]?.trim() ?? ""
  return nombre ? `Hola, ${nombre}` : "Hola"
}

function proveedorDe(campos: CamposDocumento): string {
  return campos.proveedor?.trim() || "Sin proveedor"
}

function categoriaDe(campos: CamposDocumento): string {
  return campos.categoria ? ETIQUETA_CATEGORIA[campos.categoria] : "Sin categoría"
}

function etiquetaEstado(estado: EstadoDocumento): string {
  return estado === "confirmado" ? "Confirmado" : "Borrador"
}

function filtroDe(valor: string): "todas" | Categoria {
  if (valor === "servicios" || valor === "expensas" || valor === "alquiler") return valor
  return "todas"
}

function Cifra({ valor, etiqueta }: { valor: string; etiqueta: string }) {
  return (
    <Stack gap={1} minW="4.75rem">
      <Text
        color="marca.carbon"
        fontSize={{ base: "2.25rem", md: "2.75rem" }}
        fontWeight="600"
        lineHeight="1"
        letterSpacing="-0.03em"
        fontVariantNumeric="tabular-nums"
      >
        {valor}
      </Text>
      <Text color="fg.muted" fontSize="sm" lineHeight="1.2">
        {etiqueta}
      </Text>
    </Stack>
  )
}

function PastillaEstado({ estado }: { estado: EstadoDocumento }) {
  const confirmado = estado === "confirmado"
  return (
    <Badge
      variant="plain"
      borderRadius="full"
      px="2.5"
      fontWeight="medium"
      css={{
        bg: confirmado ? "estado.okFondo" : "estado.avisoFondo",
        color: confirmado ? "estado.ok" : "estado.aviso",
      }}
    >
      {etiquetaEstado(estado)}
    </Badge>
  )
}

function BarraConteos({
  confirmados,
  borradores,
  categorias,
}: {
  confirmados: number
  borradores: number
  categorias: number
}) {
  const partes = [
    {
      clave: "confirmados",
      etiqueta: "Confirmados",
      conteo: confirmados,
      fondo: "marca.sol",
      texto: "marca.carbon",
    },
    {
      clave: "borradores",
      etiqueta: "Borradores",
      conteo: borradores,
      fondo: "marca.carbon",
      texto: "marca.papel",
    },
    {
      clave: "categorias",
      etiqueta: "Categorías",
      conteo: categorias,
      fondo: "#e4dcc8",
      texto: "marca.carbon",
    },
  ].filter((parte) => parte.conteo > 0)

  if (partes.length === 0) return null

  const total = partes.reduce((suma, parte) => suma + parte.conteo, 0)
  const visibles = partes.map((parte) => {
    const redondo = Math.round((parte.conteo / total) * 100)
    const porcentaje = parte.conteo === total ? 100 : Math.min(99, Math.max(1, redondo))
    return { ...parte, porcentaje }
  })

  return (
    <Stack gap={2}>
      <Flex gap={{ base: 4, md: 6 }} wrap="wrap">
        {visibles.map((parte) => (
          <Text key={parte.clave} fontSize="xs" color="fg.muted" lineHeight="1.3">
            {parte.etiqueta}{" "}
            <Text as="span" color="marca.carbon" fontWeight="medium" fontVariantNumeric="tabular-nums">
              {parte.porcentaje}%
            </Text>
          </Text>
        ))}
      </Flex>
      <Flex h="2.25rem" borderRadius="full" overflow="hidden" aria-hidden="true">
        {visibles.map((parte) => (
          <Flex
            key={parte.clave}
            align="center"
            justify="center"
            minW={0}
            overflow="hidden"
            px={1}
            bg={parte.fondo}
            color={parte.texto}
            fontSize="sm"
            fontWeight="medium"
            fontVariantNumeric="tabular-nums"
            whiteSpace="nowrap"
            style={{ flex: `${parte.conteo} 1 0%` }}
          >
            {parte.porcentaje}%
          </Flex>
        ))}
      </Flex>
    </Stack>
  )
}

function Tarjeta({ titulo, children }: { titulo?: string; children: ReactNode }) {
  return (
    <Card.Root h="100%" bg="marca.papel" borderWidth="0" borderRadius="20px" boxShadow={SOMBRA}>
      {titulo ? (
        <Card.Header>
          <Card.Title as="h2" fontWeight="medium" color="marca.carbon" letterSpacing="-0.03em">
            {titulo}
          </Card.Title>
        </Card.Header>
      ) : null}
      <Card.Body>{children}</Card.Body>
    </Card.Root>
  )
}

function PasosIniciales() {
  return (
    <Card.Root bg="marca.papel" borderWidth="0" borderRadius="20px" boxShadow={SOMBRA}>
      <Card.Header>
        <Card.Title as="h2" fontWeight="medium" color="marca.carbon" letterSpacing="-0.03em">
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

function ListaComprobantes({
  items,
  accion,
}: {
  items: Array<{ id: string; estado: EstadoDocumento; campos: CamposDocumento }>
  accion: string
}) {
  return (
    <>
      <Stack gap={3} display={{ base: "flex", md: "none" }}>
        {items.map((item) => (
          <Card.Root
            key={item.id}
            size="sm"
            bg="marca.papel"
            borderWidth="0"
            borderRadius="20px"
            boxShadow={SOMBRA}
          >
            <Card.Body>
              <Stack gap={2}>
                <Flex justify="space-between" gap={2} align="center">
                  <Text fontWeight="medium">{proveedorDe(item.campos)}</Text>
                  <PastillaEstado estado={item.estado} />
                </Flex>
                <Text fontSize="sm" color="fg.muted">
                  {categoriaDe(item.campos)} · {item.campos.periodo ?? "Sin período"}
                </Text>
                <Text fontVariantNumeric="tabular-nums">
                  {formatMonto(item.campos.monto, item.campos.moneda)}
                </Text>
                <Button asChild size="sm" alignSelf="flex-start">
                  <Link to={`/documentos/${item.id}`}>{accion}</Link>
                </Button>
              </Stack>
            </Card.Body>
          </Card.Root>
        ))}
      </Stack>
      <Box
        display={{ base: "none", md: "block" }}
        bg="marca.papel"
        borderRadius="20px"
        boxShadow={SOMBRA}
        overflow="hidden"
      >
        <Table.ScrollArea>
          <Table.Root
            size="sm"
            css={{
              "& th, & td": {
                borderColor: "rgba(28, 28, 26, 0.08)",
                verticalAlign: "middle",
                py: "0.75rem",
              },
              "& tr:last-child td": {
                borderBottomWidth: "0",
              },
            }}
          >
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Proveedor</Table.ColumnHeader>
                <Table.ColumnHeader>Categoría</Table.ColumnHeader>
                <Table.ColumnHeader>Período</Table.ColumnHeader>
                <Table.ColumnHeader>Monto</Table.ColumnHeader>
                <Table.ColumnHeader>Estado</Table.ColumnHeader>
                <Table.ColumnHeader />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {items.map((item) => (
                <Table.Row
                  key={item.id}
                  css={{ bg: "transparent", _hover: { bg: "rgba(245, 203, 92, 0.45)" } }}
                >
                  <Table.Cell>{proveedorDe(item.campos)}</Table.Cell>
                  <Table.Cell>{categoriaDe(item.campos)}</Table.Cell>
                  <Table.Cell>{item.campos.periodo ?? "Sin período"}</Table.Cell>
                  <Table.Cell fontVariantNumeric="tabular-nums">
                    {formatMonto(item.campos.monto, item.campos.moneda)}
                  </Table.Cell>
                  <Table.Cell>
                    <PastillaEstado estado={item.estado} />
                  </Table.Cell>
                  <Table.Cell>
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/documentos/${item.id}`}>{accion}</Link>
                    </Button>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Table.ScrollArea>
      </Box>
    </>
  )
}

function PanelBorradores({
  borradores,
  cargando,
  hayError,
  descartando,
  alDescartar,
}: {
  borradores: Array<{ id: string; campos: CamposDocumento }> | null
  cargando: boolean
  hayError: boolean
  descartando: string | null
  alDescartar: (id: string) => void
}) {
  return (
    <Card.Root
      h="100%"
      bg="marca.carbon"
      color="marca.papel"
      borderWidth="0"
      borderRadius="32px"
      boxShadow="0 18px 44px rgba(36, 36, 35, 0.16)"
      gridColumn={{ lg: "1 / -1" }}
      aria-busy={cargando || undefined}
    >
      <Card.Header>
        <Flex justify="space-between" align="center" gap={3}>
          <Card.Title as="h2" fontWeight="medium" color="marca.papel" letterSpacing="-0.03em">
            Borradores por revisar
          </Card.Title>
          {borradores ? (
            <Text
              color="marca.sol"
              fontSize="xl"
              fontWeight="medium"
              lineHeight="1"
              fontVariantNumeric="tabular-nums"
            >
              {borradores.length}
            </Text>
          ) : null}
        </Flex>
      </Card.Header>
      <Card.Body gap={4}>
        {cargando ? (
          <Skeleton height="8rem" borderRadius="16px" />
        ) : borradores && borradores.length > 0 ? (
          <Stack gap={4}>
            {borradores.map((item) => (
              <Flex
                key={item.id}
                direction={{ base: "column", sm: "row" }}
                justify="space-between"
                align={{ base: "flex-start", sm: "center" }}
                gap={3}
              >
                <Flex align="center" gap={3} minW={0}>
                  <Box
                    aria-hidden="true"
                    boxSize="8px"
                    borderRadius="full"
                    bg="marca.sol"
                    flexShrink={0}
                  />
                  <Text fontWeight="medium" color="marca.papel">
                    {proveedorDe(item.campos)}
                  </Text>
                </Flex>
                <Flex gap={2} wrap="wrap">
                  <Button
                    asChild
                    size="sm"
                    css={{
                      bg: "marca.sol",
                      color: "marca.carbon",
                      _hover: { bg: "marca.sol", color: "marca.carbon" },
                    }}
                  >
                    <Link to={`/documentos/${item.id}`}>Revisar</Link>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    loading={descartando === item.id}
                    disabled={descartando !== null && descartando !== item.id}
                    onClick={() => alDescartar(item.id)}
                    css={{
                      bg: "transparent",
                      color: "marca.papel",
                      borderWidth: "1px",
                      borderColor: "marca.papel",
                      _hover: { bg: "marca.grafito", color: "marca.papel" },
                    }}
                  >
                    Descartar
                  </Button>
                </Flex>
              </Flex>
            ))}
          </Stack>
        ) : !hayError && borradores && borradores.length === 0 ? (
          <Stack gap={2} align="center" textAlign="center" py={2}>
            <Text fontWeight="semibold" color="marca.papel">
              No hay borradores
            </Text>
            <Text fontSize="sm" color="marca.papel">
              Cuando cargues un comprobante, queda acá hasta que lo confirmes.
            </Text>
            <Button
              asChild
              mt={1}
              size="sm"
              css={{
                bg: "marca.sol",
                color: "marca.carbon",
                _hover: { bg: "marca.sol", color: "marca.carbon" },
              }}
            >
              <Link to="/cargar">Cargar un comprobante</Link>
            </Button>
          </Stack>
        ) : null}
      </Card.Body>
    </Card.Root>
  )
}

export function Tablero() {
  const { email } = useSesion()
  const {
    desde,
    hasta,
    setDesde,
    setHasta,
    filtroCategoria,
    setFiltroCategoria,
    rangoInvalido,
    resumen,
    cargandoResumen,
    errorResumen,
    borradores,
    cargandoDocs,
    errorDocs,
    reintentar,
    descargarCsv,
    descargando,
    descartarBorrador,
    descartando,
    confirmadosVisibles,
    mostrarPasos,
  } = useTablero()

  const resumenVisible = !rangoInvalido && !errorResumen && !cargandoResumen ? resumen : null

  return (
    <Stack gap={{ base: 6, md: 8 }}>
      <Stack gap={3}>
        <Flex
          direction={{ base: "column", md: "row" }}
          justify="space-between"
          align={{ base: "flex-start", md: "flex-end" }}
          gap={{ base: 5, md: 8 }}
        >
          <Heading
            as="h1"
            minW={0}
            color="marca.carbon"
            fontSize={{ base: "2rem", md: "2.75rem" }}
            fontWeight="medium"
            letterSpacing="-0.03em"
            lineHeight="1.1"
          >
            {saludoDe(email)}
          </Heading>
          <Flex gap={{ base: 6, md: 10 }} flexWrap="wrap">
            <Cifra
              valor={resumenVisible ? String(resumenVisible.comprobantes.length) : "—"}
              etiqueta="Comprobantes"
            />
            <Cifra valor={borradores ? String(borradores.length) : "—"} etiqueta="Borradores" />
            <Cifra
              valor={resumenVisible ? String(resumenVisible.por_categoria.length) : "—"}
              etiqueta="Categorías"
            />
          </Flex>
        </Flex>
        <BarraConteos
          confirmados={resumenVisible?.comprobantes.length ?? 0}
          borradores={borradores?.length ?? 0}
          categorias={resumenVisible?.por_categoria.length ?? 0}
        />
      </Stack>

      <Flex direction={{ base: "column", sm: "row" }} gap={3} align={{ sm: "flex-end" }}>
        <Field.Root flex={{ sm: "1" }} maxW={{ sm: "16rem" }}>
          <Field.Label color="marca.carbon">Desde</Field.Label>
          <Input
            type="month"
            color="marca.carbon"
            value={desde}
            onChange={(event) => setDesde(event.target.value)}
          />
        </Field.Root>
        <Field.Root flex={{ sm: "1" }} maxW={{ sm: "16rem" }}>
          <Field.Label color="marca.carbon">Hasta</Field.Label>
          <Input
            type="month"
            color="marca.carbon"
            value={hasta}
            onChange={(event) => setHasta(event.target.value)}
          />
        </Field.Root>
        <Button
          type="button"
          alignSelf={{ base: "flex-start", sm: "flex-end" }}
          disabled={rangoInvalido !== null}
          loading={descargando}
          onClick={descargarCsv}
          css={{
            bg: "marca.carbon",
            color: "marca.papel",
            _hover: { bg: "marca.grafito", color: "marca.papel" },
          }}
        >
          Descargar CSV
        </Button>
      </Flex>

      {rangoInvalido ? (
        <Alert.Root status="warning">
          <Alert.Indicator />
          <Alert.Description>{rangoInvalido}</Alert.Description>
        </Alert.Root>
      ) : null}

      {!rangoInvalido && errorResumen ? (
        <Alert.Root status="error">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>No se pudo leer el resumen</Alert.Title>
            <Alert.Description>{errorResumen}</Alert.Description>
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

      {errorDocs ? (
        <Alert.Root status="error">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{errorDocs}</Alert.Description>
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

      {mostrarPasos ? <PasosIniciales /> : null}

      <Grid templateColumns={{ base: "1fr", lg: "repeat(2, minmax(0, 1fr))" }} gap={{ base: 4, lg: 5 }}>
        {!rangoInvalido && !errorResumen && cargandoResumen ? (
          <>
            <Skeleton height="18rem" borderRadius="20px" />
            <Skeleton height="18rem" borderRadius="20px" />
          </>
        ) : null}
        {resumenVisible ? (
          <>
            <Tarjeta titulo="Total por mes">
              <GraficoMeses porMes={resumenVisible.por_mes} />
            </Tarjeta>
            <Tarjeta titulo="Total por categoría">
              <GraficoCategorias porCategoria={resumenVisible.por_categoria} />
            </Tarjeta>
            <Text gridColumn={{ lg: "1 / -1" }} fontSize="sm" color="fg.muted">
              {FRASE_GRAFICOS}
            </Text>
          </>
        ) : null}
        <PanelBorradores
          borradores={borradores}
          cargando={cargandoDocs}
          hayError={errorDocs !== null}
          descartando={descartando}
          alDescartar={descartarBorrador}
        />
      </Grid>

      <Stack gap={3}>
        <Flex
          direction={{ base: "column", sm: "row" }}
          gap={3}
          justify="space-between"
          align={{ sm: "flex-end" }}
        >
          <Heading as="h2" size="lg" fontWeight="medium" color="marca.carbon" letterSpacing="-0.03em">
            Confirmados en el período
          </Heading>
          {resumenVisible ? (
            <Field.Root maxW={{ base: "100%", sm: "16rem" }}>
              <Field.Label color="marca.carbon">Categoría</Field.Label>
              <NativeSelect.Root>
                <NativeSelect.Field
                  color="marca.carbon"
                  bg="marca.papel"
                  value={filtroCategoria}
                  onChange={(event) => setFiltroCategoria(filtroDe(event.target.value))}
                >
                  <option value="todas">Todas</option>
                  {CATEGORIAS.map((categoria) => (
                    <option key={categoria} value={categoria}>
                      {ETIQUETA_CATEGORIA[categoria]}
                    </option>
                  ))}
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </Field.Root>
          ) : null}
        </Flex>
        {rangoInvalido || errorResumen ? null : cargandoResumen ? (
          <Skeleton height="6rem" borderRadius="20px" />
        ) : resumen && resumen.comprobantes.length > 0 ? (
          confirmadosVisibles.length > 0 ? (
            <ListaComprobantes items={confirmadosVisibles} accion="Ver" />
          ) : (
            <EmptyState.Root>
              <EmptyState.Content>
                <EmptyState.Title>Ningún confirmado de esta categoría</EmptyState.Title>
                <EmptyState.Description>{FRASE_GRAFICOS}</EmptyState.Description>
              </EmptyState.Content>
            </EmptyState.Root>
          )
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
    </Stack>
  )
}
