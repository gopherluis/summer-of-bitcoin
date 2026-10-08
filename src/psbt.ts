/**
 * psbt.ts — Construção de PSBT (BIP-174) usando bitcoinjs-lib.
 *
 * OTIMIZAÇÃO DE PERFORMANCE:
 *   tiny-secp256k1 é WASM e leva ~500ms para inicializar.
 *   Só é necessário para inputs p2tr.
 *   Carregado lazily via dynamic import apenas quando necessário.
 *   Para todos os outros tipos (p2wpkh, p2pkh, p2sh-p2wpkh), nunca carrega.
 */

import * as bitcoin from 'bitcoinjs-lib'
import type { Utxo, OutputEntry, Network } from './types.js'
import { StructuredError } from './types.js'
import { extractRedeemScript, assertPsbtMagic } from './psbt-helpers.js'

export { extractRedeemScript, assertPsbtMagic } from './psbt-helpers.js'

// Lazy ECC init — só carrega tiny-secp256k1 se houver input p2tr
let eccInitialized = false
async function ensureEcc(): Promise<void> {
  if (eccInitialized) return
  const ecc = await import('tiny-secp256k1')
  bitcoin.initEccLib(ecc)
  eccInitialized = true
}

export function getBitcoinNetwork(network: Network): bitcoin.networks.Network {
  switch (network) {
    case 'mainnet': return bitcoin.networks.bitcoin
    case 'testnet': return bitcoin.networks.testnet
    case 'regtest': return bitcoin.networks.regtest
  }
}

export function buildSyntheticPrevTx(utxo: Utxo): Buffer {
  const tx = new bitcoin.Transaction()
  tx.version = 2
  tx.addInput(Buffer.alloc(32, 0), 0xffffffff, 0xffffffff)
  for (let i = 0; i < utxo.vout; i++) {
    tx.addOutput(Buffer.from('6a', 'hex'), 0)
  }
  tx.addOutput(Buffer.from(utxo.script_pubkey_hex, 'hex'), utxo.value_sats)
  return tx.toBuffer()
}

export async function buildPsbt(
  inputs: Utxo[],
  outputs: OutputEntry[],
  nSequence: number,
  nLockTime: number,
  network: Network,
): Promise<string> {
  // Só inicializar ECC se houver input p2tr — evita carregar WASM desnecessariamente
  const hasTaproot = inputs.some(u => u.script_type === 'p2tr')
  if (hasTaproot) await ensureEcc()

  const btcNetwork = getBitcoinNetwork(network)
  const psbt = new bitcoin.Psbt({ network: btcNetwork })
  psbt.setVersion(2)
  psbt.setLocktime(nLockTime)

  for (const utxo of inputs) {
    const inputBase = { hash: utxo.txid, index: utxo.vout, sequence: nSequence }

    switch (utxo.script_type) {
      case 'p2wpkh':
      case 'p2wsh':
      case 'p2tr': {
        psbt.addInput({
          ...inputBase,
          witnessUtxo: {
            value: utxo.value_sats,
            script: Buffer.from(utxo.script_pubkey_hex, 'hex'),
          },
        })
        break
      }
      case 'p2pkh': {
        psbt.addInput({ ...inputBase, nonWitnessUtxo: buildSyntheticPrevTx(utxo) })
        break
      }
      case 'p2sh-p2wpkh': {
        psbt.addInput({
          ...inputBase,
          witnessUtxo: {
            value: utxo.value_sats,
            script: Buffer.from(utxo.script_pubkey_hex, 'hex'),
          },
          redeemScript: extractRedeemScript(utxo.script_pubkey_hex),
        })
        break
      }
      default: {
        throw new StructuredError(
          'UNSUPPORTED_SCRIPT_TYPE',
          `Unsupported input script type for PSBT: ${utxo.script_type}`,
        )
      }
    }
  }

  for (const output of outputs) {
    psbt.addOutput({
      script: Buffer.from(output.script_pubkey_hex, 'hex'),
      value: output.value_sats,
    })
  }

  return psbt.toBase64()
}