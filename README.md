# Vault ERC-4626 MVP

Implementación mínima de un vault ERC-4626 para pruebas de tokenización de fondos con rentabilidad simulada.

## Incluye

- Activo subyacente ERC20 propio y mintable para pruebas.
- Vault ERC-4626 sin comisiones.
- Fuente de rentabilidad simulada separada de la lógica del vault.
- Pruebas de depósito, conversión, yield y retiro parcial.

## Comandos

```bash
npm install
npm test
npm run build
npm run demo
npm run demo:local
npm run node:local
npm run deploy:local
npm run web:local
npm run deploy:sepolia
```

## Testnet Local En Tu PC

1. Abre una terminal y ejecuta `npm run node:local`.
2. En otra terminal, ejecuta `npm run deploy:local` para desplegar los contratos sobre esa red local persistente.
3. Si quieres ver el flujo completo de depósito, yield y redeem sobre la misma red, ejecuta `npm run demo:local`.
4. Los balances y contratos quedan vivos mientras el nodo local siga corriendo, así puedes abrir `hardhat console --network localhost` o volver a ejecutar scripts contra el mismo estado.

## Interfaz Web Local

1. Abre una terminal y ejecuta `npm run node:local`.
2. En otra terminal, ejecuta `npm run web:local`.
3. Abre `http://127.0.0.1:3000` en el navegador.
4. Usa los botones para desplegar, depositar, simular rentabilidad, pausar, reanudar y redimir.

## Sepolia

1. Copia `.env.example` a `.env` y completa `SEPOLIA_RPC_URL`, `SEPOLIA_PRIVATE_KEY` y `ETHERSCAN_API_KEY`.
2. Ejecuta `npm run deploy:sepolia` para desplegar `MockAsset`, `TokenizedVault` y `MockYieldSource`.
3. El vault queda desplegado con fee de entrada en 0 bps y cap ilimitado; luego puedes ajustar `setEntryFeeBps`, `setDepositCap`, `pause` y `unpause` desde la cuenta owner.

## Nota

Esto es un MVP para testnet o laboratorio. No incluye hardening de producción, controles de acceso avanzados ni estrategias de yield reales.