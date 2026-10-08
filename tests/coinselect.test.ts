/**
 * tests/coinselect.test.ts
 *
 * Testes unitários para src/coinselect.ts
 * Cobre: seleção básica, múltiplos inputs, max_inputs, INSUFFICIENT_FUNDS,
 * ordenação largest-first, fee_estimada conservadora (com change).
 */

import { describe, it, expect } from 'vitest'
import { selectCoins } from '../src/coinselect.js'
import { StructuredError } from '../src/types.js'
import type { Utxo, Payment } from '../src/types.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeUtxo(value: number, type = 'p2wpkh', index = 0): Utxo {
  return {
    txid: index.toString(16).padStart(64, '0'),
    vout: 0,
    value_sats: value,
    script_pubkey_hex: '0014' + 'ab'.repeat(20),
    script_type: type as any,
    address: 'bc1q...',
  }
}

function makePayment(value: number, type = 'p2wpkh'): Payment {
  return {
    address: 'bc1q...',
    script_pubkey_hex: '0014' + 'cd'.repeat(20),
    script_type: type as any,
    value_sats: value,
  }
}

// ─── Seleção básica ───────────────────────────────────────────────────────────

describe('selectCoins — seleção básica', () => {
  it('seleciona único UTXO suficiente para cobrir payment + fee', () => {
    const utxos = [makeUtxo(100_000)]
    const payments = [makePayment(70_000)]
    const selected = selectCoins(utxos, payments, 5, 'p2wpkh')
    expect(selected).toHaveLength(1)
    expect(selected[0].value_sats).toBe(100_000)
  })

  it('retorna subconjunto dos UTXOs originais (não cria novos)', () => {
    const utxos = [makeUtxo(200_000, 'p2wpkh', 0), makeUtxo(50_000, 'p2wpkh', 1)]
    const payments = [makePayment(60_000)]
    const selected = selectCoins(utxos, payments, 1, 'p2wpkh')
    // O maior UTXO (200_000) deve ser selecionado sozinho
    expect(selected).toHaveLength(1)
    expect(selected[0].txid).toBe(utxos[0].txid)
  })

  it('ordem de seleção é largest-first (independente da ordem no array)', () => {
    // UTXOs em ordem crescente — deve selecionar o maior primeiro
    const utxos = [
      makeUtxo(10_000, 'p2wpkh', 0),
      makeUtxo(50_000, 'p2wpkh', 1),
      makeUtxo(200_000, 'p2wpkh', 2),
    ]
    const payments = [makePayment(40_000)]
    const selected = selectCoins(utxos, payments, 1, 'p2wpkh')
    expect(selected).toHaveLength(1)
    expect(selected[0].value_sats).toBe(200_000)
  })
})

// ─── Múltiplos inputs necessários ────────────────────────────────────────────

