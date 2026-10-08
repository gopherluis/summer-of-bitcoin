/**
 * validate.ts — Validação defensiva do fixture de entrada.
 *
 * Contrato: recebe `unknown`, retorna `Fixture` tipado ou lança `StructuredError`.
 * Nunca lança exceções não estruturadas — todo erro vira INVALID_FIXTURE ou
 * UNSUPPORTED_SCRIPT_TYPE com mensagem descritiva.
 *
 * Regras do README:
 *   - script_pubkey_hex é autoritativo (endereço é só UI)
 *   - Campos adicionais desconhecidos devem ser ignorados
 *   - p2sh bare como INPUT → UNSUPPORTED_SCRIPT_TYPE
 *   - Qualquer falha de estrutura/tipo/hex → INVALID_FIXTURE
 *
 * Zero dependências externas — lógica puramente de string/regex/typeof.
 */

import type { Fixture, Utxo, Payment, ChangeTemplate, ScriptType, Network } from './types.js'
import { StructuredError } from './types.js'

// ─── Constantes ───────────────────────────────────────────────────────────────

const VALID_NETWORKS: readonly Network[] = ['mainnet', 'testnet', 'regtest']

const VALID_SCRIPT_TYPES: readonly ScriptType[] = [
  'p2pkh',
  'p2sh',
  'p2wpkh',
  'p2wsh',
  'p2sh-p2wpkh',
  'p2tr',
]

/**
 * Comprimento esperado do script_pubkey_hex (em caracteres hex = bytes × 2)
 * para cada script_type.
 *
 * Prefixos e comprimentos derivados do protocolo Bitcoin:
 *   p2pkh:       OP_DUP OP_HASH160 <20 bytes> OP_EQUALVERIFY OP_CHECKSIG
 *                = 76 a9 14 {40 chars} 88 ac  → 25 bytes → 50 chars
 *   p2sh:        OP_HASH160 <20 bytes> OP_EQUAL
 *                = a9 14 {40 chars} 87        → 23 bytes → 46 chars
 *   p2sh-p2wpkh: externamente idêntico a p2sh → 46 chars
 *   p2wpkh:      OP_0 <20 bytes>
 *                = 00 14 {40 chars}            → 22 bytes → 44 chars
 *   p2wsh:       OP_0 <32 bytes>
 *                = 00 20 {64 chars}            → 34 bytes → 68 chars
 *   p2tr:        OP_1 <32 bytes>
 *                = 51 20 {64 chars}            → 34 bytes → 68 chars
 */
const SCRIPT_HEX_LENGTH: Record<ScriptType, number> = {
  p2pkh: 50,
  p2sh: 46,
  'p2sh-p2wpkh': 46,
  p2wpkh: 44,
  p2wsh: 68,
  p2tr: 68,
}

/**
 * Prefixos hex esperados por script_type.
 * Validação adicional além do comprimento — detecta hex válido mas tipo errado.
 */
const SCRIPT_HEX_PREFIX: Record<ScriptType, string> = {
  p2pkh: '76a914',    // OP_DUP OP_HASH160 OP_DATA_20
  p2sh: 'a914',       // OP_HASH160 OP_DATA_20
  'p2sh-p2wpkh': 'a914', // externamente p2sh
  p2wpkh: '0014',     // OP_0 OP_DATA_20
  p2wsh: '0020',      // OP_0 OP_DATA_32
  p2tr: '5120',       // OP_1 OP_DATA_32
}

// ─── Helpers de validação primitiva ──────────────────────────────────────────

function isHex(s: string): boolean {
  return /^[0-9a-f]*$/i.test(s) && s.length % 2 === 0
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function isPositiveInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0
}

function isNonNegativeInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// ─── Validação de script_pubkey_hex ──────────────────────────────────────────

/**
 * Valida que o script_pubkey_hex é consistente com o script_type declarado.
 * Verifica: (1) é hex válido, (2) comprimento correto, (3) prefixo correto.
 *
 * @param hex         - O valor de script_pubkey_hex
 * @param type        - O script_type declarado
 * @param context     - Para mensagens de erro (ex: "utxo[0]", "payment[1]")
 */
