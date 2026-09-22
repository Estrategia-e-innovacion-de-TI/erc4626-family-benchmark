# Vault ERC-4626 y Benchmark de la Familia de Estándares de Vaults

Repositorio con dos partes:

1. **MVP de vault**: una implementación de referencia de ERC-4626 (`TokenizedVault.sol`) con
   activo mintable de prueba, fuente de rentabilidad simulada, scripts de despliegue y una UI
   web local para depositar/retirar y observar el vault en vivo.
2. **Benchmark académico** (`contracts/standards/`): implementaciones mínimas y aisladas de los
   demás EIPs que realmente extienden ERC-4626 (ERC-5143, ERC-6229, ERC-7535, ERC-7575),
   comparadas entre sí en tests y en un reporte de gas. Excluye a propósito la familia ERC-7540
   (vaults asíncronos). Ver el detalle en [contracts/standards/README.md](contracts/standards/README.md).

## Incluye

- Activo subyacente ERC20 propio y mintable para pruebas (`MockAsset.sol`).
- Vault ERC-4626 de referencia sin comisiones (`TokenizedVault.sol`).
- Fuente de rentabilidad simulada separada de la lógica del vault (`MockYieldSource.sol`).
- Pruebas de depósito, conversión, yield y retiro parcial.
- Benchmark académico de la familia de estándares ERC-4626 (ver más abajo).
- UI web local y scripts de despliegue para localhost/Sepolia.

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
npm run benchmark
```

## Benchmark de estándares ERC-4626

Un **benchmark** aquí significa: implementar cada estándar por separado, con el mismo activo
y las mismas condiciones de partida, para poder comparar de forma objetiva qué añade cada uno
sobre ERC-4626 base, cuánto cuesta en gas y qué riesgo de seguridad introduce. No es una
opinión sobre cuál es "mejor"; es la evidencia (tests + gas) para que cada quien saque su
propia conclusión sobre cuándo usar cada uno.

`contracts/standards/` compara ERC-4626 base contra otros 4 EIPs que oficialmente lo extienden
(`Requires: EIP-4626` verificado en eips.ethereum.org). Se excluye a propósito toda la familia
ERC-7540 (vaults asíncronos) y lo que dependa de ella.

| Estándar | Qué problema resuelve |
|---|---|
| **ERC-4626** (base) | Interfaz estándar de vault tokenizado: depositar un activo, recibir shares, redimir shares por activo. Sin esto, cada protocolo de yield inventa su propia interfaz y no son componibles entre sí. |
| **ERC-5143** | Protección de slippage para EOAs: añade `minShares`/`maxAssets`/`maxShares`/`minAssets` a depositar/retirar, para revertir si el precio por share cambió demasiado entre firmar y minar la transacción. |
| **ERC-6229** | Vault con periodo de bloqueo por rondas: permite congelar depósitos/retiros mientras una estrategia se ejecuta (p. ej. off-chain), agendando la operación (`scheduleDeposit`/`scheduleRedeem`) para liquidarla al precio vigente cuando se desbloquea. |
| **ERC-7535** | Vault con ETH nativo como activo: adapta `deposit`/`mint` a `payable` para que el vault funcione directamente con ETH, sin necesitar un wrapper ERC-20 como WETH. |
| **ERC-7575** | Vault multi-asset: separa el token de shares del contrato del vault, para que varios vaults (uno por activo) puedan compartir el mismo share — útil para LP tokens o vaults con múltiples puntos de entrada. |

Ver [contracts/standards/README.md](contracts/standards/README.md) para la ficha completa de
cada contrato (estado oficial del EIP, trade-off de seguridad principal) y la metodología
exacta de comparación.

```bash
npx hardhat test test/standards
npx hardhat coverage --testfiles "test/standards/*.test.js"
npm run benchmark
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