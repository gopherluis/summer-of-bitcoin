/**
 * tests/psbt.test.ts
 *
 * buildPsbt() é async — todos os testes usam await.
 * initEccLib() é chamado uma vez no topo do arquivo de teste (aceitável em testes).
 */

import { describe, it, expect } from 'vitest'
import * as bitcoin from 'bitcoinjs-lib'
import * as ecc from 'tiny-secp256k1'
import { buildPsbt, extractRedeemScript, buildSyntheticPrevTx, assertPsbtMagic } from '../src/psbt.js'
import type { Utxo, OutputEntry } from '../src/types.js'

bitcoin.initEccLib(ecc)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeUtxo(type: string, index = 0): Utxo {
  const hexByType: Record<string, string> = {
    p2wpkh:       '0014' + 'ab'.repeat(20),
    p2tr:         '5120' + 'aa'.repeat(32),
    p2pkh:        '76a914' + 'bb'.repeat(20) + '88ac',
    'p2sh-p2wpkh':'a914' + 'cc'.repeat(20) + '87',
    p2wsh:        '0020' + 'dd'.repeat(32),
  }
  return {
    txid: index.toString(16).padStart(64, '0'),
    vout: 0,
    value_sats: 100_000,
    script_pubkey_hex: hexByType[type] ?? '0014' + 'ab'.repeat(20),
    script_type: type as any,
    address: '',
  }
}

function makeOutput(type: string, value = 70_000): OutputEntry {
  const hexByType: Record<string, string> = {
    p2wpkh: '0014' + 'cd'.repeat(20),
    p2tr:   '5120' + 'ee'.repeat(32),
    p2pkh:  '76a914' + 'ff'.repeat(20) + '88ac',
    p2sh:   'a914' + 'aa'.repeat(20) + '87',
  }
  return {
    n: 0, value_sats: value,
    script_pubkey_hex: hexByType[type] ?? '0014' + 'cd'.repeat(20),
    script_type: type as any, address: '', is_change: false,
  }
}

function decodePsbt(base64: string): bitcoin.Psbt {
  return bitcoin.Psbt.fromBase64(base64)
}

// ─── Magic bytes ──────────────────────────────────────────────────────────────

describe('buildPsbt — magic bytes', () => {
  it('PSBT base64 decodificado começa com 70736274ff', async () => {
    const psbtB64 = await buildPsbt([makeUtxo('p2wpkh')], [makeOutput('p2wpkh')], 0xfffffffd, 0, 'mainnet')
    const buf = Buffer.from(psbtB64, 'base64')
    expect(buf.slice(0, 5).toString('hex')).toBe('70736274ff')
  })

  it('assertPsbtMagic não lança para PSBT válido', async () => {
    const psbtB64 = await buildPsbt([makeUtxo('p2wpkh')], [makeOutput('p2wpkh')], 0xffffffff, 0, 'mainnet')
    expect(() => assertPsbtMagic(psbtB64)).not.toThrow()
  })

  it('assertPsbtMagic lança para base64 inválido', () => {
    expect(() => assertPsbtMagic(Buffer.from('notapsbt').toString('base64'))).toThrow()
  })
})

// ─── p2wpkh ──────────────────────────────────────────────────────────────────

describe('buildPsbt — p2wpkh input', () => {
  it('input p2wpkh tem witnessUtxo presente', async () => {
    const utxo = makeUtxo('p2wpkh')
    const psbt = decodePsbt(await buildPsbt([utxo], [makeOutput('p2wpkh')], 0xfffffffd, 0, 'mainnet'))
    const input = psbt.data.inputs[0]
    expect(input.witnessUtxo).toBeDefined()
    expect(input.nonWitnessUtxo).toBeUndefined()
    expect(input.witnessUtxo!.value).toBe(100_000)
    expect(input.witnessUtxo!.script.toString('hex')).toBe(utxo.script_pubkey_hex)
  })
})

// ─── p2tr ────────────────────────────────────────────────────────────────────

describe('buildPsbt — p2tr input', () => {
  it('input p2tr tem witnessUtxo presente', async () => {
    const utxo = makeUtxo('p2tr')
    const psbt = decodePsbt(await buildPsbt([utxo], [makeOutput('p2wpkh')], 0xfffffffd, 0, 'mainnet'))
    const input = psbt.data.inputs[0]
    expect(input.witnessUtxo).toBeDefined()
    expect(input.witnessUtxo!.value).toBe(100_000)
    expect(input.witnessUtxo!.script.toString('hex')).toBe(utxo.script_pubkey_hex)
  })
})

