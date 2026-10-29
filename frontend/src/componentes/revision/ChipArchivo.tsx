import { Flex, Text } from "@chakra-ui/react"
import { type JSX } from "react"

const BALDOSAS = {
  pdf: { bg: "marca.sol", texto: "PDF" },
  imagen: { bg: "#d9e4f2", texto: "IMG" },
  otro: { bg: "marca.alabastro", texto: "ARCH" },
} as const

export function ChipArchivo({ nombre, tipo }: { nombre: string; tipo: "pdf" | "imagen" | "otro" }): JSX.Element {
  const baldosa = BALDOSAS[tipo]
  const visible = nombre.trim() === "" ? "Archivo" : nombre.trim()

  return (
    <Flex
      display="inline-flex"
      align="center"
      gap={2.5}
      maxW="100%"
      minW={0}
      w="fit-content"
      overflow="hidden"
      bg="bg.panel"
      borderWidth="1px"
      borderStyle="solid"
      borderColor="borde"
      borderRadius="16px"
      py={1.5}
      ps={1.5}
      pe={3}
      title={nombre.trim() === "" ? undefined : nombre.trim()}
    >
      <Flex
        align="center"
        justify="center"
        flexShrink={0}
        h="32px"
        minW="40px"
        px={1.5}
        borderRadius="10px"
        bg={baldosa.bg}
        color="marca.carbon"
        fontSize="2xs"
        fontWeight="medium"
        letterSpacing="0.04em"
        lineHeight="1"
      >
        {baldosa.texto}
      </Flex>
      <Text
        flex="0 1 auto"
        minW={0}
        fontSize="sm"
        fontWeight="medium"
        lineHeight="1.3"
        color="fg"
        overflow="hidden"
        textOverflow="ellipsis"
        whiteSpace="nowrap"
      >
        {visible}
      </Text>
    </Flex>
  )
}
