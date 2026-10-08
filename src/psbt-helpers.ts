/**
 * psbt-helpers.ts — Helpers puros de PSBT.
 *
 * Separados de psbt.ts para serem testáveis sem bitcoinjs-lib.
 * Importados tanto por psbt.ts quanto pelos testes de verificação.
 */

import { StructuredError } from './types.js'

/**
 * Extrai o redeemScript para p2sh-p2wpkh a partir do scriptPubKey externo.
 *
 * scriptPubKey externo: a914{20bytes}87 (23 bytes = 46 hex chars)
 * Os 20 bytes centrais são extraídos como payload do redeemScript.
 * redeemScript resultante: 0014{20bytes} — OP_0 OP_DATA_20 <hash>
 *
 * Nota: para fixtures fictícios, o redeemScript não precisa ser
 * criptograficamente consistente com o hash externo — precisa estar
 * PRESENTE no PSBT com o formato correto.
 */
export function extractRedeemScript(scriptPubKeyHex: string): Buffer {
  // a914{40 hex chars = 20 bytes}87
  // índices: [0:4]='a914', [4:44]=20 bytes hash, [44:46]='87'
  const hash160Hex = scriptPubKeyHex.slice(4, 44)
  return Buffer.from('0014' + hash160Hex, 'hex')
}

/**
 * Verifica que um PSBT base64 começa com os magic bytes corretos (70736274ff).
 * Lança StructuredError se inválido.
 */
export function assertPsbtMagic(psbtBase64: string): void {
  const buf = Buffer.from(psbtBase64, 'base64')
  if (buf.length < 5) {
    throw new StructuredError('INVALID_FIXTURE', 'PSBT too short to contain magic bytes')
  }
  const magic = buf.slice(0, 5).toString('hex')
  if (magic !== '70736274ff') {
    throw new StructuredError(
      'INVALID_FIXTURE',
      `PSBT magic bytes invalid: expected 70736274ff, got ${magic}`,
    )
  }
}
