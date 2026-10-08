// ─── Script & Network types ───────────────────────────────────────────────────

export type ScriptType =
  | 'p2pkh'
  | 'p2sh'
  | 'p2wpkh'
  | 'p2wsh'
  | 'p2sh-p2wpkh'
  | 'p2tr'

export type Network = 'mainnet' | 'testnet' | 'regtest'

export type LocktimeType = 'none' | 'block_height' | 'unix_timestamp'

// ─── Fixture input ────────────────────────────────────────────────────────────

export interface Utxo {
  txid: string
  vout: number
  value_sats: number
  script_pubkey_hex: string
  script_type: ScriptType
  address: string
}

export interface Payment {
  address: string
  script_pubkey_hex: string
  script_type: ScriptType
  value_sats: number
}

export interface ChangeTemplate {
  address: string
  script_pubkey_hex: string
  script_type: ScriptType
}

export interface Policy {
  max_inputs?: number
}

export interface Fixture {
  network: Network
  utxos: Utxo[]
  payments: Payment[]
  change: ChangeTemplate
  fee_rate_sat_vb: number
  rbf?: boolean
  locktime?: number
  current_height?: number
  policy?: Policy
  // Campos adicionais desconhecidos são ignorados (README: "Ignore what you don't need")
  [key: string]: unknown
}

// ─── Resultados internos ──────────────────────────────────────────────────────

export interface SequenceResult {
  nSequence: number
  nLockTime: number
}

export interface FeeCalcResult {
  selectedInputs: Utxo[]
  changeValue: number | null  // null = SEND_ALL (sem change output)
  feeSats: number
  vbytes: number
}

// ─── Output do relatório ──────────────────────────────────────────────────────

export interface OutputEntry {
  n: number
  value_sats: number
  script_pubkey_hex: string
  script_type: ScriptType
  address: string
  is_change: boolean
}

export interface WarningEntry {
  code: string
}

export interface Report {
  ok: true
  network: string
  strategy: 'greedy'
  selected_inputs: Utxo[]
  outputs: OutputEntry[]
  change_index: number | null
  fee_sats: number
  fee_rate_sat_vb: number
  vbytes: number
  rbf_signaling: boolean
  locktime: number
  locktime_type: LocktimeType
  psbt_base64: string
  warnings: WarningEntry[]
}

export interface ErrorReport {
  ok: false
  error: {
    code: string
    message: string
  }
}

// ─── Erros estruturados ───────────────────────────────────────────────────────

export class StructuredError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'StructuredError'
    this.code = code
  }
}
