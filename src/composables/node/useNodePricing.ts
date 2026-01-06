// JSONata-based pricing badge evaluation for API nodes.
//
// Pricing declarations are read from ComfyUI node definitions (price_badge field).
// The Frontend evaluates these declarations locally using a JSONata engine.
//
// JSONata v2.x NOTE:
// - jsonata(expression).evaluate(input) returns a Promise in JSONata 2.x.
// - Therefore, pricing evaluation is async. This file implements:
//   - sync getter (returns cached label / last-known label),
//   - async evaluation + cache,
//   - reactive tick to update UI when async evaluation completes.

import { readonly, ref } from 'vue'
import { formatCreditsFromUsd } from '@/base/credits/comfyCredits'
import type { LGraphNode } from '@/lib/litegraph/src/litegraph'
import type { INodeInputSlot } from '@/lib/litegraph/src/interfaces'
import type { IBaseWidget } from '@/lib/litegraph/src/types/widgets'
import type { PriceBadge, WidgetDependency } from '@/schemas/nodeDefSchema'
import { useNodeDefStore } from '@/stores/nodeDefStore'
import type { Expression } from 'jsonata'
import jsonata from 'jsonata'

const DEFAULT_NUMBER_OPTIONS: Intl.NumberFormatOptions = {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
}

type CreditFormatOptions = {
  suffix?: string
  note?: string
  approximate?: boolean
  separator?: string
}

const formatCreditsValue = (usd: number): string =>
  formatCreditsFromUsd({
    usd,
    numberOptions: DEFAULT_NUMBER_OPTIONS
  })

const makePrefix = (approximate?: boolean) => (approximate ? '~' : '')

const makeSuffix = (suffix?: string) => suffix ?? '/Run'

const appendNote = (note?: string) => (note ? ` ${note}` : '')

const formatCreditsLabel = (
  usd: number,
  { suffix, note, approximate }: CreditFormatOptions = {}
): string =>
  `${makePrefix(approximate)}${formatCreditsValue(usd)} credits${makeSuffix(suffix)}${appendNote(note)}`

const formatCreditsRangeLabel = (
  minUsd: number,
  maxUsd: number,
  { suffix, note, approximate }: CreditFormatOptions = {}
): string => {
  const min = formatCreditsValue(minUsd)
  const max = formatCreditsValue(maxUsd)
  const rangeValue = min === max ? min : `${min}-${max}`
  return `${makePrefix(approximate)}${rangeValue} credits${makeSuffix(suffix)}${appendNote(note)}`
}

const formatCreditsListLabel = (
  usdValues: number[],
  { suffix, note, approximate, separator }: CreditFormatOptions = {}
): string => {
  const parts = usdValues.map((value) => formatCreditsValue(value))
  const value = parts.join(separator ?? '/')
  return `${makePrefix(approximate)}${value} credits${makeSuffix(suffix)}${appendNote(note)}`
}

// -----------------------------
// JSONata pricing types
// -----------------------------
type PricingResult =
  | { type: 'text'; text: string }
  | { type: 'usd'; usd: number; format?: CreditFormatOptions }
  | {
      type: 'range_usd'
      min_usd: number
      max_usd: number
      format?: CreditFormatOptions
    }
  | { type: 'list_usd'; usd: number[]; format?: CreditFormatOptions }

/**
 * Widget values are normalized based on their declared type:
 * - INT/FLOAT → number (or null if not parseable)
 * - BOOLEAN → boolean (or null if not parseable)
 * - STRING/COMBO/other → string (lowercased, trimmed)
 */
type NormalizedWidgetValue = string | number | boolean | null

type JsonataPricingRule = {
  engine: 'jsonata'
  depends_on: {
    widgets: WidgetDependency[]
    inputs: string[]
    input_groups: string[]
  }
  expr: string
  result_defaults?: CreditFormatOptions
}

type CompiledJsonataPricingRule = JsonataPricingRule & {
  _compiled: Expression | null
}

