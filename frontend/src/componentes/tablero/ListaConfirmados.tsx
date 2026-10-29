import { Badge, Box, Button, Card, Flex, Stack, Table, Text } from "@chakra-ui/react"
import { Link } from "react-router"
import { ETIQUETA_CATEGORIA, type CamposDocumento, type EstadoDocumento } from "../../api/tipos"
import { formatMonto } from "../../formato"

const SOMBRA = "0 12px 40px rgba(28, 27, 23, 0.06)"

function proveedorDe(campos: CamposDocumento): string {
  return campos.proveedor?.trim() || "Sin proveedor"
}

function categoriaDe(campos: CamposDocumento): string {
  return campos.categoria ? ETIQUETA_CATEGORIA[campos.categoria] : "Sin categoría"
}

function periodoDe(campos: CamposDocumento): string {
  return campos.periodo ?? "Sin período"
}

function etiquetaEstado(estado: EstadoDocumento): string {
  return estado === "confirmado" ? "Confirmado" : "Borrador"
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

export function ListaConfirmados({
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
            bg="bg.panel"
            borderWidth="0"
            borderRadius="20px"
            boxShadow={SOMBRA}
            _dark={{ borderWidth: "1px", borderColor: "borde" }}
          >
            <Card.Body>
              <Stack gap={2}>
                <Flex justify="space-between" gap={2} align="center">
                  <Text fontWeight="medium">{proveedorDe(item.campos)}</Text>
                  <PastillaEstado estado={item.estado} />
                </Flex>
                <Text fontSize="sm" color="fg.muted">
                  {categoriaDe(item.campos)} · {periodoDe(item.campos)}
                </Text>
                <Text fontVariantNumeric="tabular-nums">
                  {formatMonto(item.campos.monto, item.campos.moneda)}
                </Text>
                <Button asChild size="sm" variant="outline" alignSelf="flex-start">
                  <Link to={`/documentos/${item.id}`}>{accion}</Link>
                </Button>
              </Stack>
            </Card.Body>
          </Card.Root>
        ))}
      </Stack>
      <Box
        display={{ base: "none", md: "block" }}
        bg="bg.panel"
        borderWidth="0"
        borderRadius="20px"
        boxShadow={SOMBRA}
        overflow="hidden"
        _dark={{ borderWidth: "1px", borderColor: "borde" }}
      >
        <Table.ScrollArea>
          <Table.Root
            size="sm"
            css={{
              "& th, & td": {
                borderColor: "borde",
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
                <Table.ColumnHeader textAlign="right" fontVariantNumeric="tabular-nums">
                  Monto
                </Table.ColumnHeader>
                <Table.ColumnHeader>Estado</Table.ColumnHeader>
                <Table.ColumnHeader />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {items.map((item) => (
                <Table.Row key={item.id} css={{ bg: "transparent", _hover: { bg: "bg.hover" } }}>
                  <Table.Cell>{proveedorDe(item.campos)}</Table.Cell>
                  <Table.Cell>{categoriaDe(item.campos)}</Table.Cell>
                  <Table.Cell>{periodoDe(item.campos)}</Table.Cell>
                  <Table.Cell textAlign="right" fontVariantNumeric="tabular-nums">
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