// ─── p2pkh ───────────────────────────────────────────────────────────────────

describe('buildPsbt — p2pkh input', () => {
  it('input p2pkh tem nonWitnessUtxo presente', async () => {
    const utxo = makeUtxo('p2pkh')
    const psbt = decodePsbt(await buildPsbt([utxo], [makeOutput('p2pkh')], 0xffffffff, 0, 'mainnet'))
    const input = psbt.data.inputs[0]
    expect(input.nonWitnessUtxo).toBeDefined()
    expect(input.witnessUtxo).toBeUndefined()
  })

  it('nonWitnessUtxo serializa como transação válida', async () => {
    const utxo = makeUtxo('p2pkh')
    const psbt = decodePsbt(await buildPsbt([utxo], [makeOutput('p2pkh')], 0xffffffff, 0, 'mainnet'))
    expect(() => bitcoin.Transaction.fromBuffer(psbt.data.inputs[0].nonWitnessUtxo!)).not.toThrow()
  })

  it('nonWitnessUtxo contém output com valor e script corretos na posição vout', async () => {
    const utxo = makeUtxo('p2pkh')
    const psbt = decodePsbt(await buildPsbt([utxo], [makeOutput('p2pkh')], 0xffffffff, 0, 'mainnet'))
    const prevTx = bitcoin.Transaction.fromBuffer(psbt.data.inputs[0].nonWitnessUtxo!)
    expect(prevTx.outs).toHaveLength(utxo.vout + 1)
    expect(prevTx.outs[utxo.vout].value).toBe(100_000)
    expect(prevTx.outs[utxo.vout].script.toString('hex')).toBe(utxo.script_pubkey_hex)
  })
})

// ─── p2sh-p2wpkh ─────────────────────────────────────────────────────────────

describe('buildPsbt — p2sh-p2wpkh input', () => {
  it('input p2sh-p2wpkh tem witnessUtxo E redeemScript', async () => {
    const utxo = makeUtxo('p2sh-p2wpkh')
    const psbt = decodePsbt(await buildPsbt([utxo], [makeOutput('p2wpkh')], 0xfffffffd, 0, 'mainnet'))
    const input = psbt.data.inputs[0]
    expect(input.witnessUtxo).toBeDefined()
    expect(input.redeemScript).toBeDefined()
    expect(input.witnessUtxo!.value).toBe(100_000)
  })

  it('redeemScript tem 22 bytes (OP_0 OP_DATA_20 <20bytes>)', async () => {
    const utxo = makeUtxo('p2sh-p2wpkh')
    const psbt = decodePsbt(await buildPsbt([utxo], [makeOutput('p2wpkh')], 0xfffffffd, 0, 'mainnet'))
    const redeemScript = psbt.data.inputs[0].redeemScript!
    expect(redeemScript).toHaveLength(22)
    expect(redeemScript[0]).toBe(0x00)
    expect(redeemScript[1]).toBe(0x14)
  })

  it('witnessUtxo.script é o scriptPubKey externo (p2sh)', async () => {
    const utxo = makeUtxo('p2sh-p2wpkh')
    const psbt = decodePsbt(await buildPsbt([utxo], [makeOutput('p2wpkh')], 0xfffffffd, 0, 'mainnet'))
    expect(psbt.data.inputs[0].witnessUtxo!.script.toString('hex')).toBe(utxo.script_pubkey_hex)
  })
})

// ─── nSequence e nLockTime ────────────────────────────────────────────────────

describe('buildPsbt — nSequence e nLockTime', () => {
  it('nSequence RBF (0xFFFFFFFD) é aplicado a todos os inputs', async () => {
    const inputs = [makeUtxo('p2wpkh', 0), makeUtxo('p2tr', 1)]
    const psbt = decodePsbt(await buildPsbt(inputs, [makeOutput('p2wpkh')], 0xfffffffd, 0, 'mainnet'))
    expect(psbt.txInputs[0].sequence).toBe(0xfffffffd)
    expect(psbt.txInputs[1].sequence).toBe(0xfffffffd)
  })

  it('nLockTime é aplicado à transação', async () => {
    const psbt = decodePsbt(await buildPsbt([makeUtxo('p2wpkh')], [makeOutput('p2wpkh')], 0xfffffffd, 850000, 'mainnet'))
    expect(psbt.locktime).toBe(850000)
  })

  it('nSequence final (0xFFFFFFFF) sem RBF', async () => {
    const psbt = decodePsbt(await buildPsbt([makeUtxo('p2wpkh')], [makeOutput('p2wpkh')], 0xffffffff, 0, 'mainnet'))
    expect(psbt.txInputs[0].sequence).toBe(0xffffffff)
  })
})

