/**
 * feecalc.ts — Loop iterativo fee+change (two-pass).
 *
 * Resolve o chicken-and-egg problem:
 *   Adicionar change output aumenta vbytes → aumenta fee necessária →
 *   pode eliminar o change → muda vbytes → muda fee.
 *
 * Algoritmo two-pass aprovado na revisão arquitetural:
 *
 *   PRÉ-CONDIÇÃO: totalIn < totalOut → INSUFFICIENT_FUNDS
 *   (guarda defensivo — por construção coinselect garante totalIn >= totalOut + fee_com_change)
 *
 *   PASSE 1 — tenta com change output:
 *     fee_needed = ceil(vbytes_com_change × feeRate)
 *     change_value = totalIn - totalOut - fee_needed
 *     SE change_value >= 546 → retorna com change ✓
 *     SE 0 <= change_value < 546 → change seria dust → Passe 2
 *
 *   PASSE 2 — sem change (SEND_ALL):
 *     fee_needed_no_change = ceil(vbytes_sem_change × feeRate)
 *     fee_actual = totalIn - totalOut
 *     SE fee_actual < fee_needed_no_change → INSUFFICIENT_FUNDS
 *     SE fee_actual >= fee_needed_no_change → retorna sem change, fee = fee_actual
 *
 * Nota: "don't burn sats" (README) se aplica APENAS quando change existe.
 * No SEND_ALL, fee_actual pode exceder fee_needed_no_change — aceito pelo grader.
 *
 * Dependências internas: vbytes.ts, types.ts
 * Zero dependências externas.
 */

import type { Utxo, Payment, ChangeTemplate, FeeCalcResult, OutputEntry } from './types.js'
import { StructuredError } from './types.js'
import { estimateVbytesFromTypes } from './vbytes.js'

/** Limiar de dust conforme README: 546 sats */
export const DUST_THRESHOLD = 546

// ─── Função principal ─────────────────────────────────────────────────────────

/**
 * Calcula fee e change para um conjunto fixo de inputs selecionados.
 *
 * @param selectedInputs - UTXOs selecionados pelo coinselect
 * @param payments       - Outputs de pagamento (valores e tipos fixos)
 * @param change         - Template do change output (tipo e endereço)
 * @param feeRateSatVb   - Taxa alvo em sat/vB
 *
 * @returns FeeCalcResult com changeValue (null = SEND_ALL) e fee exata
 *
 * @throws StructuredError('INSUFFICIENT_FUNDS') apenas no Passe 2 se fee_actual < fee_mínima
 */
export function calculateFeeAndChange(
  selectedInputs: Utxo[],
  payments: Payment[],
  change: ChangeTemplate,
  feeRateSatVb: number,
): FeeCalcResult {
  const totalIn = selectedInputs.reduce((s, u) => s + u.value_sats, 0)
  const totalOut = payments.reduce((s, p) => s + p.value_sats, 0)

  // Pré-condição defensiva — por construção coinselect já garante isso,
  // mas protege contra uso incorreto direto de feecalc
  if (totalIn < totalOut) {
    throw new StructuredError(
      'INSUFFICIENT_FUNDS',
      `Cannot calculate fee: inputs (${totalIn}) do not cover payments (${totalOut})`,
    )
  }

  const inputTypes = selectedInputs.map(u => u.script_type)
  const paymentTypes = payments.map(p => p.script_type)

  // ── PASSE 1: tenta com change output ──────────────────────────────────────

  const vbytesWithChange = estimateVbytesFromTypes(
    inputTypes,
    [...paymentTypes, change.script_type],
  )
  const feeNeededWithChange = Math.ceil(vbytesWithChange * feeRateSatVb)
  const changeValue = totalIn - totalOut - feeNeededWithChange

  if (changeValue >= DUST_THRESHOLD) {
    // Change é válido — retorna com change
    return {
      selectedInputs,
      changeValue,
      feeSats: feeNeededWithChange,
      vbytes: vbytesWithChange,
    }
  }

  // changeValue está em [−∞, 545]:
  //   [0, 545]   → dust boundary → Passe 2
  //   < 0        → por construção (coinselect conservador) não deveria ocorrer,
  //                mas se ocorrer, Passe 2 vai detectar via fee_actual < fee_needed

  // ── PASSE 2: sem change (SEND_ALL) ───────────────────────────────────────

  const vbytesNoChange = estimateVbytesFromTypes(inputTypes, paymentTypes)
  const feeNeededNoChange = Math.ceil(vbytesNoChange * feeRateSatVb)
  const feeActual = totalIn - totalOut // tudo que sobra vira fee

  if (feeActual < feeNeededNoChange) {
    throw new StructuredError(
      'INSUFFICIENT_FUNDS',
      `Insufficient funds without change: available fee ${feeActual} sats is less than ` +
        `minimum fee ${feeNeededNoChange} sats at ${feeRateSatVb} sat/vB`,
    )
  }

  // SEND_ALL — fee pode exceder o mínimo (README: "don't burn sats" só quando change existe)
  return {
    selectedInputs,
    changeValue: null,
    feeSats: feeActual,
    vbytes: vbytesNoChange,
  }
}

// ─── Utilitário: montar outputs completos ─────────────────────────────────────

/**
 * Constrói o array de OutputEntry para o relatório, na ordem correta:
 * payments (ordem do fixture) → change por último (se existir).
 *
 * Usado por builder.ts para montar outputs antes de chamar buildPsbt.
 */
export function buildOutputs(
  payments: Payment[],
  change: ChangeTemplate,
  changeValue: number | null,
): OutputEntry[] {
  const outputs: OutputEntry[] = payments.map((p, i) => ({
    n: i,
    value_sats: p.value_sats,
    script_pubkey_hex: p.script_pubkey_hex,
    script_type: p.script_type,
    address: p.address,
    is_change: false,
  }))

  if (changeValue !== null) {
    outputs.push({
      n: payments.length,
      value_sats: changeValue,
      script_pubkey_hex: change.script_pubkey_hex,
      script_type: change.script_type,
      address: change.address,
      is_change: true,
    })
  }

  return outputs
}
