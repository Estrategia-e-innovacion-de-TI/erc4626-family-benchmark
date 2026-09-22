# Benchmark académico: familia de estándares ERC-4626

Este directorio contiene implementaciones mínimas y aisladas de los EIPs que **realmente
extienden ERC-4626** (`Requires: EIP-4626` verificado uno a uno en [eips.ethereum.org/erc](https://eips.ethereum.org/erc)),
para comparar de forma didáctica qué problema resuelve cada uno. Se excluye explícitamente
toda la familia **ERC-7540** (vaults asíncronos) y cualquier EIP que dependa de ella.

## Estándares incluidos

| Contrato | EIP | Estado (eips.ethereum.org) | Qué añade sobre ERC-4626 base | Principal trade-off de seguridad |
|---|---|---|---|---|
| [`../TokenizedVault.sol`](../TokenizedVault.sol) | [4626](https://eips.ethereum.org/EIPS/eip-4626) | Final | Base del benchmark (sin fees/cap para la comparación) | Ataque de inflación en vault vacío (mitigable con `_decimalsOffset`) |
| `ERC5143Vault.sol` | [5143](https://eips.ethereum.org/EIPS/eip-5143) | Stagnant | Overloads con límites de slippage (`minShares`/`maxAssets`/`maxShares`/`minAssets`) | El límite protege solo el resultado de esa tx; no evita que el precio se mueva antes |
| `ERC6229Vault.sol` | [6229](https://eips.ethereum.org/EIPS/eip-6229) | Draft | Periodo de bloqueo por rondas (`lock`/`unlock`) con depósitos/redenciones agendados | Si quien controla `lock()`/`unlock()` nunca desbloquea, los fondos agendados quedan congelados |
| `ERC7535Vault.sol` | [7535](https://eips.ethereum.org/EIPS/eip-7535) | Final | ETH nativo como asset (`deposit`/`mint` payable) | `call` en el envío de ETH abre superficie de reentrancy; balance manipulable por `SELFDESTRUCT` |
| `ERC7575Share.sol` + `ERC7575Vault.sol` | [7575](https://eips.ethereum.org/EIPS/eip-7575) | Final | Share desacoplado del vault, compartido por varios entry points (multi-asset) | Cualquier vault registrado en el `Share` puede mintear/quemar shares; se confía en todos por igual |

Excluidos de forma explícita: ERC-7540 (async vaults) y todo lo que lo requiere como base
(ERC-7887, ERC-8161, ERC-8113). También se descartó ERC-5095 (Principal Token) porque su propio
texto evita extender ERC-4626 formalmente, y el patrón `ERC4626Fees` de OpenZeppelin porque no
es un EIP (es solo un ejemplo de referencia sin número de estándar).

## Cómo correrlo

```bash
# Tests de cada estándar (fixture compartido en test/standards/helpers.js)
npx hardhat test test/standards

# Benchmark de gas comparativo
npm run benchmark

# Cobertura de los contratos de este directorio
npx hardhat coverage --testfiles "test/standards/*.test.js"

# Desplegar los 5 contratos en localhost (lo mismo que usa el botón "Desplegar
# benchmark" de la UI web en web/benchmark.html)
npx hardhat run scripts/deploy-standards.js --network localhost
```

## Metodología

- Cada contrato es intencionalmente minimalista: implementa solo el mecanismo definido por su
  EIP, sin las features propias del PoC (`pause`, `depositCap`, fees) de `TokenizedVault.sol`.
- `test/standards/helpers.js` centraliza el fixture (mismo `MockAsset`, mismas cuentas, mismos
  montos) para que la comparación entre estándares use siempre las mismas condiciones de partida.
- `scripts/benchmark.js` mide gas de una "operación equivalente" por estándar, pero **no es una
  comparación función-por-función idéntica**: ERC-7535 paga en ETH nativo (sin `approve`/
  `transferFrom`) y ERC-7575 reparte el costo entre el `Vault` y el `Share` externo. La columna
  "Qué se compara" del reporte deja explícito el criterio usado en cada fila.
