/**
 * sequence.ts — Matriz nSequence/nLockTime conforme README do desafio.
 *
 * Este módulo implementa EXATAMENTE os 5 casos da tabela do README.
 * Qualquer variação é erro de implementação.
 *
 * Este módulo é completamente agnóstico ao bitcoinjs-lib.
 * Todas as funções são puras — sem efeitos colaterais, sem I/O.
 */

import type { LocktimeType, SequenceResult } from './types.js'

// ─── Constantes nSequence ────────────────────────────────────────────────────

/** nSequence final: sem RBF, sem locktime */
export const SEQUENCE_FINAL = 0xffffffff

/** nSequence com locktime (sem RBF): habilita locktime sem sinalizar RBF */
export const SEQUENCE_LOCKTIME_NO_RBF = 0xfffffffe

/** nSequence RBF: sinaliza BIP-125 Replace-By-Fee */
export const SEQUENCE_RBF = 0xfffffffd

// ─── Lógica principal ─────────────────────────────────────────────────────────

/**
 * Calcula nSequence e nLockTime para todos os inputs da transação.
 *
 * Tabela completa (contrato inviolável do README):
 *
 * rbf          | locktime  | current_height | nSequence    | nLockTime
 * -------------|-----------|----------------|--------------|----------
 * false/absent | ausente   | —              | 0xFFFFFFFF   | 0
 * false/absent | presente  | —              | 0xFFFFFFFE   | locktime
 * true         | ausente   | presente       | 0xFFFFFFFD   | current_height  (anti-fee-sniping)
 * true         | presente  | —              | 0xFFFFFFFD   | locktime
 * true         | ausente   | ausente        | 0xFFFFFFFD   | 0
 *
 * @param rbf            - Fixture field `rbf` (undefined = false)
 * @param locktime       - Fixture field `locktime` (undefined = ausente)
 * @param currentHeight  - Fixture field `current_height` (undefined = ausente)
 */
export function computeSequence(
  rbf: boolean | undefined,
  locktime: number | undefined,
  currentHeight: number | undefined,
): SequenceResult {
  const rbfEnabled = rbf === true

  if (rbfEnabled) {
    // Todos os casos com rbf=true → nSequence = 0xFFFFFFFD
    const nSequence = SEQUENCE_RBF

    if (locktime !== undefined) {
      // Caso 4: rbf=true, locktime presente (independente de current_height)
      return { nSequence, nLockTime: locktime }
    }

    if (currentHeight !== undefined) {
      // Caso 3: rbf=true, sem locktime, com current_height → anti-fee-sniping
      return { nSequence, nLockTime: currentHeight }
    }

    // Caso 5: rbf=true, sem locktime, sem current_height
    return { nSequence, nLockTime: 0 }
  }

  // rbf=false ou ausente
  if (locktime !== undefined) {
    // Caso 2: sem RBF, com locktime → habilita locktime sem sinalizar RBF
    return { nSequence: SEQUENCE_LOCKTIME_NO_RBF, nLockTime: locktime }
  }

  // Caso 1: sem RBF, sem locktime → nSequence final
  return { nSequence: SEQUENCE_FINAL, nLockTime: 0 }
}

// ─── Classificação do locktime ────────────────────────────────────────────────

/**
 * Classifica o nLockTime conforme as regras do README.
 *
 * "none"            se nLockTime == 0
 * "block_height"    se 0 < nLockTime < 500_000_000
 * "unix_timestamp"  se nLockTime >= 500_000_000
 */
export function classifyLocktime(nLockTime: number): LocktimeType {
  if (nLockTime === 0) return 'none'
  if (nLockTime < 500_000_000) return 'block_height'
  return 'unix_timestamp'
}

// ─── Utilitário: rbf_signaling ────────────────────────────────────────────────

/**
 * Determina rbf_signaling para o relatório.
 * true se qualquer input tem nSequence <= 0xFFFFFFFD.
 * Como todos os inputs recebem o mesmo nSequence, basta verificar o valor.
 */
export function isRbfSignaling(nSequence: number): boolean {
  return nSequence <= SEQUENCE_RBF
}