type JsonataEvalContext = {
  widgets: Record<string, NormalizedWidgetValue>
  inputs: Record<string, { connected: boolean }>
  /** Count of connected inputs per autogrow group */
  inputGroups: Record<string, number>
}

// -----------------------------
// Normalization helpers
// -----------------------------
const asFiniteNumber = (v: unknown): number | null => {
  if (v === null || v === undefined) return null

  if (typeof v === 'number') return Number.isFinite(v) ? v : null

  if (typeof v === 'string') {
    const t = v.trim()
    if (t === '') return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }

  // Do not coerce booleans/objects into numbers for pricing purposes.
  return null
}

/**
 * Normalize widget value based on its declared type.
 * Returns the value in its natural type for simpler JSONata expressions.
 */
const normalizeWidgetValue = (
  raw: unknown,
  declaredType: string
): NormalizedWidgetValue => {
  if (raw === undefined || raw === null) {
    return null
  }

  const upperType = declaredType.toUpperCase()

  // Numeric types
  if (upperType === 'INT' || upperType === 'FLOAT') {
    return asFiniteNumber(raw)
  }

  // Boolean type
  if (upperType === 'BOOLEAN') {
    if (typeof raw === 'boolean') return raw
    if (typeof raw === 'string') {
      const ls = raw.trim().toLowerCase()
      if (ls === 'true') return true
      if (ls === 'false') return false
    }
    return null
  }

  // COMBO type - preserve string/numeric values (for options like [5, "10"])
  if (upperType === 'COMBO') {
    if (typeof raw === 'number') return raw
    if (typeof raw === 'boolean') return raw
    return String(raw).trim().toLowerCase()
  }

  // String/other types - return as lowercase trimmed string
  return String(raw).trim().toLowerCase()
}

const buildJsonataContext = (
  node: LGraphNode,
  rule: JsonataPricingRule
): JsonataEvalContext => {
  const widgets: Record<string, NormalizedWidgetValue> = {}
  for (const dep of rule.depends_on.widgets) {
    const widget = node.widgets?.find((x: IBaseWidget) => x.name === dep.name)
    widgets[dep.name] = normalizeWidgetValue(widget?.value, dep.type)
  }

  const inputs: Record<string, { connected: boolean }> = {}
  for (const name of rule.depends_on.inputs) {
    const slot = node.inputs?.find((x: INodeInputSlot) => x.name === name)
    inputs[name] = { connected: slot?.link != null }
  }

  // Count connected inputs per autogrow group
  const inputGroups: Record<string, number> = {}
  for (const groupName of rule.depends_on.input_groups) {
    const prefix = groupName + '.'
    inputGroups[groupName] =
      node.inputs?.filter(
        (inp: INodeInputSlot) =>
          inp.name?.startsWith(prefix) && inp.link != null
      ).length ?? 0
  }

  return { widgets, inputs, inputGroups }
}

