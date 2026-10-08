/**
 * tests/sequence.test.ts
 *
 * Testes unitários para src/sequence.ts
 * Cobre os 5 casos exatos da matriz RBF/locktime do README.
 * Qualquer variação é erro de implementação — tolerância zero.
 */

import { describe, it, expect } from 'vitest'
import {
  computeSequence,
  classifyLocktime,
  isRbfSignaling,
  SEQUENCE_FINAL,
  SEQUENCE_LOCKTIME_NO_RBF,
  SEQUENCE_RBF,
} from '../src/sequence.js'

// ─── Constantes esperadas ─────────────────────────────────────────────────────

describe('constantes de nSequence', () => {
  it('SEQUENCE_FINAL = 0xFFFFFFFF', () => expect(SEQUENCE_FINAL).toBe(0xffffffff))
  it('SEQUENCE_LOCKTIME_NO_RBF = 0xFFFFFFFE', () => expect(SEQUENCE_LOCKTIME_NO_RBF).toBe(0xfffffffe))
  it('SEQUENCE_RBF = 0xFFFFFFFD', () => expect(SEQUENCE_RBF).toBe(0xfffffffd))
})

// ─── Os 5 casos exatos da matriz do README ────────────────────────────────────

describe('computeSequence — 5 casos da matriz RBF/locktime', () => {
  /**
   * Caso 1: rbf false/absent, sem locktime
   * nSequence = 0xFFFFFFFF, nLockTime = 0
   */
  it('CASO 1 — rbf absent, sem locktime → nSeq=0xFFFFFFFF, nLock=0', () => {
    const r = computeSequence(undefined, undefined, undefined)
    expect(r.nSequence).toBe(0xffffffff)
    expect(r.nLockTime).toBe(0)
  })

  it('CASO 1 — rbf=false explícito, sem locktime → nSeq=0xFFFFFFFF, nLock=0', () => {
    const r = computeSequence(false, undefined, undefined)
    expect(r.nSequence).toBe(0xffffffff)
    expect(r.nLockTime).toBe(0)
  })

  /**
   * Caso 2: rbf false/absent, locktime presente
   * nSequence = 0xFFFFFFFE, nLockTime = locktime
   */
  it('CASO 2 — rbf absent, locktime=850000 → nSeq=0xFFFFFFFE, nLock=850000', () => {
    const r = computeSequence(undefined, 850000, undefined)
    expect(r.nSequence).toBe(0xfffffffe)
    expect(r.nLockTime).toBe(850000)
  })

  it('CASO 2 — rbf=false, locktime=850000 → nSeq=0xFFFFFFFE, nLock=850000', () => {
    const r = computeSequence(false, 850000, undefined)
    expect(r.nSequence).toBe(0xfffffffe)
    expect(r.nLockTime).toBe(850000)
  })

  it('CASO 2 — current_height ignorado quando rbf=false com locktime', () => {
    // current_height não afeta o resultado quando rbf=false
    const r = computeSequence(false, 850000, 849000)
    expect(r.nSequence).toBe(0xfffffffe)
    expect(r.nLockTime).toBe(850000)
  })

  /**
   * Caso 3: rbf=true, sem locktime, com current_height → anti-fee-sniping
   * nSequence = 0xFFFFFFFD, nLockTime = current_height
   */
  it('CASO 3 — rbf=true, sem locktime, current_height=850000 → nSeq=0xFFFFFFFD, nLock=850000', () => {
    const r = computeSequence(true, undefined, 850000)
    expect(r.nSequence).toBe(0xfffffffd)
    expect(r.nLockTime).toBe(850000)
  })

  it('CASO 3 — anti-fee-sniping com height diferente', () => {
    const r = computeSequence(true, undefined, 123456)
    expect(r.nSequence).toBe(0xfffffffd)
    expect(r.nLockTime).toBe(123456)
  })

  /**
   * Caso 4: rbf=true, locktime presente
   * nSequence = 0xFFFFFFFD, nLockTime = locktime
   * (current_height ignorado quando locktime explícito está presente)
   */
  it('CASO 4 — rbf=true, locktime=850000 → nSeq=0xFFFFFFFD, nLock=850000', () => {
    const r = computeSequence(true, 850000, undefined)
    expect(r.nSequence).toBe(0xfffffffd)
    expect(r.nLockTime).toBe(850000)
  })

  it('CASO 4 — locktime tem prioridade sobre current_height quando rbf=true', () => {
    // locktime explícito prevalece sobre current_height (anti-fee-sniping)
    const r = computeSequence(true, 850000, 849000)
    expect(r.nSequence).toBe(0xfffffffd)
    expect(r.nLockTime).toBe(850000) // locktime, NÃO current_height
  })

  /**
   * Caso 5: rbf=true, sem locktime, sem current_height
   * nSequence = 0xFFFFFFFD, nLockTime = 0
   */
  it('CASO 5 — rbf=true, sem locktime, sem current_height → nSeq=0xFFFFFFFD, nLock=0', () => {
    const r = computeSequence(true, undefined, undefined)
    expect(r.nSequence).toBe(0xfffffffd)
    expect(r.nLockTime).toBe(0)
  })
})

