/**
 * tests/validate.test.ts
 *
 * Testes unitários para src/validate.ts
 * Cobre: fixture válido, campos obrigatórios ausentes, tipos errados,
 * script_pubkey_hex inválido (hex, comprimento, prefixo), p2sh bare input,
 * campos opcionais (rbf, locktime, current_height, policy), campos extras ignorados.
 */

import { describe, it, expect } from 'vitest'
import { validateFixture } from '../src/validate.js'
import { StructuredError } from '../src/types.js'

// ─── Fixture mínimo válido (reutilizado em vários testes) ────────────────────

const VALID_FIXTURE = {
  network: 'mainnet',
  utxos: [
    {
      txid: 'a'.repeat(64),
      vout: 0,
      value_sats: 100000,
      script_pubkey_hex: '0014' + 'ab'.repeat(20),
      script_type: 'p2wpkh',
      address: 'bc1q...',
    },
  ],
  payments: [
    {
      address: 'bc1q...',
      script_pubkey_hex: '0014' + 'cd'.repeat(20),
      script_type: 'p2wpkh',
      value_sats: 70000,
    },
  ],
  change: {
    address: 'bc1q...',
    script_pubkey_hex: '0014' + 'ef'.repeat(20),
    script_type: 'p2wpkh',
  },
  fee_rate_sat_vb: 5,
}

function validFixture(overrides: Record<string, unknown> = {}): unknown {
  return { ...VALID_FIXTURE, ...overrides }
}

// ─── Fixture válido — caminho feliz ──────────────────────────────────────────

describe('validateFixture — fixture válido', () => {
  it('aceita fixture p2wpkh mínimo válido', () => {
    const result = validateFixture(validFixture())
    expect(result.network).toBe('mainnet')
    expect(result.utxos).toHaveLength(1)
    expect(result.payments).toHaveLength(1)
    expect(result.fee_rate_sat_vb).toBe(5)
  })

  it('normaliza script_pubkey_hex para lowercase', () => {
    const fixture = validFixture({
      utxos: [{ ...VALID_FIXTURE.utxos[0], script_pubkey_hex: '0014' + 'AB'.repeat(20) }],
    })
    const result = validateFixture(fixture)
    expect(result.utxos[0].script_pubkey_hex).toBe('0014' + 'ab'.repeat(20))
  })

  it('ignora campos adicionais desconhecidos', () => {
    const fixture = validFixture({ unknown_field: 'should be ignored', _meta: { version: 1 } })
    expect(() => validateFixture(fixture)).not.toThrow()
  })

  it('aceita fixture com todos os campos opcionais', () => {
    const fixture = validFixture({
      rbf: true,
      locktime: 850000,
      current_height: 850000,
      policy: { max_inputs: 5 },
    })
    const result = validateFixture(fixture)
    expect(result.rbf).toBe(true)
    expect(result.locktime).toBe(850000)
    expect(result.current_height).toBe(850000)
    expect(result.policy?.max_inputs).toBe(5)
  })

  it('aceita rbf=false explícito', () => {
    const result = validateFixture(validFixture({ rbf: false }))
    expect(result.rbf).toBe(false)
  })

  it('aceita múltiplos UTXOs e payments', () => {
    const fixture = validFixture({
      utxos: [
        { ...VALID_FIXTURE.utxos[0] },
        {
          txid: 'b'.repeat(64),
          vout: 1,
          value_sats: 50000,
          script_pubkey_hex: '5120' + 'aa'.repeat(32),
          script_type: 'p2tr',
          address: 'bc1p...',
        },
      ],
      payments: [
        { ...VALID_FIXTURE.payments[0] },
        {
          address: '1A...',
          script_pubkey_hex: '76a914' + 'bb'.repeat(20) + '88ac',
          script_type: 'p2pkh',
          value_sats: 20000,
        },
      ],
    })
    const result = validateFixture(fixture)
    expect(result.utxos).toHaveLength(2)
    expect(result.payments).toHaveLength(2)
  })

  it('aceita todos os script types válidos como payment output', () => {
    const types = [
      { type: 'p2pkh', hex: '76a914' + 'aa'.repeat(20) + '88ac' },
      { type: 'p2sh', hex: 'a914' + 'bb'.repeat(20) + '87' },
      { type: 'p2wpkh', hex: '0014' + 'cc'.repeat(20) },
      { type: 'p2wsh', hex: '0020' + 'dd'.repeat(32) },
      { type: 'p2tr', hex: '5120' + 'ee'.repeat(32) },
    ]
    for (const { type, hex } of types) {
      const fixture = validFixture({
        payments: [{ address: 'x', script_pubkey_hex: hex, script_type: type, value_sats: 1000 }],
      })
      expect(() => validateFixture(fixture), `should accept ${type} as payment`).not.toThrow()
    }
  })
})