// ─── Inputs/outputs ───────────────────────────────────────────────────────────

describe('buildPsbt — inputs/outputs corretos', () => {
  it('número de inputs bate com UTXOs passados', async () => {
    const inputs = [makeUtxo('p2wpkh', 0), makeUtxo('p2wpkh', 1), makeUtxo('p2tr', 2)]
    const psbt = decodePsbt(await buildPsbt(inputs, [makeOutput('p2wpkh')], 0xffffffff, 0, 'mainnet'))
    expect(psbt.txInputs).toHaveLength(3)
  })

  it('número de outputs bate com OutputEntry[] passados', async () => {
    const outputs = [makeOutput('p2wpkh', 60_000), makeOutput('p2tr', 5_000)]
    const psbt = decodePsbt(await buildPsbt([makeUtxo('p2wpkh')], outputs, 0xffffffff, 0, 'mainnet'))
    expect(psbt.txOutputs).toHaveLength(2)
  })

  it('outputs usam script_pubkey_hex diretamente (não recalculado)', async () => {
    const output = makeOutput('p2wpkh')
    const psbt = decodePsbt(await buildPsbt([makeUtxo('p2wpkh')], [output], 0xffffffff, 0, 'mainnet'))
    expect(psbt.txOutputs[0].script.toString('hex')).toBe(output.script_pubkey_hex)
    expect(psbt.txOutputs[0].value).toBe(output.value_sats)
  })
})

// ─── Redes ────────────────────────────────────────────────────────────────────

describe('buildPsbt — redes', () => {
  it('mainnet, testnet e regtest constroem PSBTs válidos', async () => {
    for (const net of ['mainnet', 'testnet', 'regtest'] as const) {
      await expect(
        buildPsbt([makeUtxo('p2wpkh')], [makeOutput('p2wpkh')], 0xffffffff, 0, net)
      ).resolves.toBeTruthy()
    }
  })
})

// ─── Helpers puros (síncronos — não afetados) ─────────────────────────────────

describe('extractRedeemScript', () => {
  it('retorna Buffer de 22 bytes', () => {
    expect(extractRedeemScript('a914' + 'cc'.repeat(20) + '87')).toHaveLength(22)
  })

  it('começa com 0x00 0x14 (OP_0 OP_DATA_20)', () => {
    const rs = extractRedeemScript('a914' + 'cc'.repeat(20) + '87')
    expect(rs[0]).toBe(0x00)
    expect(rs[1]).toBe(0x14)
  })

  it('os 20 bytes do payload são extraídos corretamente', () => {
    const hash20 = 'cd'.repeat(20)
    const rs = extractRedeemScript('a914' + hash20 + '87')
    expect(rs.slice(2).toString('hex')).toBe(hash20)
  })
})

describe('buildSyntheticPrevTx', () => {
  it('retorna Buffer que deserializa como Transaction', () => {
    expect(() => bitcoin.Transaction.fromBuffer(buildSyntheticPrevTx(makeUtxo('p2pkh')))).not.toThrow()
  })

  it('output na posição vout tem value e script corretos', () => {
    const utxo: Utxo = { ...makeUtxo('p2pkh'), vout: 0 }
    const tx = bitcoin.Transaction.fromBuffer(buildSyntheticPrevTx(utxo))
    expect(tx.outs[0].value).toBe(100_000)
    expect(tx.outs[0].script.toString('hex')).toBe(utxo.script_pubkey_hex)
  })

  it('vout=2: cria 3 outputs com o correto na posição 2', () => {
    const utxo: Utxo = { ...makeUtxo('p2pkh'), vout: 2 }
    const tx = bitcoin.Transaction.fromBuffer(buildSyntheticPrevTx(utxo))
    expect(tx.outs).toHaveLength(3)
    expect(tx.outs[2].value).toBe(100_000)
    expect(tx.outs[2].script.toString('hex')).toBe(utxo.script_pubkey_hex)
  })
})