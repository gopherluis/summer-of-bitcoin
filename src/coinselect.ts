/**
 * coinselect.ts — Algoritmo greedy largest-first de seleção de UTXOs.
 *
 * Contrato do README:
 *   - strategy: "greedy" (campo obrigatório no relatório)
 *   - policy.max_inputs deve ser respeitado se presente
 *   - fee_estimada usa vbytes COM change output (estimativa conservadora)
 *     garantindo cobertura do pior caso antes do fee loop
 *
 * Dependências internas: vbytes.ts (estimateVbytesFromTypes), types.ts
 * Zero dependências externas.
 */

import type { Utxo, Payment, ScriptType } from './types.js'
import { StructuredError } from './types.js'
import { estimateVbytesFromTypes } from './vbytes.js'

// ─── Função principal ─────────────────────────────────────────────────────────

/**
 * Seleciona UTXOs usando estratégia greedy largest-first.
 *
 * @param utxos        - Pool de UTXOs disponíveis (do fixture)
 * @param payments     - Outputs de pagamento (valores fixos)
 * @param feeRateSatVb - Taxa alvo em sat/vB
 * @param changeType   - Script type do change output (para estimativa de tamanho)
 * @param maxInputs    - Limite de inputs (policy.max_inputs), undefined = sem limite
 *
 * @returns Array de UTXOs selecionados (subconjunto de utxos, ordem relevante preservada)
 *
 * @throws StructuredError('INSUFFICIENT_FUNDS') se não for possível cobrir payments + fee
 */
export function selectCoins(
  utxos: Utxo[],
  payments: Payment[],
  feeRateSatVb: number,
  changeType: ScriptType,
  maxInputs?: number,
): Utxo[] {
  const totalOut = payments.reduce((sum, p) => sum + p.value_sats, 0)
  const paymentTypes = payments.map(p => p.script_type)

  // Pré-condição: verificar se algum conjunto de UTXOs pode cobrir os payments.
  // Aplicar max_inputs antes desta verificação — o limite é uma política hard.
  const sorted = [...utxos].sort((a, b) => b.value_sats - a.value_sats)
  const candidates = maxInputs !== undefined ? sorted.slice(0, maxInputs) : sorted

  const totalAvailable = candidates.reduce((sum, u) => sum + u.value_sats, 0)
  if (totalAvailable < totalOut) {
    throw new StructuredError(
      'INSUFFICIENT_FUNDS',
      `Insufficient funds: available ${totalAvailable} sats (after max_inputs=${maxInputs ?? 'unlimited'} limit), ` +
      `need at least ${totalOut} sats for payments`,
    )
  }

  // Acumulação greedy: adicionar UTXOs até cobrir totalOut + fee estimada COM change.
  // Usar estimativa conservadora (com change) garante que os inputs selecionados
  // cobrem o pior caso. O fee loop em feecalc.ts resolve o valor exato.
  const selected: Utxo[] = []
  let totalIn = 0

  for (const utxo of candidates) {
    selected.push(utxo)
    totalIn += utxo.value_sats

    // Estimar fee com change para este conjunto de inputs
    const inputTypes = selected.map(u => u.script_type)
    const outputTypes = [...paymentTypes, changeType] // payments + change
    const vbytes = estimateVbytesFromTypes(inputTypes, outputTypes)
    const feeNeeded = Math.ceil(vbytes * feeRateSatVb)

    if (totalIn >= totalOut + feeNeeded) {
      return selected
    }
  }

  // Chegou ao fim de candidates sem cobrir — verifica antes se é SEND_ALL válido.
  // Quando o change seria dust ou negativo, feecalc cai no Passe 2 (sem change).
  // Nesse cenário, a condição é: totalIn >= totalOut + ceil(vbytes_sem_change × feeRate).
  const inputTypes = selected.map(u => u.script_type)
  const vbytesNoChange = estimateVbytesFromTypes(inputTypes, paymentTypes)
  const feeNeededNoChange = Math.ceil(vbytesNoChange * feeRateSatVb)

  if (totalIn >= totalOut + feeNeededNoChange) {
    // SEND_ALL válido — feecalc vai resolver no Passe 2
    return selected
  }

  // Nem com nem sem change há cobertura — INSUFFICIENT_FUNDS real
  const vbytesWithChange = estimateVbytesFromTypes(inputTypes, [...paymentTypes, changeType])
  const feeNeededWithChange = Math.ceil(vbytesWithChange * feeRateSatVb)

  throw new StructuredError(
    'INSUFFICIENT_FUNDS',
    `Insufficient funds: available ${totalIn} sats covers payments (${totalOut}) ` +
    `but not payments + minimum fee (${totalOut + feeNeededWithChange} sats needed, ` +
    `${feeNeededWithChange} sats fee at ${feeRateSatVb} sat/vB)`,
  )
}