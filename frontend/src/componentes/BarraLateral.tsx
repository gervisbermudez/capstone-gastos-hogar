import { Button, Flex, Menu, NativeSelect, Portal, Stack, Text } from "@chakra-ui/react"
import { type ReactNode } from "react"
import { Link } from "react-router"
import { useHogar } from "../hogar"
import { Logotipo } from "./Logotipo"

export type Seccion = "tablero" | "registros" | "categorias" | "cargar" | "chat" | "opciones"

function Icono({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      style={{ display: "block", flexShrink: 0, width: 16, height: 16 }}
    >
      {children}
    </svg>
  )
}

function IconoTablero() {
  return (
    <Icono>
      <rect x="1.5" y="1.5" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9.5" y="1.5" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="1.5" y="9.5" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
    </Icono>
  )
}

function IconoRegistros() {
  return (
    <Icono>
      <path d="M5.25 4h8.25M5.25 8h8.25M5.25 12h8.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="2.6" cy="4" r="1" fill="currentColor" />
      <circle cx="2.6" cy="8" r="1" fill="currentColor" />
      <circle cx="2.6" cy="12" r="1" fill="currentColor" />
    </Icono>
  )
}

function IconoCategorias() {
  return (
    <Icono>
      <path
        d="M6.5 2.75h6.15c.75 0 1.35.6 1.35 1.35v6.8c0 .75-.6 1.35-1.35 1.35H6.5L2.6 7.5 6.5 2.75Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="10.85" cy="7.5" r="0.85" fill="currentColor" />
    </Icono>
  )
}

function IconoCargar() {
  return (
    <Icono>
      <path
        d="M8 13.25V3M8 3 3.75 7.25M8 3l4.25 4.25"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Icono>
  )
}

function IconoChat() {
  return (
    <Icono>
      <path
        d="M2.5 3.25h11c.7 0 1.25.55 1.25 1.25v5.5c0 .7-.55 1.25-1.25 1.25H6.7L3.5 13.75V11.25H2.5c-.7 0-1.25-.55-1.25-1.25V4.5c0-.7.55-1.25 1.25-1.25Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </Icono>
  )
}

function IconoMenuVertical() {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      style={{ display: "block", flexShrink: 0, width: 20, height: 20 }}
    >
      <circle cx="10" cy="3.5" r="1.7" fill="currentColor" />
      <circle cx="10" cy="10" r="1.7" fill="currentColor" />
      <circle cx="10" cy="16.5" r="1.7" fill="currentColor" />
    </svg>
  )
}

const SECCIONES: { id: Seccion; to: string; etiqueta: string; Icono: () => ReactNode }[] = [
  { id: "tablero", to: "/", etiqueta: "Tablero", Icono: IconoTablero },
  { id: "registros", to: "/registros", etiqueta: "Registros", Icono: IconoRegistros },
  { id: "categorias", to: "/categorias", etiqueta: "Categorías", Icono: IconoCategorias },
  { id: "cargar", to: "/cargar", etiqueta: "Cargar", Icono: IconoCargar },
  { id: "chat", to: "/chat", etiqueta: "Chat", Icono: IconoChat },
]

const ENLACES_OPCIONES = [
  { value: "hogar", to: "/opciones#hogar", etiqueta: "Hogar" },
  { value: "cuenta", to: "/opciones#cuenta", etiqueta: "Cuenta" },
  { value: "apariencia", to: "/opciones#apariencia", etiqueta: "Apariencia" },
  { value: "modelo", to: "/opciones#modelo", etiqueta: "Modelo" },
  { value: "sesion", to: "/opciones#sesion", etiqueta: "Sesión" },
] as const

const OCULTAS_ASOCIADO = new Set<Seccion>(["categorias", "chat"])

function SelectorHogar() {
  const { hogares, hogarActivo, elegir } = useHogar()
  if (hogares.length === 0) return null
  const valor = hogarActivo?.id ?? hogares[0]?.id ?? ""
  return (
    <NativeSelect.Root size="sm" w="100%">
      <NativeSelect.Field
        aria-label="Hogar"
        bg="bg.panel"
        color="fg"
        borderColor="borde"
        borderRadius="full"
        value={valor}
        onChange={(event) => elegir(event.target.value)}
      >
        {hogares.map((hogar) => (
          <option key={hogar.id} value={hogar.id}>
            {`${hogar.nombre} · ${hogar.rol === "administrador" ? "Administrador" : "Asociado"}`}
          </option>
        ))}
      </NativeSelect.Field>
      <NativeSelect.Indicator />
    </NativeSelect.Root>
  )
}

