/**
 * warnings.ts — Coleta os 4 warning codes obrigatórios do README.
 *
 * Todos os 4 warnings são independentes entre si — múltiplos podem
 * ser emitidos ao mesmo tempo. A ordem do array não é especificada
 * pelo README, mas segue a ordem de definição abaixo para determinismo.
 *
 * Dependências internas: DUST_THRESHOLD de feecalc.ts, types.ts
 * Zero dependências externas.
 */

import type { WarningEntry } from './types.js'
import { DUST_THRESHOLD } from './feecalc.js'

// ─── Constantes de threshold ──────────────────────────────────────────────────

/** Fee absoluta máxima antes de emitir HIGH_FEE (sat) */
export const HIGH_FEE_ABS_THRESHOLD = 1_000_000

/** Fee rate máxima antes de emitir HIGH_FEE (sat/vB) */
export const HIGH_FEE_RATE_THRESHOLD = 200

// ─── Função principal ─────────────────────────────────────────────────────────

/**
 * Coleta os warnings aplicáveis ao resultado da transação.
 *
 * @param feeSats      - Fee total em satoshis (do FeeCalcResult)
 * @param feeRateSatVb - Taxa efetiva sat/vB (= feeSats / vbytes)
 * @param changeValue  - Valor do change (null = SEND_ALL, sem change)
 * @param rbfSignaling - true se nSequence <= 0xFFFFFFFD
 *
 * @returns Array de WarningEntry, possivelmente vazio
 */
export function collectWarnings(
  feeSats: number,
  feeRateSatVb: number,
  changeValue: number | null,
  rbfSignaling: boolean,
): WarningEntry[] {
  const warnings: WarningEntry[] = []

  // HIGH_FEE: fee absoluta > 1M sats OU taxa > 200 sat/vB
  if (feeSats > HIGH_FEE_ABS_THRESHOLD || feeRateSatVb > HIGH_FEE_RATE_THRESHOLD) {
    warnings.push({ code: 'HIGH_FEE' })
  }

  // DUST_CHANGE: change existe mas é menor que o limiar de dust
  // (changeValue null = SEND_ALL = sem change — não é dust, é intencional)
  if (changeValue !== null && changeValue < DUST_THRESHOLD) {
    warnings.push({ code: 'DUST_CHANGE' })
  }

  // SEND_ALL: nenhum change output foi criado
  if (changeValue === null) {
    warnings.push({ code: 'SEND_ALL' })
  }

  // RBF_SIGNALING: transação sinaliza RBF (BIP-125)
  if (rbfSignaling) {
    warnings.push({ code: 'RBF_SIGNALING' })
  }

  return warnings
}