function validateScriptPubkeyHex(hex: unknown, type: ScriptType, context: string): void {
  if (typeof hex !== 'string' || hex.length === 0) {
    throw new StructuredError(
      'INVALID_FIXTURE',
      `${context}: script_pubkey_hex must be a non-empty hex string`,
    )
  }

  const lower = hex.toLowerCase()

  if (!isHex(lower)) {
    throw new StructuredError(
      'INVALID_FIXTURE',
      `${context}: script_pubkey_hex is not valid hex: "${hex}"`,
    )
  }

  const expectedLen = SCRIPT_HEX_LENGTH[type]
  if (lower.length !== expectedLen) {
    throw new StructuredError(
      'INVALID_FIXTURE',
      `${context}: script_pubkey_hex length ${lower.length} does not match ${type} ` +
        `(expected ${expectedLen} chars / ${expectedLen / 2} bytes)`,
    )
  }

  const expectedPrefix = SCRIPT_HEX_PREFIX[type]
  if (!lower.startsWith(expectedPrefix)) {
    throw new StructuredError(
      'INVALID_FIXTURE',
      `${context}: script_pubkey_hex prefix "${lower.slice(0, expectedPrefix.length)}" ` +
        `does not match ${type} (expected "${expectedPrefix}")`,
    )
  }
}

// ─── Validação de script_type ─────────────────────────────────────────────────

function validateScriptType(v: unknown, context: string): ScriptType {
  if (!VALID_SCRIPT_TYPES.includes(v as ScriptType)) {
    throw new StructuredError(
      'INVALID_FIXTURE',
      `${context}: invalid script_type "${v}". Must be one of: ${VALID_SCRIPT_TYPES.join(', ')}`,
    )
  }
  return v as ScriptType
}

// ─── Validação de UTXO ────────────────────────────────────────────────────────

function validateUtxo(raw: unknown, index: number): Utxo {
  const ctx = `utxos[${index}]`

  if (!isPlainObject(raw)) {
    throw new StructuredError('INVALID_FIXTURE', `${ctx}: must be an object`)
  }

  if (!isNonEmptyString(raw.txid)) {
    throw new StructuredError('INVALID_FIXTURE', `${ctx}.txid: must be a non-empty string`)
  }

  // txid deve ser 64 chars hex (32 bytes)
  if (!/^[0-9a-f]{64}$/i.test(raw.txid)) {
    throw new StructuredError(
      'INVALID_FIXTURE',
      `${ctx}.txid: must be 64 hex characters, got "${raw.txid.slice(0, 10)}..."`,
    )
  }

  if (!isNonNegativeInteger(raw.vout)) {
    throw new StructuredError('INVALID_FIXTURE', `${ctx}.vout: must be a non-negative integer`)
  }

  if (!isPositiveInteger(raw.value_sats)) {
    throw new StructuredError('INVALID_FIXTURE', `${ctx}.value_sats: must be a positive integer`)
  }

  const script_type = validateScriptType(raw.script_type, `${ctx}.script_type`)

  // p2sh bare como INPUT → UNSUPPORTED_SCRIPT_TYPE (decisão arquitetural aprovada)
  if (script_type === 'p2sh') {
    throw new StructuredError(
      'UNSUPPORTED_SCRIPT_TYPE',
      `${ctx}: p2sh bare input requires redeemScript for accurate fee estimation`,
    )
  }

  validateScriptPubkeyHex(raw.script_pubkey_hex, script_type, `${ctx}.script_pubkey_hex`)

  // address é opcional para UI — se presente deve ser string, se ausente usa vazio
  const address = typeof raw.address === 'string' ? raw.address : ''

  return {
    txid: raw.txid.toLowerCase(),
    vout: raw.vout,
    value_sats: raw.value_sats,
    script_pubkey_hex: (raw.script_pubkey_hex as string).toLowerCase(),
    script_type,
    address,
  }
}

// ─── Validação de Payment ─────────────────────────────────────────────────────

function validatePayment(raw: unknown, index: number): Payment {
  const ctx = `payments[${index}]`

  if (!isPlainObject(raw)) {
    throw new StructuredError('INVALID_FIXTURE', `${ctx}: must be an object`)
  }

  if (!isPositiveInteger(raw.value_sats)) {
    throw new StructuredError('INVALID_FIXTURE', `${ctx}.value_sats: must be a positive integer`)
  }

  const script_type = validateScriptType(raw.script_type, `${ctx}.script_type`)

  // Payments com p2sh-p2wpkh: o output é apenas p2sh externamente — aceito
  // p2sh bare como output: aceito (outputWeight o suporta)
  // Não lançar UNSUPPORTED_SCRIPT_TYPE para payments — só para inputs/UTXOs

  validateScriptPubkeyHex(raw.script_pubkey_hex, script_type, `${ctx}.script_pubkey_hex`)

  const address = typeof raw.address === 'string' ? raw.address : ''

  return {
    address,
    script_pubkey_hex: (raw.script_pubkey_hex as string).toLowerCase(),
    script_type,
    value_sats: raw.value_sats,
  }
}