// ─── Campos obrigatórios ausentes ────────────────────────────────────────────

describe('validateFixture — campos obrigatórios ausentes', () => {
  it('lança INVALID_FIXTURE para input não-objeto', () => {
    for (const v of [null, 'string', 42, [], undefined]) {
      expect(() => validateFixture(v)).toThrow(StructuredError)
    }
  })

  it('lança INVALID_FIXTURE para network inválida', () => {
    expect(() => validateFixture(validFixture({ network: 'signet' }))).toThrow(StructuredError)
    expect(() => validateFixture(validFixture({ network: undefined }))).toThrow(StructuredError)
  })

  it('lança INVALID_FIXTURE para utxos vazio', () => {
    expect(() => validateFixture(validFixture({ utxos: [] }))).toThrow(StructuredError)
  })

  it('lança INVALID_FIXTURE para payments vazio', () => {
    expect(() => validateFixture(validFixture({ payments: [] }))).toThrow(StructuredError)
  })

  it('lança INVALID_FIXTURE para fee_rate_sat_vb zero', () => {
    expect(() => validateFixture(validFixture({ fee_rate_sat_vb: 0 }))).toThrow(StructuredError)
  })

  it('lança INVALID_FIXTURE para fee_rate_sat_vb negativo', () => {
    expect(() => validateFixture(validFixture({ fee_rate_sat_vb: -1 }))).toThrow(StructuredError)
  })

  it('lança INVALID_FIXTURE para fee_rate_sat_vb não-número', () => {
    expect(() => validateFixture(validFixture({ fee_rate_sat_vb: 'fast' }))).toThrow(StructuredError)
  })

  it('lança INVALID_FIXTURE para value_sats zero em utxo', () => {
    const fixture = validFixture({
      utxos: [{ ...VALID_FIXTURE.utxos[0], value_sats: 0 }],
    })
    expect(() => validateFixture(fixture)).toThrow(StructuredError)
  })

  it('lança INVALID_FIXTURE para value_sats negativo em payment', () => {
    const fixture = validFixture({
      payments: [{ ...VALID_FIXTURE.payments[0], value_sats: -1 }],
    })
    expect(() => validateFixture(fixture)).toThrow(StructuredError)
  })
})

// ─── script_pubkey_hex — validação de hex, comprimento e prefixo ─────────────

describe('validateFixture — validação de script_pubkey_hex', () => {
  it('lança INVALID_FIXTURE para hex inválido (chars não-hex)', () => {
    const fixture = validFixture({
      utxos: [{ ...VALID_FIXTURE.utxos[0], script_pubkey_hex: '0014' + 'GG'.repeat(20) }],
    })
    expect(() => validateFixture(fixture)).toThrow(StructuredError)
  })

  it('lança INVALID_FIXTURE para comprimento errado (p2wpkh muito curto)', () => {
    const fixture = validFixture({
      utxos: [{ ...VALID_FIXTURE.utxos[0], script_pubkey_hex: '0014' + 'ab'.repeat(10) }],
    })
    expect(() => validateFixture(fixture)).toThrow(StructuredError)
  })

  it('lança INVALID_FIXTURE para prefixo errado (p2wpkh com prefixo p2pkh)', () => {
    // comprimento correto (44) mas prefixo errado
    const fixture = validFixture({
      utxos: [{ ...VALID_FIXTURE.utxos[0], script_pubkey_hex: '76a9' + 'ab'.repeat(20) }],
    })
    expect(() => validateFixture(fixture)).toThrow(StructuredError)
  })

  it('lança INVALID_FIXTURE para script_pubkey_hex inválido em payment', () => {
    const fixture = validFixture({
      payments: [{ ...VALID_FIXTURE.payments[0], script_pubkey_hex: 'ZZZZ' + 'ab'.repeat(20) }],
    })
    expect(() => validateFixture(fixture)).toThrow(StructuredError)
  })

  it('lança INVALID_FIXTURE para script_pubkey_hex inconsistente com script_type em payment', () => {
    // hex de p2tr mas declarado como p2wpkh
    const fixture = validFixture({
      payments: [{
        ...VALID_FIXTURE.payments[0],
        script_pubkey_hex: '5120' + 'aa'.repeat(32), // 68 chars — p2tr
        script_type: 'p2wpkh',                        // mas declarado p2wpkh (espera 44 chars)
      }],
    })
    expect(() => validateFixture(fixture)).toThrow(StructuredError)
  })

  it('valida script_pubkey_hex do change template também', () => {
    const fixture = validFixture({
      change: { ...VALID_FIXTURE.change, script_pubkey_hex: 'invalid_hex' },
    })
    expect(() => validateFixture(fixture)).toThrow(StructuredError)
  })
})

