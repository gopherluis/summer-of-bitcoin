/**
 * tests/vbytes.test.ts
 *
 * Testes unitários para src/vbytes.ts
 * Verificações canônicas derivadas da tabela de WU aprovada na revisão arquitetural.
 */

import { describe, it, expect } from 'vitest'
import { estimateVbytes, estimateVbytesFromTypes, inputWeight, outputWeight } from '../src/vbytes.js'
import { StructuredError } from '../src/types.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeInput(type: string) {
  return { script_type: type as any }
}

function makeOutput(type: string) {
  return { script_type: type as any }
}

// ─── Verificações canônicas (golden values) ───────────────────────────────────

describe('estimateVbytes — verificações canônicas', () => {
  it('1× p2wpkh in + 2× p2wpkh out → 141 vbytes', () => {
    // WU: 42 (overhead segwit) + 272 (p2wpkh in) + 124 + 124 (p2wpkh outs)
    // = 562 WU → ceil(562/4) = 141
    const result = estimateVbytes(
      [makeInput('p2wpkh')],
      [makeOutput('p2wpkh'), makeOutput('p2wpkh')],
    )
    expect(result).toBe(141)
  })

  it('1× p2pkh in + 2× p2pkh out → 226 vbytes (tx pure legacy)', () => {
    // WU: 40 (overhead legacy) + 592 (p2pkh in) + 136 + 136 (p2pkh outs)
    // = 904 WU → ceil(904/4) = 226
    const result = estimateVbytes(
      [makeInput('p2pkh')],
      [makeOutput('p2pkh'), makeOutput('p2pkh')],
    )
    expect(result).toBe(226)
  })

  it('1× p2tr in + 1× p2tr out → 111 vbytes', () => {
    // WU: 42 (overhead segwit) + 230 (p2tr in) + 172 (p2tr out)
    // = 444 WU → ceil(444/4) = 111
    const result = estimateVbytes(
      [makeInput('p2tr')],
      [makeOutput('p2tr')],
    )
    expect(result).toBe(111)
  })

  it('1× p2sh-p2wpkh in + 2× p2wpkh out → 164 vbytes', () => {
    // WU: 42 (overhead segwit) + 364 (p2sh-p2wpkh in) + 124 + 124 (p2wpkh outs)
    // = 654 WU → ceil(654/4) = 164 (não 163.5 → ceil = 164)
    const result = estimateVbytes(
      [makeInput('p2sh-p2wpkh')],
      [makeOutput('p2wpkh'), makeOutput('p2wpkh')],
    )
    expect(result).toBe(164)
  })
})

// ─── Overhead: segwit vs legacy ───────────────────────────────────────────────

describe('estimateVbytes — overhead segwit', () => {
  it('tx com input p2wpkh usa overhead 42 WU (segwit marker+flag)', () => {
    // 42 + 272 + 124 = 438 → ceil(438/4) = 110 (não 109)
    const result = estimateVbytes([makeInput('p2wpkh')], [makeOutput('p2wpkh')])
    // WU: 42 + 272 + 124 = 438 → 110
    expect(result).toBe(110)
  })

  it('tx com input p2pkh puro usa overhead 40 WU (sem segwit)', () => {
    // 40 + 592 + 136 = 768 → ceil(768/4) = 192
    const result = estimateVbytes([makeInput('p2pkh')], [makeOutput('p2pkh')])
    expect(result).toBe(192)
  })

  it('tx com input p2tr usa overhead 42 WU', () => {
    // 42 + 230 + 124 = 396 → ceil(396/4) = 99
    const result = estimateVbytes([makeInput('p2tr')], [makeOutput('p2wpkh')])
    expect(result).toBe(99)
  })
})

// ─── Tx mista: p2pkh + segwit ────────────────────────────────────────────────

describe('estimateVbytes — transação mista (p2pkh + segwit)', () => {
  it('p2pkh em tx mista recebe +1 WU de witness vazio', () => {
    // p2pkh sozinho (puro): 40 + 592 + 124 = 756 → 189 vbytes
    const pure = estimateVbytes([makeInput('p2pkh')], [makeOutput('p2wpkh')])
    expect(pure).toBe(189)

    // p2pkh + p2wpkh (misto): overhead=42, p2pkh=593(+1), p2wpkh=272
    // 42 + 593 + 272 + 124 = 1031 → ceil(1031/4) = 258
    const mixed = estimateVbytes(
      [makeInput('p2pkh'), makeInput('p2wpkh')],
      [makeOutput('p2wpkh')],
    )
    expect(mixed).toBe(258)
  })

  it('múltiplos inputs p2pkh em tx mista — cada um recebe +1 WU', () => {
    // 3× p2pkh + 1× p2wpkh (para forçar tx mista)
    // overhead=42, 3×593=1779, 272, output=124
    // = 42 + 1779 + 272 + 124 = 2217 → ceil(2217/4) = 555 (2217/4 = 554.25 → 555)
    const result = estimateVbytes(
      [makeInput('p2pkh'), makeInput('p2pkh'), makeInput('p2pkh'), makeInput('p2wpkh')],
      [makeOutput('p2wpkh')],
    )
    expect(result).toBe(555)
  })
})

