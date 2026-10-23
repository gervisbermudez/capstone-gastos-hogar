import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Flex,
  Heading,
  Input,
  NativeSelect,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react"
import { useEffect, useRef, useState, type MouseEvent } from "react"
import { Link, useNavigate } from "react-router"
import { ErrorApi, cliente, esAbort } from "../api/cliente"
import {
  CATEGORIAS,
  ETIQUETA_CATEGORIA,
  type CamposDocumento,
  type Categoria,
  type DocumentoListado,
  type EstadoDocumento,
  type Resumen,
} from "../api/tipos"
import { toaster } from "../avisos"
import { CargaComprobante } from "../componentes/CargaComprobante"
import { GraficoCategorias, GraficoMeses } from "../componentes/GraficosResumen"
import { formatMonto } from "../formato"
import { periodoDe } from "../formulario"
import { guardarVista } from "../vistas"

const PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/
const DIA_MS = 86_400_000
const FRASE_GRAFICOS = "Los gráficos son del período completo. El filtro solo achica la lista."

type FiltroCategoria = "todas" | Categoria

const fechaVisible = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
})

function proveedorDe(campos: CamposDocumento): string {
  return campos.proveedor?.trim() || "Sin proveedor"
}

function categoriaDe(campos: CamposDocumento): string {
  return campos.categoria ? ETIQUETA_CATEGORIA[campos.categoria] : "Sin categoría"
}

function etiquetaEstado(estado: EstadoDocumento): string {
  return estado === "confirmado" ? "Confirmado" : "Borrador"
}

function filtroDe(valor: string): FiltroCategoria {
  if (valor === "servicios" || valor === "expensas" || valor === "alquiler") return valor
  return "todas"
}

function instanteFecha(iso: string): number | null {
  const coincidencia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!coincidencia) return null
  const anio = Number(coincidencia[1])
  const mes = Number(coincidencia[2])
  const dia = Number(coincidencia[3])
  const instante = Date.UTC(anio, mes - 1, dia)
  if (Number.isNaN(instante)) return null
  const fecha = new Date(instante)
  if (fecha.getUTCFullYear() !== anio || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) {
    return null
  }
  return instante
}

function inicioDeHoy(): number {
  const ahora = new Date()
  return Date.UTC(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())
}

function venceDentroDeSieteDias(iso: string, hoy: number): boolean {
  const instante = instanteFecha(iso)
  if (instante === null) return false
  return Math.round((instante - hoy) / DIA_MS) <= 7
}

function textoVencimiento(valor: string | undefined): string {
  if (!valor || valor.trim() === "") return "Sin vencimiento"
  const instante = instanteFecha(valor)
  if (instante === null) return valor
  return fechaVisible.format(instante)
}

function irACarga(event: MouseEvent<HTMLAnchorElement>) {
  const destino = document.getElementById("cargar-comprobante")
  if (!destino) return
  event.preventDefault()
  destino.scrollIntoView({ behavior: "smooth", block: "start" })
}

function BotonCargar() {
  return (
    <Button asChild mt={3} size="sm">
      <a href="#cargar-comprobante" onClick={irACarga}>
        Cargar un comprobante
      </a>
    </Button>
  )
}

