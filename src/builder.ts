import type { Report, ErrorReport } from './types.js'
import { StructuredError } from './types.js'
import { validateFixture } from './validate.js'
import { computeSequence, classifyLocktime, isRbfSignaling } from './sequence.js'
import { selectCoins } from './coinselect.js'
import { calculateFeeAndChange, buildOutputs } from './feecalc.js'
import { buildPsbt, assertPsbtMagic } from './psbt.js'
import { collectWarnings } from './warnings.js'
import { assembleReport, assembleErrorReport, assembleUnknownErrorReport } from './report.js'

export async function build(raw: unknown): Promise<Report | ErrorReport> {
  try {
    const fixture = validateFixture(raw)

    const { nSequence, nLockTime } = computeSequence(
      fixture.rbf, fixture.locktime, fixture.current_height,
    )
    const rbfSignaling = isRbfSignaling(nSequence)
    const locktimeType = classifyLocktime(nLockTime)

    const selectedInputs = selectCoins(
      fixture.utxos, fixture.payments, fixture.fee_rate_sat_vb,
      fixture.change.script_type, fixture.policy?.max_inputs,
    )

    const feeCalcResult = calculateFeeAndChange(
      selectedInputs, fixture.payments, fixture.change, fixture.fee_rate_sat_vb,
    )

    const outputs = buildOutputs(fixture.payments, fixture.change, feeCalcResult.changeValue)

    // await — buildPsbt é async para suportar lazy-load do WASM tiny-secp256k1
    const psbtBase64 = await buildPsbt(
      feeCalcResult.selectedInputs, outputs, nSequence, nLockTime, fixture.network,
    )

    assertPsbtMagic(psbtBase64)

    const effectiveFeeRate = feeCalcResult.feeSats / feeCalcResult.vbytes
    const warnings = collectWarnings(
      feeCalcResult.feeSats, effectiveFeeRate, feeCalcResult.changeValue, rbfSignaling,
    )

    return assembleReport({
      network: fixture.network,
      selectedInputs: feeCalcResult.selectedInputs,
      outputs,
      feeSats: feeCalcResult.feeSats,
      vbytes: feeCalcResult.vbytes,
      rbfSignaling,
      nLockTime,
      locktimeType,
      psbtBase64,
      warnings,
    })
  } catch (e) {
    if (e instanceof StructuredError) return assembleErrorReport(e)
    return assembleUnknownErrorReport(e)
  }
}