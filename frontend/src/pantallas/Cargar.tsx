import { Box, Heading, Stack, Text } from "@chakra-ui/react"
import { useNavigate } from "react-router"
import { CargaComprobante } from "../componentes/CargaComprobante"
import { guardarVista } from "../vistas"

export function Cargar() {
  const navigate = useNavigate()

  return (
    <Stack gap={{ base: 6, md: 8 }}>
      <Stack gap={2} maxW="40rem">
        <Heading
          as="h1"
          color="marca.carbon"
          fontSize={{ base: "2rem", md: "2.5rem" }}
          fontWeight="medium"
          letterSpacing="-0.03em"
          lineHeight="1.1"
        >
          Cargar comprobante
        </Heading>
        <Text color="fg.muted" fontSize={{ base: "md", md: "lg" }} lineHeight="1.5">
          Lo leemos y lo dejamos en borrador para que revises el monto antes de confirmarlo.
        </Text>
      </Stack>
      <Box
        bg="marca.papel"
        borderRadius="20px"
        px={{ base: 5, md: 10 }}
        py={{ base: 6, md: 10 }}
        boxShadow="0 12px 40px rgba(28, 27, 23, 0.06)"
      >
        <CargaComprobante
          onListo={(documento, archivo) => {
            guardarVista(documento.id, archivo)
            navigate(`/documentos/${documento.id}`)
          }}
        />
      </Box>
    </Stack>
  )
}
