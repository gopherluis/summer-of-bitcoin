/**
 * tests/warnings.test.ts
 *
 * Testes unitários para src/warnings.ts e src/report.ts
 * Cobre: todos os 4 warning codes, múltiplos warnings simultâneos,
 * ausência de warnings, assembleReport, assembleErrorReport.
 */

import { describe, it, expect } from 'vitest'
import {
  collectWarnings,
  HIGH_FEE_ABS_THRESHOLD,
  HIGH_FEE_RATE_THRESHOLD,
} from '../src/warnings.js'
import { assembleReport, assembleErrorReport, assembleUnknownErrorReport } from '../src/report.js'
import { DUST_THRESHOLD } from '../src/feecalc.js'
import { StructuredError } from '../src/types.js'
import type { Utxo, OutputEntry } from '../src/types.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function codes(warnings: { code: string }[]): string[] {
  return warnings.map(w => w.code)
}

// ─── HIGH_FEE ─────────────────────────────────────────────────────────────────

describe('collectWarnings — HIGH_FEE', () => {
  it('emite HIGH_FEE quando fee > 1.000.000 sats', () => {
    const w = collectWarnings(1_000_001, 5, 10_000, false)
    expect(codes(w)).toContain('HIGH_FEE')
  })

  it('emite HIGH_FEE quando fee = 1.000.001 sats (boundary +1)', () => {
    expect(codes(collectWarnings(1_000_001, 5, 10_000, false))).toContain('HIGH_FEE')
  })

  it('NÃO emite HIGH_FEE quando fee = 1.000.000 sats (boundary exato)', () => {
    expect(codes(collectWarnings(1_000_000, 5, 10_000, false))).not.toContain('HIGH_FEE')
  })

  it('emite HIGH_FEE quando feeRate > 200 sat/vB', () => {
    expect(codes(collectWarnings(10_000, 201, 10_000, false))).toContain('HIGH_FEE')
  })

  it('emite HIGH_FEE quando feeRate = 200.01 sat/vB (boundary +ε)', () => {
    expect(codes(collectWarnings(10_000, 200.01, 10_000, false))).toContain('HIGH_FEE')
  })

  it('NÃO emite HIGH_FEE quando feeRate = 200 sat/vB (boundary exato)', () => {
    expect(codes(collectWarnings(10_000, 200, 10_000, false))).not.toContain('HIGH_FEE')
  })

  it('emite HIGH_FEE quando AMBOS fee e feeRate excedem limiar (apenas 1 entry)', () => {
    const w = collectWarnings(2_000_000, 300, 10_000, false)
    expect(codes(w).filter(c => c === 'HIGH_FEE')).toHaveLength(1)
  })

  it('constante HIGH_FEE_ABS_THRESHOLD = 1.000.000', () => {
    expect(HIGH_FEE_ABS_THRESHOLD).toBe(1_000_000)
  })

  it('constante HIGH_FEE_RATE_THRESHOLD = 200', () => {
    expect(HIGH_FEE_RATE_THRESHOLD).toBe(200)
  })
})

// ─── DUST_CHANGE ──────────────────────────────────────────────────────────────

describe('collectWarnings — DUST_CHANGE', () => {
  it('emite DUST_CHANGE quando change < 546', () => {
    expect(codes(collectWarnings(1_000, 5, 545, false))).toContain('DUST_CHANGE')
  })

  it('emite DUST_CHANGE quando change = 1 sat', () => {
    expect(codes(collectWarnings(1_000, 5, 1, false))).toContain('DUST_CHANGE')
  })

  it('NÃO emite DUST_CHANGE quando change = 546 (threshold mínimo válido)', () => {
    expect(codes(collectWarnings(1_000, 5, 546, false))).not.toContain('DUST_CHANGE')
  })

  it('NÃO emite DUST_CHANGE quando change = 547', () => {
    expect(codes(collectWarnings(1_000, 5, 547, false))).not.toContain('DUST_CHANGE')
  })

  it('NÃO emite DUST_CHANGE quando changeValue = null (SEND_ALL não é dust)', () => {
    expect(codes(collectWarnings(1_000, 5, null, false))).not.toContain('DUST_CHANGE')
  })
})

// ─── SEND_ALL ─────────────────────────────────────────────────────────────────