const safeValueForSig = (v: unknown): string => {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
    return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

// Signature determines whether we need to re-evaluate when widgets/inputs change.
const buildSignature = (
  ctx: JsonataEvalContext,
  rule: JsonataPricingRule
): string => {
  const parts: string[] = []
  for (const dep of rule.depends_on.widgets) {
    parts.push(`w:${dep.name}=${safeValueForSig(ctx.widgets[dep.name])}`)
  }
  for (const name of rule.depends_on.inputs) {
    parts.push(`i:${name}=${ctx.inputs[name]?.connected ? '1' : '0'}`)
  }
  for (const name of rule.depends_on.input_groups) {
    parts.push(`g:${name}=${ctx.inputGroups[name] ?? 0}`)
  }
  return parts.join('|')
}

// -----------------------------
// Result formatting
// -----------------------------
const formatPricingResult = (
  result: unknown,
  defaults: CreditFormatOptions = {}
): string => {
  if (!result || typeof result !== 'object') return ''

  const r = result as PricingResult

  if (r.type === 'text') {
    return r.text ?? ''
  }

  if (r.type === 'usd') {
    const usd = asFiniteNumber(r.usd)
    if (usd === null) return ''
    const fmt = { ...defaults, ...(r.format ?? {}) }
    return formatCreditsLabel(usd, fmt)
  }

  if (r.type === 'range_usd') {
    const minUsd = asFiniteNumber(r.min_usd)
    const maxUsd = asFiniteNumber(r.max_usd)
    if (minUsd === null || maxUsd === null) return ''
    const fmt = { ...defaults, ...(r.format ?? {}) }
    return formatCreditsRangeLabel(minUsd, maxUsd, fmt)
  }

  if (r.type === 'list_usd') {
    const arr = Array.isArray(r.usd) ? r.usd : null
    if (!arr) return ''

    const usdValues = arr
      .map(asFiniteNumber)
      .filter((x): x is number => x != null)

    if (usdValues.length === 0) return ''

    const fmt = { ...defaults, ...(r.format ?? {}) }
    return formatCreditsListLabel(usdValues, fmt)
  }

  return ''
}

// -----------------------------
// Compile rules (non-fatal)
// -----------------------------
const compileRule = (rule: JsonataPricingRule): CompiledJsonataPricingRule => {
  try {
    return { ...rule, _compiled: jsonata(rule.expr) }
  } catch (e) {
    // Do not crash app on bad expressions; just disable rule.
    console.error('[pricing/jsonata] failed to compile expr:', rule.expr, e)
    return { ...rule, _compiled: null }
  }
}

// -----------------------------
// Rule cache (per-node-type)
// -----------------------------
// Cache compiled rules by node type name to avoid recompiling on every evaluation.
const compiledRulesCache = new Map<string, CompiledJsonataPricingRule | null>()

/**
 * Convert a PriceBadge from node definition to a JsonataPricingRule.
 */
const priceBadgeToRule = (priceBadge: PriceBadge): JsonataPricingRule => ({
  engine: priceBadge.engine ?? 'jsonata',
  depends_on: {
    widgets: priceBadge.depends_on?.widgets ?? [],
    inputs: priceBadge.depends_on?.inputs ?? [],
    input_groups: priceBadge.depends_on?.input_groups ?? []
  },
  expr: priceBadge.expr
})

/**
 * Get or compile a pricing rule for a node type.
 */
const getCompiledRuleForNodeType = (
  nodeName: string,
  priceBadge: PriceBadge | undefined
): CompiledJsonataPricingRule | null => {
  if (!priceBadge) return null

  // Check cache first
  if (compiledRulesCache.has(nodeName)) {
    return compiledRulesCache.get(nodeName) ?? null
  }

  // Compile and cache
  const rule = priceBadgeToRule(priceBadge)
  const compiled = compileRule(rule)
  compiledRulesCache.set(nodeName, compiled)
  return compiled
}

// -----------------------------
// Async evaluation + cache (JSONata 2.x)
// -----------------------------

// Reactive tick to force UI updates when async evaluations resolve.
// We purposely read pricingTick.value inside getNodeDisplayPrice to create a dependency.
const pricingTick = ref(0)

// WeakMaps avoid memory leaks when nodes are removed.
type CacheEntry = { sig: string; label: string }
type InflightEntry = { sig: string; promise: Promise<void> }

const cache = new WeakMap<LGraphNode, CacheEntry>()
const desiredSig = new WeakMap<LGraphNode, string>()
const inflight = new WeakMap<LGraphNode, InflightEntry>()

const DEBUG_JSONATA_PRICING = false

const scheduleEvaluation = (
  node: LGraphNode,
  rule: CompiledJsonataPricingRule,
  ctx: JsonataEvalContext,
  sig: string
) => {
  desiredSig.set(node, sig)

  const running = inflight.get(node)
  if (running && running.sig === sig) return

  if (!rule._compiled) return

  const nodeName = (node.constructor as any)?.nodeData?.name ?? ''

  const promise = Promise.resolve(rule._compiled.evaluate(ctx))
    .then((res) => {
      const label = formatPricingResult(res, rule.result_defaults ?? {})

      // Ignore stale results: if the node changed while we were evaluating,
      // desiredSig will no longer match.
      if (desiredSig.get(node) !== sig) return

      cache.set(node, { sig, label })

      if (DEBUG_JSONATA_PRICING) {
        console.warn('[pricing/jsonata] resolved', nodeName, {
          sig,
          res,
          label
        })
      }
    })
    .catch((err) => {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[pricing/jsonata] evaluation failed', nodeName, err)
      }

      // Cache empty to avoid retry-spam for same signature
      if (desiredSig.get(node) === sig) {
        cache.set(node, { sig, label: '' })
      }
    })
    .finally(() => {
      const cur = inflight.get(node)
      if (cur && cur.sig === sig) inflight.delete(node)

      // Trigger reactive updates for any callers depending on pricingTick
      pricingTick.value++
    })

  inflight.set(node, { sig, promise })
}