// ─── p2sh bare como input → UNSUPPORTED_SCRIPT_TYPE ─────────────────────────

describe('validateFixture — p2sh bare input', () => {
  it('lança UNSUPPORTED_SCRIPT_TYPE para p2sh bare como UTXO input', () => {
    const fixture = validFixture({
      utxos: [{
        txid: 'a'.repeat(64),
        vout: 0,
        value_sats: 100000,
        script_pubkey_hex: 'a914' + 'ab'.repeat(20) + '87',
        script_type: 'p2sh',
        address: '3...',
      }],
    })

    try {
      validateFixture(fixture)
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(StructuredError)
      expect((e as StructuredError).code).toBe('UNSUPPORTED_SCRIPT_TYPE')
    }
  })

  it('aceita p2sh como payment output (apenas inputs são restritos)', () => {
    const fixture = validFixture({
      payments: [{
        address: '3...',
        script_pubkey_hex: 'a914' + 'ab'.repeat(20) + '87',
        script_type: 'p2sh',
        value_sats: 50000,
      }],
    })
    expect(() => validateFixture(fixture)).not.toThrow()
  })
})

// ─── Campos opcionais — validação de tipo quando presentes ──────────────────

describe('validateFixture — campos opcionais', () => {
  it('lança INVALID_FIXTURE para rbf não-boolean', () => {
    expect(() => validateFixture(validFixture({ rbf: 1 }))).toThrow(StructuredError)
    expect(() => validateFixture(validFixture({ rbf: 'true' }))).toThrow(StructuredError)
  })

  it('lança INVALID_FIXTURE para locktime negativo', () => {
    expect(() => validateFixture(validFixture({ locktime: -1 }))).toThrow(StructuredError)
  })

  it('lança INVALID_FIXTURE para locktime não-inteiro', () => {
    expect(() => validateFixture(validFixture({ locktime: 1.5 }))).toThrow(StructuredError)
  })

  it('aceita locktime = 0', () => {
    // locktime 0 é válido (sem locktime efetivo)
    expect(() => validateFixture(validFixture({ locktime: 0 }))).not.toThrow()
  })

  it('lança INVALID_FIXTURE para policy.max_inputs = 0', () => {
    expect(() =>
      validateFixture(validFixture({ policy: { max_inputs: 0 } })),
    ).toThrow(StructuredError)
  })

  it('lança INVALID_FIXTURE para policy.max_inputs não-inteiro', () => {
    expect(() =>
      validateFixture(validFixture({ policy: { max_inputs: 2.5 } })),
    ).toThrow(StructuredError)
  })

  it('aceita policy sem max_inputs', () => {
    expect(() => validateFixture(validFixture({ policy: {} }))).not.toThrow()
  })

  it('campos opcionais ausentes não aparecem no resultado', () => {
    const result = validateFixture(validFixture())
    expect(result.rbf).toBeUndefined()
    expect(result.locktime).toBeUndefined()
    expect(result.current_height).toBeUndefined()
    expect(result.policy).toBeUndefined()
  })
})

// ─── Verificação dos error codes ─────────────────────────────────────────────

describe('validateFixture — error codes corretos', () => {
  it('erros de estrutura usam code INVALID_FIXTURE', () => {
    try {
      validateFixture({ network: 'mainnet' }) // sem utxos
    } catch (e) {
      expect((e as StructuredError).code).toBe('INVALID_FIXTURE')
    }
  })

  it('p2sh bare input usa code UNSUPPORTED_SCRIPT_TYPE', () => {
    try {
      validateFixture(validFixture({
        utxos: [{
          txid: 'a'.repeat(64),
          vout: 0,
          value_sats: 1000,
          script_pubkey_hex: 'a914' + 'ab'.repeat(20) + '87',
          script_type: 'p2sh',
        }],
      }))
    } catch (e) {
      expect((e as StructuredError).code).toBe('UNSUPPORTED_SCRIPT_TYPE')
    }
  })

  it('mensagem de erro é não-vazia em todos os casos', () => {
    const cases = [
      validFixture({ network: 'invalid' }),
      validFixture({ utxos: [] }),
      validFixture({ fee_rate_sat_vb: 0 }),
    ]
    for (const fixture of cases) {
      try {
        validateFixture(fixture)
      } catch (e) {
        expect((e as StructuredError).message.length).toBeGreaterThan(0)
      }
    }
  })
})