describe('collectWarnings — SEND_ALL', () => {
  it('emite SEND_ALL quando changeValue = null', () => {
    expect(codes(collectWarnings(1_000, 5, null, false))).toContain('SEND_ALL')
  })

  it('NÃO emite SEND_ALL quando changeValue é número', () => {
    expect(codes(collectWarnings(1_000, 5, 10_000, false))).not.toContain('SEND_ALL')
  })

  it('NÃO emite SEND_ALL quando changeValue = 0 (borda — improvável mas não null)', () => {
    expect(codes(collectWarnings(1_000, 5, 0, false))).not.toContain('SEND_ALL')
  })
})

// ─── RBF_SIGNALING ────────────────────────────────────────────────────────────

describe('collectWarnings — RBF_SIGNALING', () => {
  it('emite RBF_SIGNALING quando rbfSignaling = true', () => {
    expect(codes(collectWarnings(1_000, 5, 10_000, true))).toContain('RBF_SIGNALING')
  })

  it('NÃO emite RBF_SIGNALING quando rbfSignaling = false', () => {
    expect(codes(collectWarnings(1_000, 5, 10_000, false))).not.toContain('RBF_SIGNALING')
  })
})

// ─── Sem warnings ────────────────────────────────────────────────────────────

describe('collectWarnings — sem warnings', () => {
  it('retorna array vazio para transação normal', () => {
    // fee=1000 (<1M), feeRate=5 (<200), change=10000 (>=546), rbf=false
    const w = collectWarnings(1_000, 5, 10_000, false)
    expect(w).toHaveLength(0)
  })
})

// ─── Múltiplos warnings simultâneos ──────────────────────────────────────────

describe('collectWarnings — múltiplos warnings', () => {
  it('SEND_ALL + RBF_SIGNALING ao mesmo tempo', () => {
    const w = collectWarnings(1_000, 5, null, true)
    expect(codes(w)).toContain('SEND_ALL')
    expect(codes(w)).toContain('RBF_SIGNALING')
    expect(codes(w)).not.toContain('DUST_CHANGE')
  })

  it('HIGH_FEE + RBF_SIGNALING', () => {
    const w = collectWarnings(2_000_000, 5, 10_000, true)
    expect(codes(w)).toContain('HIGH_FEE')
    expect(codes(w)).toContain('RBF_SIGNALING')
    expect(w).toHaveLength(2)
  })

  it('todos os 4 warnings ao mesmo tempo', () => {
    // fee>1M, rate>200, change=100 (dust), rbf=true
    const w = collectWarnings(2_000_000, 300, 100, true)
    const c = codes(w)
    expect(c).toContain('HIGH_FEE')
    expect(c).toContain('DUST_CHANGE')
    expect(c).not.toContain('SEND_ALL') // change não é null
    expect(c).toContain('RBF_SIGNALING')
    expect(w).toHaveLength(3) // HIGH_FEE + DUST_CHANGE + RBF_SIGNALING (SEND_ALL não, change=100 != null)
  })

  it('HIGH_FEE + SEND_ALL + RBF_SIGNALING (sem change)', () => {
    const w = collectWarnings(2_000_000, 5, null, true)
    const c = codes(w)
    expect(c).toContain('HIGH_FEE')
    expect(c).toContain('SEND_ALL')
    expect(c).toContain('RBF_SIGNALING')
    expect(c).not.toContain('DUST_CHANGE')
    expect(w).toHaveLength(3)
  })
})

// ─── DUST_THRESHOLD importada ─────────────────────────────────────────────────

describe('DUST_THRESHOLD', () => {
  it('DUST_THRESHOLD de feecalc = 546', () => {
    expect(DUST_THRESHOLD).toBe(546)
  })
})

// ─── assembleReport ───────────────────────────────────────────────────────────