const itemMenu = {
  px: 3,
  py: 2,
  mx: 1,
  borderRadius: "12px",
  cursor: "pointer",
  color: "fg",
  textDecoration: "none",
  _highlighted: { bg: "bg.subtle" },
} as const

type Props = {
  activo: Seccion | null
  email: string | null
  alias: string | null
  onSalir: () => void
  onNavigate?: () => void
}

export function BarraLateral({ activo, email, alias, onSalir, onNavigate }: Props) {
  const { rol } = useHogar()
  const etiquetaUsuario = alias?.trim() || email
  const enOpciones = activo === "opciones"
  const secciones = SECCIONES.filter((seccion) => rol !== "asociado" || !OCULTAS_ASOCIADO.has(seccion.id))

  return (
    <Flex direction="column" h="100%" minH={0} flex="1" overflow="auto" px={4} py={6} gap={8}>
      <Stack gap={8}>
        <Logotipo tamano="sm" />
        <SelectorHogar />
        <Stack as="nav" aria-label="Secciones" gap={2}>
          {secciones.map(({ id, to, etiqueta, Icono }) => {
            const esActivo = activo === id
            return (
              <Button
                key={id}
                asChild
                variant="ghost"
                justifyContent="flex-start"
                gap={2}
                w="100%"
                borderRadius="full"
                bg={esActivo ? "fg" : "transparent"}
                color={esActivo ? "fg.sobreSolido" : "fg"}
                aria-current={esActivo ? "page" : undefined}
                _hover={
                  esActivo
                    ? { bg: "fg", color: "fg.sobreSolido" }
                    : { bg: "bg.hover", color: "fg" }
                }
              >
                <Link
                  to={to}
                  aria-current={esActivo ? "page" : undefined}
                  onClick={onNavigate}
                  style={{ display: "flex", alignItems: "center", gap: "0.5rem", width: "100%" }}
                >
                  <Icono />
                  {etiqueta}
                </Link>
              </Button>
            )
          })}
        </Stack>
      </Stack>
      <Stack gap={3} mt="auto">
        <Flex align="center" gap={2} minW={0} w="100%">
          {etiquetaUsuario ? (
            <Text flex="1" minW={0} fontSize="sm" color="fg.muted" overflowWrap="anywhere">
              {etiquetaUsuario}
            </Text>
          ) : null}
          <Menu.Root positioning={{ placement: "right-start" }}>
            <Menu.Trigger asChild>
              <Button
                type="button"
                variant="ghost"
                aria-label="Opciones"
                aria-current={enOpciones ? "page" : undefined}
                flexShrink={0}
                borderRadius="full"
                px={0}
                minW={10}
                color={enOpciones ? "fg.sobreSolido" : "fg"}
                bg={enOpciones ? "fg" : "transparent"}
                _hover={
                  enOpciones
                    ? { bg: "fg", color: "fg.sobreSolido" }
                    : { bg: "bg.hover", color: "fg" }
                }
                _expanded={
                  enOpciones
                    ? { bg: "fg", color: "fg.sobreSolido" }
                    : { bg: "bg.hover", color: "fg" }
                }
              >
                <IconoMenuVertical />
              </Button>
            </Menu.Trigger>
            <Portal>
              <Menu.Positioner zIndex={2000}>
                <Menu.Content
                  bg="bg.panel"
                  borderWidth="0"
                  borderRadius="16px"
                  boxShadow="0 12px 40px rgba(28, 27, 23, 0.06)"
                  minW="11rem"
                  py={1}
                  _dark={{ borderWidth: "1px", borderColor: "borde" }}
                >
                  {ENLACES_OPCIONES.map(({ value, to, etiqueta }) => (
                    <Menu.Item key={value} value={value} asChild css={itemMenu}>
                      <Link to={to} onClick={onNavigate}>
                        {etiqueta}
                      </Link>
                    </Menu.Item>
                  ))}
                </Menu.Content>
              </Menu.Positioner>
            </Portal>
          </Menu.Root>
        </Flex>
        <Button
          type="button"
          variant="ghost"
          justifyContent="flex-start"
          w="100%"
          borderRadius="full"
          color="fg"
          _hover={{ bg: "bg.hover", color: "fg" }}
          onClick={onSalir}
        >
          Salir
        </Button>
      </Stack>
    </Flex>
  )
}
