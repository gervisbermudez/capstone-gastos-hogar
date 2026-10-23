import { Button, Container, Flex, Heading, Stack, Text } from "@chakra-ui/react"
import { Link, Navigate, Outlet, useLocation, useNavigate } from "react-router"
import { useSesion } from "../sesion"
import { Cargando } from "./Cargando"

export function MarcoPrivado() {
  const { token, listo, email, salir } = useSesion()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const tableroActivo = pathname === "/" || pathname.startsWith("/documentos")
  const chatActivo = pathname === "/chat" || pathname.startsWith("/chat/")

  if (!listo) return <Cargando texto="Cargando la sesión" />
  if (!token) return <Navigate to="/ingreso" replace />

  return (
    <Flex direction="column" minH="100vh" bg="bg">
      <Flex
        as="header"
        direction={{ base: "column", md: "row" }}
        gap={3}
        align={{ base: "stretch", md: "center" }}
        justify="space-between"
        px={{ base: 4, md: 6 }}
        py={3}
        borderBottomWidth="1px"
        bg="bg.panel"
      >
        <Stack gap={0}>
          <Heading size="md">Gastos del hogar</Heading>
          {email ? (
            <Text fontSize="sm" color="fg.muted">
              {email}
            </Text>
          ) : null}
        </Stack>
        <Flex gap={2} flexWrap="wrap">
          <Button asChild variant={tableroActivo ? "solid" : "ghost"} aria-current={tableroActivo ? "page" : undefined}>
            <Link to="/" aria-current={tableroActivo ? "page" : undefined}>
              Tablero
            </Link>
          </Button>
          <Button asChild variant={chatActivo ? "solid" : "ghost"} aria-current={chatActivo ? "page" : undefined}>
            <Link to="/chat" aria-current={chatActivo ? "page" : undefined}>
              Chat
            </Link>
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              salir()
              navigate("/ingreso", { replace: true })
            }}
          >
            Salir
          </Button>
        </Flex>
      </Flex>
      <Container maxW="6xl" py={{ base: 4, md: 8 }} px={{ base: 4, md: 6 }} flex="1">
        <Outlet />
      </Container>
    </Flex>
  )
}