// ─── Pesos individuais ────────────────────────────────────────────────────────

describe('inputWeight — pesos por tipo', () => {
  it('p2pkh puro = 592 WU', () => expect(inputWeight('p2pkh', false)).toBe(592))
  it('p2pkh misto = 593 WU', () => expect(inputWeight('p2pkh', true)).toBe(593))
  it('p2wpkh = 272 WU', () => expect(inputWeight('p2wpkh', false)).toBe(272))
  it('p2sh-p2wpkh = 364 WU', () => expect(inputWeight('p2sh-p2wpkh', false)).toBe(364))
  it('p2tr = 230 WU', () => expect(inputWeight('p2tr', false)).toBe(230))
  it('p2wsh = 420 WU', () => expect(inputWeight('p2wsh', false)).toBe(420))
})

describe('outputWeight — pesos por tipo', () => {
  it('p2pkh = 136 WU', () => expect(outputWeight('p2pkh')).toBe(136))
  it('p2sh = 128 WU', () => expect(outputWeight('p2sh')).toBe(128))
  it('p2wpkh = 124 WU', () => expect(outputWeight('p2wpkh')).toBe(124))
  it('p2wsh = 172 WU', () => expect(outputWeight('p2wsh')).toBe(172))
  it('p2tr = 172 WU', () => expect(outputWeight('p2tr')).toBe(172))
})

// ─── Casos de erro ────────────────────────────────────────────────────────────

describe('estimateVbytes — erros estruturados', () => {
  it('p2sh bare como input lança UNSUPPORTED_SCRIPT_TYPE', () => {
    expect(() =>
      estimateVbytes([makeInput('p2sh')], [makeOutput('p2wpkh')]),
    ).toThrow(StructuredError)

    try {
      estimateVbytes([makeInput('p2sh')], [makeOutput('p2wpkh')])
    } catch (e) {
      expect(e).toBeInstanceOf(StructuredError)
      expect((e as StructuredError).code).toBe('UNSUPPORTED_SCRIPT_TYPE')
    }
  })

  it('lista de inputs vazia lança INVALID_FIXTURE', () => {
    expect(() =>
      estimateVbytes([], [makeOutput('p2wpkh')]),
    ).toThrow(StructuredError)
  })

  it('lista de outputs vazia lança INVALID_FIXTURE', () => {
    expect(() =>
      estimateVbytes([makeInput('p2wpkh')], []),
    ).toThrow(StructuredError)
  })
})

// ─── estimateVbytesFromTypes (conveniência) ───────────────────────────────────

describe('estimateVbytesFromTypes', () => {
  it('delega corretamente para estimateVbytes', () => {
    const a = estimateVbytes([makeInput('p2wpkh')], [makeOutput('p2wpkh'), makeOutput('p2wpkh')])
    const b = estimateVbytesFromTypes(['p2wpkh'], ['p2wpkh', 'p2wpkh'])
    expect(a).toBe(b)
    expect(a).toBe(141)
  })
})

// ─── Fixture real: large_mixed_script_types ───────────────────────────────────

describe('estimateVbytes — simulação fixture large_mixed_script_types', () => {
  it('68× p2tr in + 10 payments (5 p2wpkh + 3 p2tr + 2 p2pkh) + 1 change p2wpkh', () => {
    // Simula o resultado esperado da análise feita em revisão arquitetural:
    // 68 p2tr inputs suficientes para cobrir 1.000.000 sats em payments
    // WU: 42 + 68×230 + (5×124 + 3×172 + 2×136 + 1×124)
    //   = 42 + 15640 + (620 + 516 + 272 + 124)
    //   = 42 + 15640 + 1532 = 17214 WU
    // vbytes = ceil(17214/4) = ceil(4303.5) = 4304
    const inputs = Array(68).fill(makeInput('p2tr'))
    const outputs = [
      ...Array(5).fill(makeOutput('p2wpkh')),
      ...Array(3).fill(makeOutput('p2tr')),
      ...Array(2).fill(makeOutput('p2pkh')),
      makeOutput('p2wpkh'), // change
    ]
    const result = estimateVbytes(inputs, outputs)
    expect(result).toBe(4304)
  })
})