// ─── Validação do change template ────────────────────────────────────────────

function validateChangeTemplate(raw: unknown): ChangeTemplate {
  const ctx = 'change'

  if (!isPlainObject(raw)) {
    throw new StructuredError('INVALID_FIXTURE', `${ctx}: must be an object`)
  }

  const script_type = validateScriptType(raw.script_type, `${ctx}.script_type`)

  validateScriptPubkeyHex(raw.script_pubkey_hex, script_type, `${ctx}.script_pubkey_hex`)

  const address = typeof raw.address === 'string' ? raw.address : ''

  return {
    address,
    script_pubkey_hex: (raw.script_pubkey_hex as string).toLowerCase(),
    script_type,
  }
}

// ─── Validação principal ──────────────────────────────────────────────────────

/**
 * Valida um fixture de entrada bruto e retorna um `Fixture` tipado.
 *
 * @throws StructuredError('INVALID_FIXTURE')       — estrutura/tipo inválido
 * @throws StructuredError('UNSUPPORTED_SCRIPT_TYPE') — p2sh bare como input
 */
export function validateFixture(raw: unknown): Fixture {
  if (!isPlainObject(raw)) {
    throw new StructuredError('INVALID_FIXTURE', 'Fixture must be a JSON object')
  }

  // ── network ──
  if (!VALID_NETWORKS.includes(raw.network as Network)) {
    throw new StructuredError(
      'INVALID_FIXTURE',
      `network: must be one of ${VALID_NETWORKS.join(', ')}, got "${raw.network}"`,
    )
  }
  const network = raw.network as Network

  // ── utxos ──
  if (!Array.isArray(raw.utxos) || raw.utxos.length === 0) {
    throw new StructuredError('INVALID_FIXTURE', 'utxos: must be a non-empty array')
  }
  const utxos = raw.utxos.map(validateUtxo)

  // ── payments ──
  if (!Array.isArray(raw.payments) || raw.payments.length === 0) {
    throw new StructuredError('INVALID_FIXTURE', 'payments: must be a non-empty array')
  }
  const payments = raw.payments.map(validatePayment)

  // ── change ──
  const change = validateChangeTemplate(raw.change)

  // ── fee_rate_sat_vb ──
  if (typeof raw.fee_rate_sat_vb !== 'number' || raw.fee_rate_sat_vb <= 0 || !isFinite(raw.fee_rate_sat_vb)) {
    throw new StructuredError(
      'INVALID_FIXTURE',
      `fee_rate_sat_vb: must be a positive number, got "${raw.fee_rate_sat_vb}"`,
    )
  }

  // ── rbf (opcional) ──
  if (raw.rbf !== undefined && typeof raw.rbf !== 'boolean') {
    throw new StructuredError('INVALID_FIXTURE', `rbf: must be a boolean if present, got "${raw.rbf}"`)
  }

  // ── locktime (opcional) ──
  if (raw.locktime !== undefined && !isNonNegativeInteger(raw.locktime)) {
    throw new StructuredError('INVALID_FIXTURE', `locktime: must be a non-negative integer if present`)
  }

  // ── current_height (opcional) ──
  if (raw.current_height !== undefined && !isNonNegativeInteger(raw.current_height)) {
    throw new StructuredError(
      'INVALID_FIXTURE',
      `current_height: must be a non-negative integer if present`,
    )
  }

  // ── policy (opcional) ──
  let policy: Fixture['policy']
  if (raw.policy !== undefined) {
    if (!isPlainObject(raw.policy)) {
      throw new StructuredError('INVALID_FIXTURE', 'policy: must be an object if present')
    }
    if (
      raw.policy.max_inputs !== undefined &&
      (!isPositiveInteger(raw.policy.max_inputs))
    ) {
      throw new StructuredError(
        'INVALID_FIXTURE',
        `policy.max_inputs: must be a positive integer if present`,
      )
    }
    policy = {
      ...(raw.policy.max_inputs !== undefined ? { max_inputs: raw.policy.max_inputs as number } : {}),
    }
  }

  return {
    network,
    utxos,
    payments,
    change,
    fee_rate_sat_vb: raw.fee_rate_sat_vb,
    ...(raw.rbf !== undefined ? { rbf: raw.rbf as boolean } : {}),
    ...(raw.locktime !== undefined ? { locktime: raw.locktime as number } : {}),
    ...(raw.current_height !== undefined ? { current_height: raw.current_height as number } : {}),
    ...(policy !== undefined ? { policy } : {}),
  }
}