describe('assembleReport', () => {
  const mockInput: Utxo = {
    txid: 'a'.repeat(64), vout: 0, value_sats: 200_000,
    script_pubkey_hex: '0014' + 'ab'.repeat(20),
    script_type: 'p2wpkh', address: 'bc1q...',
  }
  const mockOutput: OutputEntry = {
    n: 0, value_sats: 100_000,
    script_pubkey_hex: '0014' + 'cd'.repeat(20),
    script_type: 'p2wpkh', address: 'bc1q...', is_change: false,
  }
  const mockChange: OutputEntry = {
    n: 1, value_sats: 10_000,
    script_pubkey_hex: '0014' + 'ef'.repeat(20),
    script_type: 'p2wpkh', address: 'bc1q...', is_change: true,
  }

  it('ok = true no relatório de sucesso', () => {
    const r = assembleReport({
      network: 'mainnet', selectedInputs: [mockInput],
      outputs: [mockOutput, mockChange], feeSats: 1_000, vbytes: 141,
      rbfSignaling: false, nLockTime: 0, locktimeType: 'none',
      psbtBase64: 'test==', warnings: [],
    })
    expect(r.ok).toBe(true)
  })

  it('strategy = "greedy"', () => {
    const r = assembleReport({
      network: 'mainnet', selectedInputs: [mockInput],
      outputs: [mockOutput], feeSats: 1_000, vbytes: 141,
      rbfSignaling: false, nLockTime: 0, locktimeType: 'none',
      psbtBase64: 'test==', warnings: [],
    })
    expect(r.strategy).toBe('greedy')
  })

  it('change_index = índice do output is_change=true', () => {
    const r = assembleReport({
      network: 'mainnet', selectedInputs: [mockInput],
      outputs: [mockOutput, mockChange], feeSats: 1_000, vbytes: 141,
      rbfSignaling: false, nLockTime: 0, locktimeType: 'none',
      psbtBase64: 'test==', warnings: [],
    })
    expect(r.change_index).toBe(1)
  })

  it('change_index = null quando nenhum output is_change=true (SEND_ALL)', () => {
    const r = assembleReport({
      network: 'mainnet', selectedInputs: [mockInput],
      outputs: [mockOutput], feeSats: 1_000, vbytes: 141,
      rbfSignaling: false, nLockTime: 0, locktimeType: 'none',
      psbtBase64: 'test==', warnings: [],
    })
    expect(r.change_index).toBeNull()
  })

  it('fee_rate_sat_vb = feeSats / vbytes (taxa efetiva)', () => {
    const r = assembleReport({
      network: 'mainnet', selectedInputs: [mockInput],
      outputs: [mockOutput], feeSats: 705, vbytes: 141,
      rbfSignaling: false, nLockTime: 0, locktimeType: 'none',
      psbtBase64: 'test==', warnings: [],
    })
    expect(r.fee_rate_sat_vb).toBe(705 / 141)
  })

  it('todos os campos obrigatórios presentes', () => {
    const r = assembleReport({
      network: 'mainnet', selectedInputs: [mockInput],
      outputs: [mockOutput], feeSats: 1_000, vbytes: 141,
      rbfSignaling: true, nLockTime: 850_000, locktimeType: 'block_height',
      psbtBase64: 'psbt==', warnings: [{ code: 'RBF_SIGNALING' }],
    })
    expect(r.network).toBe('mainnet')
    expect(r.rbf_signaling).toBe(true)
    expect(r.locktime).toBe(850_000)
    expect(r.locktime_type).toBe('block_height')
    expect(r.psbt_base64).toBe('psbt==')
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0].code).toBe('RBF_SIGNALING')
  })
})

// ─── assembleErrorReport ──────────────────────────────────────────────────────

describe('assembleErrorReport', () => {
  it('ok = false', () => {
    const r = assembleErrorReport(new StructuredError('INSUFFICIENT_FUNDS', 'not enough'))
    expect(r.ok).toBe(false)
  })

  it('error.code vem do StructuredError.code', () => {
    const r = assembleErrorReport(new StructuredError('INSUFFICIENT_FUNDS', 'not enough'))
    expect(r.error.code).toBe('INSUFFICIENT_FUNDS')
  })

  it('error.message vem do StructuredError.message', () => {
    const r = assembleErrorReport(new StructuredError('INVALID_FIXTURE', 'bad data'))
    expect(r.error.message).toBe('bad data')
  })

  it('assembleUnknownErrorReport: fallback para erro genérico', () => {
    const r = assembleUnknownErrorReport(new Error('unexpected'))
    expect(r.ok).toBe(false)
    expect(r.error.code).toBe('INTERNAL_ERROR')
    expect(r.error.message).toBe('unexpected')
  })

  it('assembleUnknownErrorReport: funciona com string', () => {
    const r = assembleUnknownErrorReport('something went wrong')
    expect(r.error.message).toBe('something went wrong')
  })
})
