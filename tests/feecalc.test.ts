/**
 * tests/feecalc.test.ts
 *
 * Testes unitários para src/feecalc.ts
 * Foco crítico: boundary exato 546/545, two-pass, SEND_ALL, INSUFFICIENT_FUNDS.
 */

import { describe, it, expect } from 'vitest'
import { calculateFeeAndChange, DUST_THRESHOLD } from '../src/feecalc.js'
import { estimateVbytesFromTypes } from '../src/vbytes.js'
import { StructuredError } from '../src/types.js'
import type { Utxo, Payment, ChangeTemplate } from '../src/types.js'

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

const CHANGE_P2WPKH: ChangeTemplate = {
  address: 'bc1q...',
  script_pubkey_hex: '0014' + 'ef'.repeat(20),
  script_type: 'p2wpkh',
}

// ─── Passe 1: com change ──────────────────────────────────────────────────────

describe('calculateFeeAndChange — Passe 1 (com change)', () => {
  it('retorna changeValue >= 546 e feeSats correto', () => {
    const inputs = [makeUtxo(200_000)]
    const payments = [makePayment(100_000)]
    const r = calculateFeeAndChange(inputs, payments, CHANGE_P2WPKH, 5)

    expect(r.changeValue).not.toBeNull()
    expect(r.changeValue!).toBeGreaterThanOrEqual(DUST_THRESHOLD)
    expect(r.feeSats).toBeGreaterThan(0)
    expect(r.vbytes).toBeGreaterThan(0)

    // Invariante: totalIn = totalOut + feeSats + changeValue
    const totalIn = 200_000
    const totalOut = 100_000
    expect(totalIn).toBe(totalOut + r.feeSats + r.changeValue!)
  })

  it('fee = ceil(vbytes × feeRate)', () => {
    const inputs = [makeUtxo(200_000)]
    const payments = [makePayment(100_000)]
    const feeRate = 7
    const r = calculateFeeAndChange(inputs, payments, CHANGE_P2WPKH, feeRate)

    const expectedVbytes = estimateVbytesFromTypes(['p2wpkh'], ['p2wpkh', 'p2wpkh'])
    expect(r.vbytes).toBe(expectedVbytes)
    expect(r.feeSats).toBe(Math.ceil(expectedVbytes * feeRate))
  })

  it('selectedInputs no resultado é o mesmo array passado', () => {
    const inputs = [makeUtxo(200_000)]
    const r = calculateFeeAndChange(inputs, [makePayment(100_000)], CHANGE_P2WPKH, 5)
    expect(r.selectedInputs).toBe(inputs)
  })
})

// ─── Boundary crítico: dust threshold ────────────────────────────────────────

describe('calculateFeeAndChange — boundary dust threshold', () => {
  /**
   * Para testar os boundaries exatos, calculamos o totalIn necessário
   * para produzir change_value de exatamente 546 ou 545.
   *
   * Usando 1× p2wpkh in + 1× p2wpkh payment + 1× p2wpkh change:
   *   vbytes_com_change = 141
   *   fee_needed = ceil(141 × feeRate)
   *
   * Para change = 546: totalIn = totalOut + fee_needed + 546
   * Para change = 545: totalIn = totalOut + fee_needed + 545
   */

  it('change_value = 546 exato → Passe 1 cria change (boundary mínimo)', () => {
    const feeRate = 1
    const paymentValue = 50_000
    const vbytes = estimateVbytesFromTypes(['p2wpkh'], ['p2wpkh', 'p2wpkh'])
    const feeNeeded = Math.ceil(vbytes * feeRate)
    const totalIn = paymentValue + feeNeeded + 546 // change exato = 546

    const r = calculateFeeAndChange(
      [makeUtxo(totalIn)],
      [makePayment(paymentValue)],
      CHANGE_P2WPKH,
      feeRate,
    )

    expect(r.changeValue).toBe(546)
    expect(r.feeSats).toBe(feeNeeded)
  })

  it('change_value = 545 → Passe 2 (dust → SEND_ALL)', () => {
    const feeRate = 1
    const paymentValue = 50_000
    const vbytes = estimateVbytesFromTypes(['p2wpkh'], ['p2wpkh', 'p2wpkh'])
    const feeNeeded = Math.ceil(vbytes * feeRate)
    const totalIn = paymentValue + feeNeeded + 545 // change teria 545 → dust

    const r = calculateFeeAndChange(
      [makeUtxo(totalIn)],
      [makePayment(paymentValue)],
      CHANGE_P2WPKH,
      feeRate,
    )

    expect(r.changeValue).toBeNull() // SEND_ALL
    // fee_actual = totalIn - paymentValue = feeNeeded + 545
    expect(r.feeSats).toBe(feeNeeded + 545)
  })

  it('change_value = 0 → Passe 2 (sem change)', () => {
    const feeRate = 1
    const paymentValue = 50_000
    const vbytesWithChange = estimateVbytesFromTypes(['p2wpkh'], ['p2wpkh', 'p2wpkh'])
    const feeNeededWithChange = Math.ceil(vbytesWithChange * feeRate)
    // totalIn produz change = 0
    const totalIn = paymentValue + feeNeededWithChange

    const r = calculateFeeAndChange(
      [makeUtxo(totalIn)],
      [makePayment(paymentValue)],
      CHANGE_P2WPKH,
      feeRate,
    )

    expect(r.changeValue).toBeNull()
  })

  it('DUST_THRESHOLD exportado é 546', () => {
    expect(DUST_THRESHOLD).toBe(546)
  })
})