// ─── classifyLocktime ─────────────────────────────────────────────────────────

describe('classifyLocktime', () => {
  it('0 → "none"', () => expect(classifyLocktime(0)).toBe('none'))

  it('1 → "block_height"', () => expect(classifyLocktime(1)).toBe('block_height'))

  it('850000 → "block_height"', () => expect(classifyLocktime(850000)).toBe('block_height'))

  it('499_999_999 → "block_height" (boundary inferior do timestamp)', () => {
    // Fixture locktime_boundary_block.json testa exatamente esse valor
    expect(classifyLocktime(499_999_999)).toBe('block_height')
  })

  it('500_000_000 → "unix_timestamp" (boundary)', () => {
    // Fixture locktime_boundary_timestamp.json testa exatamente esse valor
    expect(classifyLocktime(500_000_000)).toBe('unix_timestamp')
  })

  it('500_000_001 → "unix_timestamp"', () => {
    expect(classifyLocktime(500_000_001)).toBe('unix_timestamp')
  })

  it('1_700_000_000 → "unix_timestamp" (timestamp Unix real)', () => {
    expect(classifyLocktime(1_700_000_000)).toBe('unix_timestamp')
  })

  it('0xFFFFFFFF (max uint32) → "unix_timestamp"', () => {
    expect(classifyLocktime(0xffffffff)).toBe('unix_timestamp')
  })
})

// ─── isRbfSignaling ───────────────────────────────────────────────────────────

describe('isRbfSignaling', () => {
  it('nSequence = 0xFFFFFFFD → true (sinaliza RBF)', () => {
    expect(isRbfSignaling(0xfffffffd)).toBe(true)
  })

  it('nSequence < 0xFFFFFFFD → true (qualquer valor abaixo sinaliza RBF)', () => {
    expect(isRbfSignaling(0)).toBe(true)
    expect(isRbfSignaling(1)).toBe(true)
    expect(isRbfSignaling(0xfffffffc)).toBe(true)
  })

  it('nSequence = 0xFFFFFFFE → false (locktime sem RBF)', () => {
    expect(isRbfSignaling(0xfffffffe)).toBe(false)
  })

  it('nSequence = 0xFFFFFFFF → false (final, sem RBF)', () => {
    expect(isRbfSignaling(0xffffffff)).toBe(false)
  })
})

// ─── Integração: fixtures públicos conhecidos ─────────────────────────────────

describe('computeSequence — fixtures públicos conhecidos', () => {
  it('anti_fee_sniping: rbf=true, sem locktime, current_height=850000', () => {
    const r = computeSequence(true, undefined, 850000)
    expect(r).toEqual({ nSequence: 0xfffffffd, nLockTime: 850000 })
    expect(classifyLocktime(r.nLockTime)).toBe('block_height')
    expect(isRbfSignaling(r.nSequence)).toBe(true)
  })

  it('rbf_with_locktime: rbf=true, locktime=850000', () => {
    const r = computeSequence(true, 850000, undefined)
    expect(r).toEqual({ nSequence: 0xfffffffd, nLockTime: 850000 })
    expect(classifyLocktime(r.nLockTime)).toBe('block_height')
  })

  it('locktime_no_rbf: rbf=false, locktime=850000', () => {
    const r = computeSequence(false, 850000, undefined)
    expect(r).toEqual({ nSequence: 0xfffffffe, nLockTime: 850000 })
    expect(isRbfSignaling(r.nSequence)).toBe(false)
  })

  it('rbf_false_explicit: rbf=false, sem locktime → nSeq=final, nLock=0', () => {
    const r = computeSequence(false, undefined, undefined)
    expect(r).toEqual({ nSequence: 0xffffffff, nLockTime: 0 })
    expect(classifyLocktime(r.nLockTime)).toBe('none')
    expect(isRbfSignaling(r.nSequence)).toBe(false)
  })

  it('locktime_unix_timestamp: nLockTime=1700000000', () => {
    const r = computeSequence(false, 1_700_000_000, undefined)
    expect(r.nLockTime).toBe(1_700_000_000)
    expect(classifyLocktime(r.nLockTime)).toBe('unix_timestamp')
  })

  it('locktime_boundary_block: nLockTime=499999999 → block_height', () => {
    const r = computeSequence(false, 499_999_999, undefined)
    expect(classifyLocktime(r.nLockTime)).toBe('block_height')
  })

  it('locktime_boundary_timestamp: nLockTime=500000000 → unix_timestamp', () => {
    const r = computeSequence(false, 500_000_000, undefined)
    expect(classifyLocktime(r.nLockTime)).toBe('unix_timestamp')
  })
})
