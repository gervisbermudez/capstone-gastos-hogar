import { Button, Flex, Stack, Switch, Text } from "@chakra-ui/react"
import { type ReactNode } from "react"
import { Link } from "react-router"
import { useTema } from "../temaModo"
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

function IconoOpciones() {
  return (
    <Icono>
      <circle cx="8" cy="8" r="1.85" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="3.9" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 1.15v2.95M8 11.9v2.95M1.15 8h2.95M11.9 8h2.95M3.16 3.16l2.08 2.08M10.76 10.76l2.08 2.08M12.84 3.16l-2.08 2.08M5.24 10.76l-2.08 2.08"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </Icono>
  )
}

const SECCIONES: { id: Seccion; to: string; etiqueta: string; Icono: () => ReactNode }[] = [
  { id: "tablero", to: "/", etiqueta: "Tablero", Icono: IconoTablero },
  { id: "registros", to: "/registros", etiqueta: "Registros", Icono: IconoRegistros },
  { id: "categorias", to: "/categorias", etiqueta: "Categorías", Icono: IconoCategorias },
  { id: "cargar", to: "/cargar", etiqueta: "Cargar", Icono: IconoCargar },
  { id: "chat", to: "/chat", etiqueta: "Chat", Icono: IconoChat },
  { id: "opciones", to: "/opciones", etiqueta: "Opciones", Icono: IconoOpciones },
]

type Props = {
  activo: Seccion | null
  email: string | null
  onSalir: () => void
  onNavigate?: () => void
}

export function BarraLateral({ activo, email, onSalir, onNavigate }: Props) {
  const { oscuro, alternar } = useTema()

  return (
    <Flex direction="column" h="100%" minH={0} flex="1" overflow="auto" px={4} py={6} gap={8}>
      <Stack gap={8}>
        <Logotipo tamano="sm" />
        <Stack as="nav" aria-label="Secciones" gap={2}>
          {SECCIONES.map(({ id, to, etiqueta, Icono }) => {
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
        <Switch.Root
          size="sm"
          checked={oscuro}
          onCheckedChange={(detalle) => {
            if (detalle.checked !== oscuro) alternar()
          }}
        >
          <Switch.HiddenInput />
          <Switch.Control bg="bg.hover" _checked={{ bg: "marca.sol" }}>
            <Switch.Thumb bg="fg" _checked={{ bg: "marca.carbon" }} />
          </Switch.Control>
          <Switch.Label color="fg" fontSize="sm">
            Oscuro
          </Switch.Label>
        </Switch.Root>
        {email ? (
          <Text
            asChild
            display="block"
            minW={0}
            maxW="100%"
            fontSize="sm"
            color="fg.muted"
            bg="bg.hover"
            borderRadius="full"
            px={3}
            py={2}
            overflowWrap="anywhere"
            textDecoration="none"
            _hover={{ color: "fg", textDecoration: "none" }}
            _focusVisible={{ outline: "2px solid", outlineColor: "marca.sol", outlineOffset: "2px" }}
          >
            <Link to="/opciones" onClick={onNavigate} aria-label={`${email}, opciones`}>
              {email}
            </Link>
          </Text>
        ) : null}
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