// ─── Passe 2: SEND_ALL ────────────────────────────────────────────────────────

describe('calculateFeeAndChange — Passe 2 (SEND_ALL)', () => {
  it('changeValue é null no resultado SEND_ALL', () => {
    // totalIn = exatamente totalOut + feeNeededNoChange (sem sobra para change)
    const feeRate = 1
    const paymentValue = 50_000
    const vbytesNoChange = estimateVbytesFromTypes(['p2wpkh'], ['p2wpkh'])
    const feeNeededNoChange = Math.ceil(vbytesNoChange * feeRate)
    const totalIn = paymentValue + feeNeededNoChange

    const r = calculateFeeAndChange(
      [makeUtxo(totalIn)],
      [makePayment(paymentValue)],
      CHANGE_P2WPKH,
      feeRate,
    )

    expect(r.changeValue).toBeNull()
    expect(r.feeSats).toBe(feeNeededNoChange)
  })

  it('fee_actual pode exceder fee_needed_no_change (sats extras viram fee)', () => {
    // SEND_ALL: dust (100 sats) some na fee — aceito pelo README
    const feeRate = 1
    const paymentValue = 50_000
    const vbytesWithChange = estimateVbytesFromTypes(['p2wpkh'], ['p2wpkh', 'p2wpkh'])
    const feeNeededWithChange = Math.ceil(vbytesWithChange * feeRate)
    // 300 sats abaixo do dust — cai no Passe 2
    const totalIn = paymentValue + feeNeededWithChange + 300

    const r = calculateFeeAndChange(
      [makeUtxo(totalIn)],
      [makePayment(paymentValue)],
      CHANGE_P2WPKH,
      feeRate,
    )

    expect(r.changeValue).toBeNull()
    const vbytesNoChange = estimateVbytesFromTypes(['p2wpkh'], ['p2wpkh'])
    const feeNeededNoChange = Math.ceil(vbytesNoChange * feeRate)
    // fee_actual = feeNeededWithChange + 300, que é > feeNeededNoChange
    expect(r.feeSats).toBeGreaterThan(feeNeededNoChange)
  })

  it('vbytes no resultado SEND_ALL = vbytes SEM change output', () => {
    const feeRate = 1
    const paymentValue = 50_000
    const vbytesNoChange = estimateVbytesFromTypes(['p2wpkh'], ['p2wpkh'])
    const totalIn = paymentValue + Math.ceil(vbytesNoChange * feeRate) + 200

    const r = calculateFeeAndChange(
      [makeUtxo(totalIn)],
      [makePayment(paymentValue)],
      CHANGE_P2WPKH,
      feeRate,
    )

    expect(r.changeValue).toBeNull()
    expect(r.vbytes).toBe(vbytesNoChange)
  })
})

// ─── INSUFFICIENT_FUNDS ───────────────────────────────────────────────────────