function PasosIniciales() {
  return (
    <Card.Root>
      <Card.Header>
        <Card.Title>Tres pasos</Card.Title>
        <Card.Description>Para tener comprobantes en este período.</Card.Description>
      </Card.Header>
      <Card.Body>
        <Stack gap={3}>
          <Flex gap={3} align="center">
            <Text fontWeight="medium">1.</Text>
            <Button asChild size="sm" variant="outline">
              <a href="#cargar-comprobante" onClick={irACarga}>
                Cargar un comprobante
              </a>
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
  alDescartar,
  descartandoId,
}: {
  items: Array<{ id: string; estado: EstadoDocumento; campos: CamposDocumento }>
  accion: string
  alDescartar?: (id: string) => void
  descartandoId?: string | null
}) {
  return (
    <>
      <Stack gap={3} display={{ base: "flex", md: "none" }}>
        {items.map((item) => (
          <Card.Root key={item.id} size="sm">
            <Card.Body>
              <Stack gap={2}>
                <Flex justify="space-between" gap={2} align="center">
                  <Text fontWeight="medium">{proveedorDe(item.campos)}</Text>
                  <Badge colorPalette={item.estado === "confirmado" ? "green" : "orange"}>
                    {etiquetaEstado(item.estado)}
                  </Badge>
                </Flex>
                <Text fontSize="sm" color="fg.muted">
                  {categoriaDe(item.campos)} · {item.campos.periodo ?? "Sin período"}
                </Text>
                <Text fontSize="sm" color="fg.muted">
                  Vencimiento: {textoVencimiento(item.campos.vencimiento)}
                </Text>
                <Text>{formatMonto(item.campos.monto, item.campos.moneda)}</Text>
                <Flex gap={2} wrap="wrap">
                  <Button asChild size="sm" alignSelf="flex-start">
                    <Link to={`/documentos/${item.id}`}>{accion}</Link>
                  </Button>
                  {alDescartar ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      colorPalette="red"
                      alignSelf="flex-start"
                      loading={descartandoId === item.id}
                      disabled={descartandoId !== null && descartandoId !== undefined && descartandoId !== item.id}
                      onClick={() => alDescartar(item.id)}
                    >
                      Descartar
                    </Button>
                  ) : null}
                </Flex>
              </Stack>
            </Card.Body>
          </Card.Root>
        ))}
      </Stack>
      <Table.ScrollArea display={{ base: "none", md: "block" }}>
        <Table.Root size="sm">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Proveedor</Table.ColumnHeader>
              <Table.ColumnHeader>Categoría</Table.ColumnHeader>
              <Table.ColumnHeader>Período</Table.ColumnHeader>
              <Table.ColumnHeader>Vencimiento</Table.ColumnHeader>
              <Table.ColumnHeader>Monto</Table.ColumnHeader>
              <Table.ColumnHeader>Estado</Table.ColumnHeader>
              <Table.ColumnHeader />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {items.map((item) => (
              <Table.Row key={item.id}>
                <Table.Cell>{proveedorDe(item.campos)}</Table.Cell>
                <Table.Cell>{categoriaDe(item.campos)}</Table.Cell>
                <Table.Cell>{item.campos.periodo ?? "Sin período"}</Table.Cell>
                <Table.Cell>{textoVencimiento(item.campos.vencimiento)}</Table.Cell>
                <Table.Cell>{formatMonto(item.campos.monto, item.campos.moneda)}</Table.Cell>
                <Table.Cell>
                  <Badge colorPalette={item.estado === "confirmado" ? "green" : "orange"}>
                    {etiquetaEstado(item.estado)}
                  </Badge>
                </Table.Cell>
                <Table.Cell>
                  <Flex gap={2} wrap="wrap">
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/documentos/${item.id}`}>{accion}</Link>
                    </Button>
                    {alDescartar ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        colorPalette="red"
                        loading={descartandoId === item.id}
                        disabled={descartandoId !== null && descartandoId !== undefined && descartandoId !== item.id}
                        onClick={() => alDescartar(item.id)}
                      >
                        Descartar
                      </Button>
                    ) : null}
                  </Flex>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Table.ScrollArea>
    </>
  )
}

function mensajeError(error: unknown, fallback: string): string {
  return error instanceof ErrorApi ? error.message : fallback
}

export function Tablero() {
  const navigate = useNavigate()
  const [desde, setDesde] = useState(() => `${new Date().getFullYear()}-01`)
  const [hasta, setHasta] = useState(() => periodoDe(new Date()))
  const [filtroCategoria, setFiltroCategoria] = useState<FiltroCategoria>("todas")
  const [intento, setIntento] = useState(0)
  const [resumen, setResumen] = useState<Resumen | null>(null)
  const [borradores, setBorradores] = useState<DocumentoListado[] | null>(null)
  const [errorResumen, setErrorResumen] = useState<string | null>(null)
  const [errorDocs, setErrorDocs] = useState<string | null>(null)
  const [cargandoResumen, setCargandoResumen] = useState(true)
  const [cargandoDocs, setCargandoDocs] = useState(true)
  const [descargando, setDescargando] = useState(false)
  const [descartando, setDescartando] = useState<string | null>(null)
  const descargandoRef = useRef(false)
  const descartandoRef = useRef<string | null>(null)
  const descargaCtrl = useRef<AbortController | null>(null)

  useEffect(() => () => descargaCtrl.current?.abort(), [])

  const rangoInvalido =
    !PERIODO.test(desde) || !PERIODO.test(hasta)
      ? "Elegí desde y hasta."
      : desde > hasta
        ? "El desde tiene que ser anterior o igual al hasta."
        : null

  async function descargarCsv() {
    if (rangoInvalido || descargandoRef.current) return
    const ctrl = new AbortController()
    descargaCtrl.current = ctrl
    descargandoRef.current = true
    setDescargando(true)
    try {
      const csv = await cliente.exportar(desde, hasta, ctrl.signal)
      if (ctrl.signal.aborted) return
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const enlace = document.createElement("a")
      enlace.href = url
      enlace.download = `gastos-${desde}-${hasta}.csv`
      document.body.appendChild(enlace)
      enlace.click()
      enlace.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      if (esAbort(error)) return
      toaster.create({
        title: mensajeError(error, "No se pudo descargar el CSV."),
        type: "error",
      })
    } finally {
      if (descargaCtrl.current === ctrl) {
        descargandoRef.current = false
        setDescargando(false)
      }
    }
  }

  async function descartarBorrador(idDocumento: string) {
    if (descartandoRef.current) return
    if (!window.confirm("¿Descartás este borrador? No se puede deshacer.")) return
    descartandoRef.current = idDocumento
    setDescartando(idDocumento)
    try {
      await cliente.descartar(idDocumento)
      setIntento((valor) => valor + 1)
    } catch (error) {
      toaster.create({
        title: mensajeError(error, "No se pudo descartar el borrador."),
        type: "error",
      })
    } finally {
      descartandoRef.current = null
      setDescartando(null)
    }
  }

  useEffect(() => {
    const ctrl = new AbortController()
    setCargandoDocs(true)
    cliente
      .listarDocumentos(ctrl.signal)
      .then((lista) => {
        setBorradores(lista.items.filter((item) => item.estado === "borrador"))
        setErrorDocs(null)
      })
      .catch((error: unknown) => {
        if (esAbort(error)) return
        setBorradores(null)
        setErrorDocs(mensajeError(error, "No se pudieron cargar los borradores."))
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setCargandoDocs(false)
      })
    return () => ctrl.abort()
  }, [intento])

  useEffect(() => {
    if (rangoInvalido) {
      setCargandoResumen(false)
      return
    }
    const ctrl = new AbortController()
    setCargandoResumen(true)
    cliente
      .resumen(desde, hasta, ctrl.signal)
      .then((datos) => {
        setResumen(datos)
        setErrorResumen(null)
      })
      .catch((error: unknown) => {
        if (esAbort(error)) return
        setResumen(null)
        setErrorResumen(mensajeError(error, "No se pudo cargar el resumen."))
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setCargandoResumen(false)
      })
    return () => ctrl.abort()
  }, [desde, hasta, intento, rangoInvalido])

  const hoy = inicioDeHoy()
  const resumenListo = !rangoInvalido && !errorResumen && !cargandoResumen && resumen !== null
  const avisosVencimiento =
    resumenListo && resumen
      ? resumen.comprobantes
          .filter(
            (item) => item.estado === "confirmado" && venceDentroDeSieteDias(item.campos.vencimiento ?? "", hoy),
          )
          .sort((a, b) => (a.campos.vencimiento ?? "").localeCompare(b.campos.vencimiento ?? ""))
      : []
  const confirmadosVisibles =
    resumen === null
      ? []
      : filtroCategoria === "todas"
        ? resumen.comprobantes
        : resumen.comprobantes.filter((item) => item.campos.categoria === filtroCategoria)
  const mostrarPasos =
    resumenListo &&
    resumen !== null &&
    !cargandoDocs &&
    !errorDocs &&
    borradores !== null &&
    borradores.length === 0 &&
    resumen.comprobantes.length === 0

  return (
    <Stack gap={6}>
      <Heading size="lg">Tablero</Heading>
      <Flex direction={{ base: "column", sm: "row" }} gap={3} align={{ sm: "flex-end" }}>
        <Field.Root>
          <Field.Label>Desde</Field.Label>
          <Input type="month" value={desde} onChange={(event) => setDesde(event.target.value)} />
        </Field.Root>
        <Field.Root>
          <Field.Label>Hasta</Field.Label>
          <Input type="month" value={hasta} onChange={(event) => setHasta(event.target.value)} />
        </Field.Root>
        <Button
          type="button"
          variant="outline"
          disabled={rangoInvalido !== null}
          loading={descargando}
          onClick={() => void descargarCsv()}
        >
          Descargar CSV
        </Button>
      </Flex>

      {avisosVencimiento.length > 0 ? (
        <Alert.Root status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>
              {avisosVencimiento.length === 1
                ? "Hay un vencimiento a 7 días o menos, o ya pasado"
                : "Hay vencimientos a 7 días o menos, o ya pasados"}
            </Alert.Title>
            <Stack gap={1} mt={1}>
              {avisosVencimiento.map((item) => (
                <Text key={item.id}>
                  {proveedorDe(item.campos)} · {textoVencimiento(item.campos.vencimiento)}
                </Text>
              ))}
            </Stack>
          </Alert.Content>
        </Alert.Root>
      ) : null}

      {mostrarPasos ? <PasosIniciales /> : null}

      {rangoInvalido ? (
        <Alert.Root status="warning">
          <Alert.Indicator />
          <Alert.Description>{rangoInvalido}</Alert.Description>
        </Alert.Root>
      ) : errorResumen ? (
        <Alert.Root status="error">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>No se pudo leer el resumen</Alert.Title>
            <Alert.Description>{errorResumen}</Alert.Description>
            <Button
              mt={3}
              size="sm"
              alignSelf="flex-start"
              variant="outline"
              colorPalette="gray"
              onClick={() => setIntento((valor) => valor + 1)}
            >
              Reintentar
            </Button>
          </Alert.Content>
        </Alert.Root>
      ) : cargandoResumen ? (
        <SimpleGrid columns={{ base: 1, lg: 2 }} gap={4}>
          <Skeleton height="18rem" />
          <Skeleton height="18rem" />
        </SimpleGrid>
      ) : resumen ? (
        <Stack gap={3}>
          <SimpleGrid columns={{ base: 1, lg: 2 }} gap={4}>
            <Card.Root>
              <Card.Header>
                <Card.Title>Total por mes</Card.Title>
              </Card.Header>
              <Card.Body>
                <GraficoMeses porMes={resumen.por_mes} />
              </Card.Body>
            </Card.Root>
            <Card.Root>
              <Card.Header>
                <Card.Title>Total por categoría</Card.Title>
              </Card.Header>
              <Card.Body>
                <GraficoCategorias porCategoria={resumen.por_categoria} />
              </Card.Body>
            </Card.Root>
          </SimpleGrid>
          <Text fontSize="sm" color="fg.muted">
            {FRASE_GRAFICOS}
          </Text>
        </Stack>
      ) : null}

      <Card.Root id="cargar-comprobante" style={{ scrollMarginTop: "1rem" }}>
        <Card.Header>
          <Card.Title>Cargar comprobante</Card.Title>
        </Card.Header>
        <Card.Body>
          <CargaComprobante
            onListo={(documento, archivo) => {
              guardarVista(documento.id, archivo)
              navigate(`/documentos/${documento.id}`)
            }}
          />
        </Card.Body>
      </Card.Root>

      <Stack gap={3}>
        <Heading size="md">Borradores</Heading>
        {errorDocs ? (
          <Alert.Root status="error">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>{errorDocs}</Alert.Description>
              <Button
                mt={3}
                size="sm"
                alignSelf="flex-start"
                variant="outline"
                colorPalette="gray"
                onClick={() => setIntento((valor) => valor + 1)}
              >
                Reintentar
              </Button>
            </Alert.Content>
          </Alert.Root>
        ) : cargandoDocs ? (
          <Skeleton height="6rem" />
        ) : borradores && borradores.length > 0 ? (
          <ListaComprobantes
            items={borradores}
            accion="Revisar"
            alDescartar={(idDocumento) => void descartarBorrador(idDocumento)}
            descartandoId={descartando}
          />
        ) : (
          <EmptyState.Root>
            <EmptyState.Content>
              <EmptyState.Title>No hay borradores</EmptyState.Title>
              <EmptyState.Description>
                Cuando cargues un comprobante, queda acá hasta que lo confirmes.
              </EmptyState.Description>
              <BotonCargar />
            </EmptyState.Content>
          </EmptyState.Root>
        )}
      </Stack>

      <Stack gap={3}>
        <Flex direction={{ base: "column", sm: "row" }} gap={3} justify="space-between" align={{ sm: "flex-end" }}>
          <Heading size="md">Confirmados en el período</Heading>
          {resumenListo ? (
            <Field.Root maxW={{ base: "100%", sm: "16rem" }}>
              <Field.Label>Categoría</Field.Label>
              <NativeSelect.Root>
                <NativeSelect.Field
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
          <Skeleton height="6rem" />
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
              <BotonCargar />
            </EmptyState.Content>
          </EmptyState.Root>
        )}
      </Stack>
    </Stack>
  )
}
