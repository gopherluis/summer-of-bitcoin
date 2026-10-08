/**
 * tests/builder.test.ts
 *
 * Testes de integração do pipeline completo via builder.ts.
 * REQUER: npm install (bitcoinjs-lib + tiny-secp256k1)
 *
 * build() é async — todos os testes usam async/await.
 */

import { describe, it, expect } from 'vitest'
import { build } from '../src/builder.js'

// ─── Fixtures sintéticos ──────────────────────────────────────────────────────

const BASIC_P2WPKH = {
  network: 'mainnet',
  utxos: [{
    txid: 'a'.repeat(64), vout: 0, value_sats: 200_000,
    script_pubkey_hex: '0014' + 'ab'.repeat(20),
    script_type: 'p2wpkh', address: 'bc1q...',
  }],
  payments: [{
    address: 'bc1q...', script_pubkey_hex: '0014' + 'cd'.repeat(20),
    script_type: 'p2wpkh', value_sats: 100_000,
  }],
  change: { address: 'bc1q...', script_pubkey_hex: '0014' + 'ef'.repeat(20), script_type: 'p2wpkh' },
  fee_rate_sat_vb: 5,
}

const RBF_WITH_LOCKTIME = { ...BASIC_P2WPKH, rbf: true, locktime: 850_000 }
const ANTI_FEE_SNIPING = { ...BASIC_P2WPKH, rbf: true, current_height: 850_000 }

const P2TR_INPUT = {
  network: 'mainnet',
  utxos: [{ txid: 'b'.repeat(64), vout: 0, value_sats: 200_000, script_pubkey_hex: '5120' + 'aa'.repeat(32), script_type: 'p2tr', address: 'bc1p...' }],
  payments: [{ address: 'bc1q...', script_pubkey_hex: '0014' + 'cd'.repeat(20), script_type: 'p2wpkh', value_sats: 100_000 }],
  change: { address: 'bc1q...', script_pubkey_hex: '0014' + 'ef'.repeat(20), script_type: 'p2wpkh' },
  fee_rate_sat_vb: 5,
}

const P2PKH_INPUT = {
  network: 'mainnet',
  utxos: [{ txid: 'c'.repeat(64), vout: 0, value_sats: 200_000, script_pubkey_hex: '76a914' + 'bb'.repeat(20) + '88ac', script_type: 'p2pkh', address: '1...' }],
  payments: [{ address: 'bc1q...', script_pubkey_hex: '0014' + 'cd'.repeat(20), script_type: 'p2wpkh', value_sats: 100_000 }],
  change: { address: 'bc1q...', script_pubkey_hex: '0014' + 'ef'.repeat(20), script_type: 'p2wpkh' },
  fee_rate_sat_vb: 5,
}

const P2SH_P2WPKH_INPUT = {
  network: 'mainnet',
  utxos: [{ txid: 'd'.repeat(64), vout: 0, value_sats: 200_000, script_pubkey_hex: 'a914' + 'cc'.repeat(20) + '87', script_type: 'p2sh-p2wpkh', address: '3...' }],
  payments: [{ address: 'bc1q...', script_pubkey_hex: '0014' + 'cd'.repeat(20), script_type: 'p2wpkh', value_sats: 100_000 }],
  change: { address: 'bc1q...', script_pubkey_hex: '0014' + 'ef'.repeat(20), script_type: 'p2wpkh' },
  fee_rate_sat_vb: 5,
}

// ─── Caminho feliz ────────────────────────────────────────────────────────────

describe('builder — caminho feliz', () => {
  it('retorna ok=true para fixture válido p2wpkh', async () => {
    const r = await build(BASIC_P2WPKH)
    expect(r.ok).toBe(true)
  })

  it('relatório tem todos os campos obrigatórios', async () => {
    const r = await build(BASIC_P2WPKH)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.network).toBe('mainnet')
    expect(r.strategy).toBe('greedy')
    expect(r.selected_inputs.length).toBeGreaterThan(0)
    expect(r.outputs.length).toBeGreaterThan(0)
    expect(r.fee_sats).toBeGreaterThan(0)
    expect(r.vbytes).toBeGreaterThan(0)
    expect(r.fee_rate_sat_vb).toBeGreaterThan(0)
    expect(r.psbt_base64).toBeTruthy()
    expect(typeof r.rbf_signaling).toBe('boolean')
    expect(typeof r.locktime).toBe('number')
    expect(['none', 'block_height', 'unix_timestamp']).toContain(r.locktime_type)
    expect(Array.isArray(r.warnings)).toBe(true)
  })

  it('PSBT começa com magic bytes 70736274ff', async () => {
    const r = await build(BASIC_P2WPKH)
    if (!r.ok) throw new Error(`build failed: ${JSON.stringify((r as any).error)}`)
    const buf = Buffer.from(r.psbt_base64, 'base64')
    expect(buf.slice(0, 5).toString('hex')).toBe('70736274ff')
  })

  it('invariante: totalIn = totalOut + fee + change', async () => {
    const r = await build(BASIC_P2WPKH)
    if (!r.ok) throw new Error(`build failed`)
    const totalIn = r.selected_inputs.reduce((s, u) => s + u.value_sats, 0)
    const totalOut = r.outputs.filter(o => !o.is_change).reduce((s, o) => s + o.value_sats, 0)
    const changeVal = r.change_index !== null ? r.outputs[r.change_index].value_sats : 0
    expect(totalIn).toBe(totalOut + r.fee_sats + changeVal)
  })

  it('fee_rate_sat_vb ≈ fee_sats / vbytes (±0.01)', async () => {
    const r = await build(BASIC_P2WPKH)
    if (!r.ok) throw new Error(`build failed`)
    expect(Math.abs(r.fee_rate_sat_vb - r.fee_sats / r.vbytes)).toBeLessThan(0.01)
  })
})

