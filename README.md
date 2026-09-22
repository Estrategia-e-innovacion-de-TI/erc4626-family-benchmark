# Benchmark: Familia de Estándares ERC-4626 para Vaults

Repositorio de investigación/comparación: implementa el **caso base** de ERC-4626 y otros 4 EIPs
que oficialmente lo extienden, bajo las mismas condiciones, para evidenciar (con tests y gas) qué
añade cada uno y qué trade-off de seguridad introduce. No es un producto; es un laboratorio para
sacar conclusiones fundamentadas sobre cuándo usar cada estándar.

- **Caso base** (`TokenizedVault.sol`): ERC-4626 de referencia, sin extensiones, usado como control
  del benchmark. Trae activo mintable de prueba, fuente de rentabilidad simulada, scripts de
  despliegue y una UI web local para depositar/retirar y observar el vault en vivo.
- **Estándares comparados** (`contracts/standards/`): implementaciones mínimas y aisladas de
  ERC-5143, ERC-6229, ERC-7535 y ERC-7575, cada una probada, documentada y disponible en la misma
  UI web. Excluye a propósito la familia ERC-7540 (vaults asíncronos). Ver el detalle completo en
  [contracts/standards/README.md](contracts/standards/README.md).

## Incluye

- Caso base ERC-4626 sin comisiones (`TokenizedVault.sol`) + activo mintable (`MockAsset.sol`) +
  fuente de rentabilidad simulada (`MockYieldSource.sol`).
- Los 4 estándares comparados: ERC-5143 (slippage), ERC-6229 (lock-in), ERC-7535 (ETH nativo),
  ERC-7575 (multi-asset).
- Suite de tests por estándar (~94% cobertura de statements) y un script de benchmark de gas.
- UI web local con una página por caso: el control (`index.html`) y los 4 estándares comparados
  (`benchmark.html`), ambas contra tu nodo Hardhat local.

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

`contracts/standards/` compara el caso base contra otros 4 EIPs que oficialmente extienden
ERC-4626 (`Requires: EIP-4626` verificado en eips.ethereum.org). Se excluye a propósito toda la
familia ERC-7540 (vaults asíncronos) y lo que dependa de ella.

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
npx hardhat run scripts/deploy-standards.js --network localhost
```

## Testnet Local En Tu PC

1. Abre una terminal y ejecuta `npm run node:local`.
2. En otra terminal, ejecuta `npm run deploy:local` para desplegar los contratos sobre esa red local persistente.
3. Si quieres ver el flujo completo de depósito, yield y redeem sobre la misma red, ejecuta `npm run demo:local`.
4. Los balances y contratos quedan vivos mientras el nodo local siga corriendo, así puedes abrir `hardhat console --network localhost` o volver a ejecutar scripts contra el mismo estado.

## Interfaz Web Local

1. Abre una terminal y ejecuta `npm run node:local`.
2. En otra terminal, ejecuta `npm run web:local`.
3. Abre `http://127.0.0.1:3000` (caso base ERC-4626) o `http://127.0.0.1:3000/benchmark.html`
   (los 4 estándares comparados; primero pulsa "Desplegar benchmark" ahí mismo).
4. En el caso base: depositar, simular rentabilidad, pausar, reanudar y redimir. En el benchmark:
   un panel por estándar con solo los botones necesarios para demostrar su mecanismo específico.

## Sepolia

Solo aplica al caso base (`TokenizedVault.sol`); los 4 estándares comparados son para
experimentación local (`localhost`), no se despliegan en testnet.

1. Copia `.env.example` a `.env` y completa `SEPOLIA_RPC_URL`, `SEPOLIA_PRIVATE_KEY` y `ETHERSCAN_API_KEY`.
2. Ejecuta `npm run deploy:sepolia` para desplegar `MockAsset`, `TokenizedVault` y `MockYieldSource`.
3. El vault queda desplegado con fee de entrada en 0 bps y cap ilimitado; luego puedes ajustar `setEntryFeeBps`, `setDepositCap`, `pause` y `unpause` desde la cuenta owner.

## Nota

Este repositorio es un benchmark académico/laboratorio, no un producto de producción. Ninguno
de los 5 contratos fue auditado; cada uno documenta en su NatSpec el trade-off de seguridad que
asume a cambio de mantenerse minimalista.