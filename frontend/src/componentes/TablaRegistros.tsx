import { Box, Button, Card, Flex, Stack, Table, Text } from "@chakra-ui/react"
import { type ReactNode } from "react"
import { Link } from "react-router"
import {
  ETIQUETA_CATEGORIA,
  type CamposDocumento,
  type DocumentoListado,
  type EstadoDocumento,
} from "../api/tipos"
import { formatMonto } from "../formato"

const SOMBRA = "0 12px 40px rgba(28, 27, 23, 0.06)"
const BORDE = "borde"
const HOVER_FILA = "rgba(245, 203, 92, 0.45)"

type Props = {
  items: DocumentoListado[]
}

function proveedorDe(campos: CamposDocumento): string {
  return campos.proveedor?.trim() || "Sin proveedor"
}

function inicialesDe(nombre: string): string {
  const palabras = nombre.trim().split(/\s+/).filter((palabra) => palabra.length > 0)
  if (palabras.length === 0) return "?"
  const letras = (palabra: string) => Array.from(palabra)
  if (palabras.length === 1) {
    const par = letras(palabras[0]).slice(0, 2).join("")
    return par === "" ? "?" : par.toLocaleUpperCase("es-AR")
  }
  const par = `${letras(palabras[0])[0] ?? ""}${letras(palabras[1])[0] ?? ""}`
  return par === "" ? "?" : par.toLocaleUpperCase("es-AR")
}

function categoriaDe(campos: CamposDocumento): string {
  return campos.categoria ? ETIQUETA_CATEGORIA[campos.categoria] : "Sin categoría"
}

function periodoDe(campos: CamposDocumento): string {
  return campos.periodo?.trim() || "Sin período"
}

function numeroDe(campos: CamposDocumento): string {
  return campos.numero_comprobante?.trim() || "—"
}

function Pastilla({
  fondo,
  color,
  children,
}: {
  fondo: string
  color: string
  children: string
}) {
  return (
    <Box
      as="span"
      display="inline-flex"
      alignItems="center"
      w="fit-content"
      flexShrink={0}
      px={2.5}
      py={0.5}
      borderRadius="full"
      bg={fondo}
      color={color}
      fontSize="xs"
      fontWeight="medium"
      lineHeight="1.2"
      whiteSpace="nowrap"
    >
      {children}
    </Box>
  )
}

function nodoEstado(estado: EstadoDocumento) {
  if (estado === "confirmado") {
    return (
      <Pastilla fondo="estado.okFondo" color="estado.ok">
        Confirmado
      </Pastilla>
    )
  }
  return (
    <Pastilla fondo="estado.avisoFondo" color="estado.aviso">
      Borrador
    </Pastilla>
  )
}

function nodoAnulado(item: DocumentoListado) {
  if (item.estado === "borrador") return "—"
  if (item.anulado === true) {
    return (
      <Pastilla fondo="estado.fallaFondo" color="estado.falla">
        Anulado
      </Pastilla>
    )
  }
  return (
    <Text as="span" color="fg.muted">
      Vigente
    </Text>
  )
}

function textoIndexado(item: DocumentoListado): string {
  if (item.estado === "borrador" || item.indexado === null || item.indexado === undefined) return "—"
  switch (item.indexado) {
    case "ok":
      return "Se puede buscar"
    case "error":
      return "No se pudo"
    case "omitido":
      return "Sin texto"
  }
}

function Proveedor({ campos }: { campos: CamposDocumento }) {
  return (
    <Flex align="center" gap={2.5} minW={0} flex="1">
      <Flex
        aria-hidden
        align="center"
        justify="center"
        flexShrink={0}
        boxSize="32px"
        borderRadius="full"
        bg="bg.subtle"
        color="fg"
        fontSize="xs"
        fontWeight="600"
        lineHeight="1"
      >
        {inicialesDe(campos.proveedor ?? "")}
      </Flex>
      <Text
        minW={0}
        overflow="hidden"
        textOverflow="ellipsis"
        whiteSpace="nowrap"
        fontWeight="medium"
        color="fg"
      >
        {proveedorDe(campos)}
      </Text>
    </Flex>
  )
}