/**
 * Get the pricing rule for a node from its nodeData.price_badge field.
 */
const getRuleForNode = (
  node: LGraphNode
): CompiledJsonataPricingRule | undefined => {
  const nodeData = (node.constructor as any)?.nodeData as
    | { name?: string; api_node?: boolean; price_badge?: PriceBadge }
    | undefined

  if (!nodeData?.api_node) return undefined

  const nodeName = nodeData?.name ?? ''
  const priceBadge = nodeData?.price_badge

  if (!priceBadge) return undefined

  const compiled = getCompiledRuleForNodeType(nodeName, priceBadge)
  return compiled ?? undefined
}

// -----------------------------
// Public composable API
// -----------------------------
export const useNodePricing = () => {
  /**
   * Sync getter:
   * - returns cached label for the current node signature when available
   * - schedules async evaluation when needed
   * - remains non-fatal on errors (returns safe fallback '')
   */
  const getNodeDisplayPrice = (node: LGraphNode): string => {
    // Make this function reactive: when async evaluation completes, we bump pricingTick,
    // which causes this getter to recompute in Vue render/computed contexts.
    pricingTick.value

    const nodeData = (node.constructor as any)?.nodeData as
      | { name?: string; api_node?: boolean; price_badge?: PriceBadge }
      | undefined

    if (!nodeData?.api_node) return ''

    const rule = getRuleForNode(node)
    if (!rule) return ''
    if (rule.engine !== 'jsonata') return ''
    if (!rule._compiled) return ''

    const ctx = buildJsonataContext(node, rule)
    const sig = buildSignature(ctx, rule)

    const cached = cache.get(node)
    if (cached && cached.sig === sig) {
      return cached.label
    }

    // Cache miss: start async evaluation.
    // Return last-known label (if any) to avoid flicker; otherwise return empty.
    scheduleEvaluation(node, rule, ctx, sig)
    return cached?.label ?? ''
  }

  /**
   * Expose raw pricing config for tooling/debug UI.
   * (Strips compiled expression from returned object.)
   */
  const getNodePricingConfig = (node: LGraphNode) => {
    const rule = getRuleForNode(node)
    if (!rule) return undefined
    const { _compiled, ...config } = rule
    return config
  }

  /**
   * Caller compatibility helper:
   * returns union of widget dependencies + input dependencies for a node type.
   */
  const getRelevantWidgetNames = (nodeType: string): string[] => {
    const nodeDefStore = useNodeDefStore()
    const nodeDef = nodeDefStore.nodeDefsByName[nodeType]
    if (!nodeDef) return []

    const priceBadge = nodeDef.price_badge
    if (!priceBadge) return []

    const dependsOn = priceBadge.depends_on ?? { widgets: [], inputs: [] }

    // Extract widget names
    const widgetNames = (dependsOn.widgets ?? []).map((w) => w.name)

    // Keep stable output (dedupe while preserving order)
    const out: string[] = []
    for (const n of [...widgetNames, ...(dependsOn.inputs ?? [])]) {
      if (!out.includes(n)) out.push(n)
    }
    return out
  }

  return {
    getNodeDisplayPrice,
    getNodePricingConfig,
    getRelevantWidgetNames,
    pricingRevision: readonly(pricingTick) // reactive invalidation signal
  }
}
