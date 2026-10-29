import { Box, Flex, Text } from "@chakra-ui/react"
import { type JSX, type ReactNode } from "react"

export function FilaDato({
  icono,
  etiqueta,
  valor,
}: {
  icono: ReactNode
  etiqueta: string
  valor: string
}): JSX.Element {
  const texto = valor.trim() === "" ? "—" : valor.trim()

  return (
    <Flex align="center" columnGap={3} rowGap={1} minH="2.5rem" w="100%" wrap="wrap">
      <Flex
        align="center"
        justify="center"
        boxSize="28px"
        flexShrink={0}
        borderRadius="full"
        bg="bg.subtle"
        color="fg"
        borderWidth="1px"
        borderColor="borde"
      >
        {icono}
      </Flex>
      <Box
        display="grid"
        flex="1 1 12rem"
        minW={0}
        alignItems="center"
        columnGap={3}
        gridTemplateColumns="auto minmax(1rem, 1fr) minmax(0, 1fr)"
      >
        <Text fontSize="sm" lineHeight="1.35" color="fg.muted" overflowWrap="anywhere">
          {etiqueta}
        </Text>
        <Box
          aria-hidden="true"
          w="100%"
          alignSelf="center"
          borderBottomWidth="1px"
          borderBottomStyle="dotted"
          borderBottomColor="borde"
        />
        <Text
          minW={0}
          fontSize="sm"
          fontWeight="medium"
          lineHeight="1.35"
          color="fg"
          textAlign="right"
          overflowWrap="anywhere"
        >
          {texto}
        </Text>
      </Box>
    </Flex>
  )
}