describe('selectCoins — múltiplos inputs', () => {
  it('seleciona múltiplos UTXOs quando um não é suficiente', () => {
    const utxos = [
      makeUtxo(30_000, 'p2wpkh', 0),
      makeUtxo(30_000, 'p2wpkh', 1),
      makeUtxo(30_000, 'p2wpkh', 2),
    ]
    const payments = [makePayment(70_000)]
    const selected = selectCoins(utxos, payments, 5, 'p2wpkh')
    // Precisa de pelo menos 3 × 30_000 = 90_000 para cobrir 70_000 + fee
    expect(selected.length).toBeGreaterThanOrEqual(2)
    const totalIn = selected.reduce((s, u) => s + u.value_sats, 0)
    expect(totalIn).toBeGreaterThanOrEqual(70_000)
  })

  it('para de selecionar ao atingir cobertura suficiente (não seleciona tudo)', () => {
    // UTXO grande + vários pequenos — deve usar só o grande
    const utxos = [
      makeUtxo(500_000, 'p2wpkh', 0),
      makeUtxo(10_000, 'p2wpkh', 1),
      makeUtxo(10_000, 'p2wpkh', 2),
      makeUtxo(10_000, 'p2wpkh', 3),
    ]
    const payments = [makePayment(100_000)]
    const selected = selectCoins(utxos, payments, 1, 'p2wpkh')
    expect(selected).toHaveLength(1)
    expect(selected[0].value_sats).toBe(500_000)
  })

  it('fee estimada com change aumenta com cada input adicionado', () => {
    // Teste indireto: com fee_rate alto, mais inputs = mais fee = mais UTXOs necessários
    // 10 UTXOs × 20_000 = 200_000 total — suficiente mesmo a 50 sat/vB com 10 inputs
    const utxos = Array.from({ length: 10 }, (_, i) => makeUtxo(20_000, 'p2wpkh', i))
    const payments = [makePayment(80_000)]
    // Com fee_rate=1, poucos inputs cobrem; com fee_rate=50, precisamos de mais
    const selectedLow = selectCoins(utxos, payments, 1, 'p2wpkh')
    const selectedHigh = selectCoins(utxos, payments, 50, 'p2wpkh')
    expect(selectedHigh.length).toBeGreaterThanOrEqual(selectedLow.length)
  })
})

// ─── policy.max_inputs ────────────────────────────────────────────────────────

describe('selectCoins — policy.max_inputs', () => {
  it('respeita max_inputs=1: usa apenas 1 UTXO mesmo que insuficiente', () => {
    // 1 UTXO de 100_000, payment de 90_000 — deve funcionar com max_inputs=1
    const utxos = [makeUtxo(100_000, 'p2wpkh', 0), makeUtxo(100_000, 'p2wpkh', 1)]
    const payments = [makePayment(90_000)]
    const selected = selectCoins(utxos, payments, 1, 'p2wpkh', 1)
    expect(selected).toHaveLength(1)
  })

  it('lança INSUFFICIENT_FUNDS quando max_inputs limita cobertura', () => {
    // Cada UTXO tem 50_000, payment é 90_000 — precisa de 2, mas max_inputs=1
    const utxos = [makeUtxo(50_000, 'p2wpkh', 0), makeUtxo(50_000, 'p2wpkh', 1)]
    const payments = [makePayment(90_000)]
    expect(() => selectCoins(utxos, payments, 1, 'p2wpkh', 1)).toThrow(StructuredError)
  })

  it('max_inputs aplica-se aos top-N por valor (largest-first antes de limitar)', () => {
    // UTXOs: 10_000, 50_000, 200_000 — com max_inputs=2, candidatos são 200_000 e 50_000
    const utxos = [
      makeUtxo(10_000, 'p2wpkh', 0),
      makeUtxo(50_000, 'p2wpkh', 1),
      makeUtxo(200_000, 'p2wpkh', 2),
    ]
    const payments = [makePayment(40_000)]
    const selected = selectCoins(utxos, payments, 1, 'p2wpkh', 2)
    // Deve selecionar 200_000 (suficiente sozinho, é o maior)
    expect(selected).toHaveLength(1)
    expect(selected[0].value_sats).toBe(200_000)
  })

  it('max_inputs=5 permite até 5 UTXOs', () => {
    const utxos = Array.from({ length: 10 }, (_, i) => makeUtxo(10_000, 'p2wpkh', i))
    const payments = [makePayment(40_000)]
    const selected = selectCoins(utxos, payments, 1, 'p2wpkh', 5)
    expect(selected.length).toBeLessThanOrEqual(5)
  })
})

// ─── INSUFFICIENT_FUNDS ───────────────────────────────────────────────────────