// ─── Tipos de input ───────────────────────────────────────────────────────────

describe('builder — script types', () => {
  it('p2tr input → ok=true', async () => {
    const r = await build(P2TR_INPUT)
    expect(r.ok).toBe(true)
  })

  it('p2pkh input → ok=true', async () => {
    const r = await build(P2PKH_INPUT)
    expect(r.ok).toBe(true)
  })

  it('p2sh-p2wpkh input → ok=true', async () => {
    const r = await build(P2SH_P2WPKH_INPUT)
    expect(r.ok).toBe(true)
  })
})

// ─── RBF / locktime ───────────────────────────────────────────────────────────

describe('builder — RBF e locktime', () => {
  it('rbf=true → rbf_signaling=true no relatório', async () => {
    const r = await build(RBF_WITH_LOCKTIME)
    if (!r.ok) throw new Error(`build failed`)
    expect(r.rbf_signaling).toBe(true)
  })

  it('rbf=true + locktime=850000 → locktime=850000, locktime_type=block_height', async () => {
    const r = await build(RBF_WITH_LOCKTIME)
    if (!r.ok) throw new Error(`build failed`)
    expect(r.locktime).toBe(850_000)
    expect(r.locktime_type).toBe('block_height')
  })

  it('rbf=true + current_height (anti-fee-sniping) → nLockTime=current_height', async () => {
    const r = await build(ANTI_FEE_SNIPING)
    if (!r.ok) throw new Error(`build failed`)
    expect(r.locktime).toBe(850_000)
    expect(r.rbf_signaling).toBe(true)
  })

  it('sem rbf → rbf_signaling=false, locktime=0, locktime_type=none', async () => {
    const r = await build(BASIC_P2WPKH)
    if (!r.ok) throw new Error(`build failed`)
    expect(r.rbf_signaling).toBe(false)
    expect(r.locktime).toBe(0)
    expect(r.locktime_type).toBe('none')
  })

  it('rbf=true → warning RBF_SIGNALING presente', async () => {
    const r = await build(RBF_WITH_LOCKTIME)
    if (!r.ok) throw new Error(`build failed`)
    expect(r.warnings.map(w => w.code)).toContain('RBF_SIGNALING')
  })
})

// ─── Warnings ────────────────────────────────────────────────────────────────

describe('builder — warnings', () => {
  it('transação normal → sem warnings críticos', async () => {
    const r = await build(BASIC_P2WPKH)
    if (!r.ok) throw new Error(`build failed`)
    const hasBadWarning = r.warnings.some(w => ['HIGH_FEE', 'DUST_CHANGE', 'SEND_ALL'].includes(w.code))
    expect(hasBadWarning).toBe(false)
  })
})

// ─── Change ───────────────────────────────────────────────────────────────────

describe('builder — change', () => {
  it('change_index aponta para output com is_change=true', async () => {
    const r = await build(BASIC_P2WPKH)
    if (!r.ok) throw new Error(`build failed`)
    if (r.change_index !== null) {
      expect(r.outputs[r.change_index].is_change).toBe(true)
    }
  })

  it('change output é o último output (índice = payments.length)', async () => {
    const r = await build(BASIC_P2WPKH)
    if (!r.ok) throw new Error(`build failed`)
    if (r.change_index !== null) {
      const paymentCount = r.outputs.filter(o => !o.is_change).length
      expect(r.change_index).toBe(paymentCount)
    }
  })
})

// ─── Erros estruturados ───────────────────────────────────────────────────────

describe('builder — ErrorReport', () => {
  it('fixture inválido → ok=false com INVALID_FIXTURE', async () => {
    const r = await build(null)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('INVALID_FIXTURE')
  })

  it('fixture com network inválida → ok=false', async () => {
    const r = await build({ ...BASIC_P2WPKH, network: 'signet' })
    expect(r.ok).toBe(false)
  })

  it('INSUFFICIENT_FUNDS → ok=false com code correto', async () => {
    const r = await build({ ...BASIC_P2WPKH, utxos: [{ ...BASIC_P2WPKH.utxos[0], value_sats: 100 }] })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('INSUFFICIENT_FUNDS')
  })

  it('p2sh bare como input → ok=false com UNSUPPORTED_SCRIPT_TYPE', async () => {
    const r = await build({
      ...BASIC_P2WPKH,
      utxos: [{ txid: 'a'.repeat(64), vout: 0, value_sats: 200_000, script_pubkey_hex: 'a914' + 'ab'.repeat(20) + '87', script_type: 'p2sh', address: '' }],
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('UNSUPPORTED_SCRIPT_TYPE')
  })

  it('ErrorReport tem error.code e error.message não-vazios', async () => {
    const r = await build(null)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(typeof r.error.code).toBe('string')
    expect(r.error.code.length).toBeGreaterThan(0)
    expect(typeof r.error.message).toBe('string')
    expect(r.error.message.length).toBeGreaterThan(0)
  })

  it('build() nunca rejeita — sempre resolve com objeto ok', async () => {
    const cases = [null, undefined, 42, 'string', [], { network: 'x' }]
    for (const c of cases) {
      const r = await build(c)
      expect(typeof r).toBe('object')
      expect('ok' in r).toBe(true)
    }
  })
})

// ─── policy.max_inputs ───────────────────────────────────────────────────────

describe('builder — policy.max_inputs', () => {
  it('max_inputs=1: seleciona exatamente 1 input quando suficiente', async () => {
    const r = await build({ ...BASIC_P2WPKH, policy: { max_inputs: 1 } })
    if (!r.ok) throw new Error(`build failed: ${JSON.stringify((r as any).error)}`)
    expect(r.selected_inputs).toHaveLength(1)
  })
})