describe('calculateFeeAndChange — INSUFFICIENT_FUNDS', () => {
  it('lança quando totalIn < totalOut (pré-condição)', () => {
    try {
      calculateFeeAndChange(
        [makeUtxo(50_000)],
        [makePayment(100_000)],
        CHANGE_P2WPKH,
        1,
      )
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(StructuredError)
      expect((e as StructuredError).code).toBe('INSUFFICIENT_FUNDS')
    }
  })

  it('lança no Passe 2 quando fee_actual < fee_needed_no_change', () => {
    // Construir caso onde totalIn - totalOut < fee_needed_no_change.
    // Isso requer que vbytes_sem_change * feeRate > totalIn - totalOut.
    // Com feeRate muito alto, fee mínima é maior que o que sobra.
    const feeRate = 1000 // altíssimo
    const paymentValue = 99_000
    const totalIn = 100_000 // sobra 1_000 sats — fee mínima a 1000 sat/vB é >> 1000

    try {
      calculateFeeAndChange(
        [makeUtxo(totalIn)],
        [makePayment(paymentValue)],
        CHANGE_P2WPKH,
        feeRate,
      )
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(StructuredError)
      expect((e as StructuredError).code).toBe('INSUFFICIENT_FUNDS')
    }
  })
})

// ─── Múltiplos inputs e outputs ───────────────────────────────────────────────

describe('calculateFeeAndChange — múltiplos inputs/outputs', () => {
  it('múltiplos inputs p2wpkh: vbytes aumenta por input', () => {
    const single = calculateFeeAndChange(
      [makeUtxo(500_000, 'p2wpkh', 0)],
      [makePayment(100_000)],
      CHANGE_P2WPKH,
      1,
    )
    const multi = calculateFeeAndChange(
      [makeUtxo(300_000, 'p2wpkh', 0), makeUtxo(300_000, 'p2wpkh', 1)],
      [makePayment(100_000)],
      CHANGE_P2WPKH,
      1,
    )
    expect(multi.vbytes).toBeGreaterThan(single.vbytes)
  })

  it('múltiplos payments: totalOut é soma correta', () => {
    const inputs = [makeUtxo(1_000_000)]
    const payments = [makePayment(200_000), makePayment(300_000), makePayment(400_000)]
    const r = calculateFeeAndChange(inputs, payments, CHANGE_P2WPKH, 1)

    expect(r.changeValue).not.toBeNull()
    const totalOut = 200_000 + 300_000 + 400_000
    expect(1_000_000).toBe(totalOut + r.feeSats + r.changeValue!)
  })

  it('inputs p2tr: vbytes usa peso 230 WU por input', () => {
    const r = calculateFeeAndChange(
      [makeUtxo(500_000, 'p2tr')],
      [makePayment(100_000)],
      CHANGE_P2WPKH,
      1,
    )
    const expectedVbytes = estimateVbytesFromTypes(['p2tr'], ['p2wpkh', 'p2wpkh'])
    expect(r.vbytes).toBe(expectedVbytes)
  })
})

// ─── buildOutputs ─────────────────────────────────────────────────────────────

describe('buildOutputs', () => {
  it('payments antes do change, n sequencial', async () => {
    const { buildOutputs } = await import('../src/feecalc.js')
    const payments = [makePayment(100_000), makePayment(200_000)]
    const outputs = buildOutputs(payments, CHANGE_P2WPKH, 5_000)

    expect(outputs).toHaveLength(3)
    expect(outputs[0].n).toBe(0)
    expect(outputs[0].is_change).toBe(false)
    expect(outputs[1].n).toBe(1)
    expect(outputs[1].is_change).toBe(false)
    expect(outputs[2].n).toBe(2)
    expect(outputs[2].is_change).toBe(true)
    expect(outputs[2].value_sats).toBe(5_000)
  })

  it('sem change (SEND_ALL): nenhum output is_change=true', async () => {
    const { buildOutputs } = await import('../src/feecalc.js')
    const payments = [makePayment(100_000)]
    const outputs = buildOutputs(payments, CHANGE_P2WPKH, null)

    expect(outputs).toHaveLength(1)
    expect(outputs[0].is_change).toBe(false)
  })

  it('change_index = payments.length', async () => {
    const { buildOutputs } = await import('../src/feecalc.js')
    const payments = [makePayment(100_000), makePayment(50_000)]
    const outputs = buildOutputs(payments, CHANGE_P2WPKH, 1_000)
    const changeOutput = outputs.find(o => o.is_change)

    expect(changeOutput).toBeDefined()
    expect(changeOutput!.n).toBe(payments.length) // índice = 2
  })
})