describe('selectCoins — INSUFFICIENT_FUNDS', () => {
  it('lança quando pool está vazio', () => {
    expect(() =>
      selectCoins([], [makePayment(10_000)], 1, 'p2wpkh'),
    ).toThrow(StructuredError)
  })

  it('lança quando totalIn < totalOut (sem considerar fee)', () => {
    const utxos = [makeUtxo(5_000)]
    const payments = [makePayment(10_000)]
    try {
      selectCoins(utxos, payments, 1, 'p2wpkh')
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(StructuredError)
      expect((e as StructuredError).code).toBe('INSUFFICIENT_FUNDS')
    }
  })

  it('lança quando UTXOs cobrem payments mas não payments + fee', () => {
    // 10_000 sats, payment de 9_999 — sobra 1 sat, fee mínima é >> 1 sat
    const utxos = [makeUtxo(10_000)]
    const payments = [makePayment(9_999)]
    try {
      selectCoins(utxos, payments, 5, 'p2wpkh')
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(StructuredError)
      expect((e as StructuredError).code).toBe('INSUFFICIENT_FUNDS')
    }
  })

  it('mensagem de erro é descritiva e não-vazia', () => {
    try {
      selectCoins([makeUtxo(100)], [makePayment(50_000)], 1, 'p2wpkh')
    } catch (e) {
      expect((e as StructuredError).message.length).toBeGreaterThan(10)
    }
  })
})

// ─── fee_estimada conservadora (com change) ───────────────────────────────────

describe('selectCoins — fee estimada com change output', () => {
  it('seleciona inputs suficientes para cobrir payments + fee COM change', () => {
    // Verificação que a estimativa inclui o change output:
    // Um UTXO de exatamente payments + fee_sem_change pode não ser suficiente
    // se a fee_com_change for maior
    const utxos = [makeUtxo(200_000)]
    const payments = [makePayment(100_000)]
    const selected = selectCoins(utxos, payments, 10, 'p2wpkh')
    // Deve selecionar com sucesso — 200_000 cobre 100_000 + fee_com_change
    expect(selected).toHaveLength(1)
    const totalIn = selected.reduce((s, u) => s + u.value_sats, 0)
    expect(totalIn).toBe(200_000)
  })

  it('múltiplos payments: totalOut = soma de todos', () => {
    const utxos = [makeUtxo(500_000)]
    const payments = [makePayment(100_000), makePayment(150_000), makePayment(200_000)]
    const selected = selectCoins(utxos, payments, 1, 'p2wpkh')
    expect(selected).toHaveLength(1)
  })
})

// ─── Tipos de script mistos ───────────────────────────────────────────────────

describe('selectCoins — múltiplos script types', () => {
  it('funciona com UTXOs p2tr', () => {
    const utxos = [makeUtxo(100_000, 'p2tr')]
    const payments = [makePayment(50_000)]
    const selected = selectCoins(utxos, payments, 5, 'p2wpkh')
    expect(selected).toHaveLength(1)
  })

  it('funciona com UTXOs p2pkh', () => {
    const utxos = [makeUtxo(100_000, 'p2pkh')]
    const payments = [makePayment(50_000)]
    const selected = selectCoins(utxos, payments, 5, 'p2wpkh')
    expect(selected).toHaveLength(1)
  })

  it('funciona com pool misto p2wpkh + p2tr + p2pkh (fixture large_mixed)', () => {
    const utxos = [
      ...Array.from({ length: 5 }, (_, i) => makeUtxo(15_000, 'p2tr', i)),
      ...Array.from({ length: 5 }, (_, i) => makeUtxo(10_000, 'p2wpkh', i + 10)),
      ...Array.from({ length: 5 }, (_, i) => makeUtxo(8_000, 'p2pkh', i + 20)),
    ]
    const payments = [makePayment(60_000)]
    const selected = selectCoins(utxos, payments, 5, 'p2wpkh')
    // Deve selecionar os maiores (p2tr @ 15_000 cada) primeiro
    expect(selected.every(u => u.value_sats >= 10_000)).toBe(true)
    const totalIn = selected.reduce((s, u) => s + u.value_sats, 0)
    expect(totalIn).toBeGreaterThanOrEqual(60_000)
  })
})