function BotonVer({ id }: { id: string }) {
  return (
    <Button
      asChild
      size="sm"
      variant="outline"
      borderRadius="full"
      color="fg"
      alignSelf="flex-start"
    >
      <Link to={`/documentos/${id}`}>Ver</Link>
    </Button>
  )
}

function Encabezado({ children }: { children?: ReactNode }) {
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

function TarjetaRegistro({ item }: { item: DocumentoListado }) {
  return (
    <Card.Root size="sm" bg="bg.panel" borderWidth="0" borderRadius="20px" boxShadow={SOMBRA} _dark={{ borderWidth: "1px", borderColor: "borde" }}>
      <Card.Body>
        <Stack gap={3}>
          <Flex justify="space-between" gap={3} align="center" minW={0}>
            <Proveedor campos={item.campos} />
            {nodoEstado(item.estado)}
          </Flex>
          <Text fontSize="sm" color="fg.muted">
            {categoriaDe(item.campos)} · {periodoDe(item.campos)}
          </Text>
          <Text fontSize="sm" color="fg.muted">
            Número {numeroDe(item.campos)}
          </Text>
          <Text fontVariantNumeric="tabular-nums" fontWeight="medium">
            {formatMonto(item.campos.monto, item.campos.moneda)}
          </Text>
          <Flex gap={4} wrap="wrap">
            <Flex gap={2} align="center">
              <Text fontSize="sm" color="fg.muted">
                Anulado
              </Text>
              {nodoAnulado(item)}
            </Flex>
            <Flex gap={2} align="center">
              <Text fontSize="sm" color="fg.muted">
                Texto
              </Text>
              <Text fontSize="sm">{textoIndexado(item)}</Text>
            </Flex>
          </Flex>
          <BotonVer id={item.id} />
        </Stack>
      </Card.Body>
    </Card.Root>
  )
}

export function TablaRegistros({ items }: Props) {
  return (
    <>
      <Stack gap={3} display={{ base: "flex", md: "none" }}>
        {items.map((item) => (
          <TarjetaRegistro key={item.id} item={item} />
        ))}
      </Stack>
      <Box
        display={{ base: "none", md: "block" }}
        bg="bg.panel"
        borderRadius="20px"
        boxShadow={SOMBRA}
        overflow="hidden"
      >
        <Table.ScrollArea>
          <Table.Root size="sm" w="max-content" minW="100%">
            <Table.Header>
              <Table.Row bg="bg.panel">
                <Encabezado>Proveedor</Encabezado>
                <Encabezado>Categoría</Encabezado>
                <Encabezado>Período</Encabezado>
                <Encabezado>Número</Encabezado>
                <Encabezado>Monto</Encabezado>
                <Encabezado>Estado</Encabezado>
                <Encabezado>Anulado</Encabezado>
                <Encabezado>Texto</Encabezado>
                <Encabezado />
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
                    <Proveedor campos={item.campos} />
                  </Celda>
                  <Celda>{categoriaDe(item.campos)}</Celda>
                  <Celda>{periodoDe(item.campos)}</Celda>
                  <Celda>{numeroDe(item.campos)}</Celda>
                  <Celda>
                    <Text fontVariantNumeric="tabular-nums" fontWeight="medium">
                      {formatMonto(item.campos.monto, item.campos.moneda)}
                    </Text>
                  </Celda>
                  <Celda>{nodoEstado(item.estado)}</Celda>
                  <Celda>{nodoAnulado(item)}</Celda>
                  <Celda>{textoIndexado(item)}</Celda>
                  <Celda>
                    <BotonVer id={item.id} />
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
