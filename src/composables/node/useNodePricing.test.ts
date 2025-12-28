import { describe, expect, it } from 'vitest'

import { formatCreditsFromUsd } from '@/base/credits/comfyCredits'
import { useNodePricing } from '@/composables/node/useNodePricing'
import type { LGraphNode } from '@/lib/litegraph/src/litegraph'
import type { PriceBadge } from '@/schemas/nodeDefSchema'

// -----------------------------------------------------------------------------
// Test Helpers
// -----------------------------------------------------------------------------

const CREDIT_NUMBER_OPTIONS: Intl.NumberFormatOptions = {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
}

const creditValue = (usd: number): string =>
  formatCreditsFromUsd({ usd, numberOptions: CREDIT_NUMBER_OPTIONS })

const creditsLabel = (usd: number, suffix = '/Run'): string =>
  `${creditValue(usd)} credits${suffix}`

/**
 * Create a mock node with price_badge for testing JSONata-based pricing.
 */
function createMockNodeWithPriceBadge(
  nodeTypeName: string,
  priceBadge: PriceBadge,
  widgets: Array<{ name: string; value: unknown }> = [],
  inputs: Array<{ name: string; connected?: boolean }> = []
): LGraphNode {
  const mockWidgets = widgets.map(({ name, value }) => ({
    name,
    value,
    type: 'combo'
  }))

  const mockInputs = inputs.map(({ name, connected }) => ({
    name,
    link: connected ? 1 : null
  }))

  const node: any = {
    id: Math.random().toString(),
    widgets: mockWidgets,
    inputs: mockInputs,
    constructor: {
      nodeData: {
        name: nodeTypeName,
        api_node: true,
        price_badge: priceBadge
      }
    }
  }

  return node as LGraphNode
}

/** Helper to create a price badge with defaults */
const priceBadge = (
  expr: string,
  widgets: Array<{ name: string; type: string }> = [],
  inputs: string[] = [],
  inputGroups: string[] = []
): PriceBadge => ({
  engine: 'jsonata',
  expr,
  depends_on: { widgets, inputs, input_groups: inputGroups }
})

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('useNodePricing', () => {
  describe('static expressions', () => {
    it('should evaluate simple static USD price', async () => {
      const { getNodeDisplayPrice } = useNodePricing()
      const node = createMockNodeWithPriceBadge(
        'TestStaticNode',
        priceBadge('{"type":"usd","usd":0.05}')
      )

      getNodeDisplayPrice(node)
      await new Promise((r) => setTimeout(r, 50))
      const price = getNodeDisplayPrice(node)
      expect(price).toBe(creditsLabel(0.05))
    })

    it('should evaluate static text result', async () => {
      const { getNodeDisplayPrice } = useNodePricing()
      const node = createMockNodeWithPriceBadge(
        'TestTextNode',
        priceBadge('{"type":"text","text":"Free"}')
      )

      getNodeDisplayPrice(node)
      await new Promise((r) => setTimeout(r, 50))
      const price = getNodeDisplayPrice(node)
      expect(price).toBe('Free')
    })
  })

  describe('widget value normalization', () => {
    it('should handle INT widget as number', async () => {
      const { getNodeDisplayPrice } = useNodePricing()
      const node = createMockNodeWithPriceBadge(
        'TestIntNode',
        priceBadge('{"type":"usd","usd": widgets.count * 0.01}', [
          { name: 'count', type: 'INT' }
        ]),
        [{ name: 'count', value: 5 }]
      )

      getNodeDisplayPrice(node)
      await new Promise((r) => setTimeout(r, 50))
      const price = getNodeDisplayPrice(node)
      expect(price).toBe(creditsLabel(0.05))
    })

    it('should handle FLOAT widget as number', async () => {
      const { getNodeDisplayPrice } = useNodePricing()
      const node = createMockNodeWithPriceBadge(
        'TestFloatNode',
        priceBadge('{"type":"usd","usd": widgets.rate * 10}', [
          { name: 'rate', type: 'FLOAT' }
        ]),
        [{ name: 'rate', value: 0.05 }]
      )

      getNodeDisplayPrice(node)
      await new Promise((r) => setTimeout(r, 50))
      const price = getNodeDisplayPrice(node)
      expect(price).toBe(creditsLabel(0.5))
    })

    it('should handle COMBO widget with numeric value', async () => {
      const { getNodeDisplayPrice } = useNodePricing()
      const node = createMockNodeWithPriceBadge(
        'TestComboNumericNode',
        priceBadge('{"type":"usd","usd": widgets.duration * 0.07}', [
          { name: 'duration', type: 'COMBO' }
        ]),
        [{ name: 'duration', value: 5 }]
      )

      getNodeDisplayPrice(node)
      await new Promise((r) => setTimeout(r, 50))
      const price = getNodeDisplayPrice(node)
      expect(price).toBe(creditsLabel(0.35))
    })

    it('should handle COMBO widget with string value', async () => {
      const { getNodeDisplayPrice } = useNodePricing()
      const node = createMockNodeWithPriceBadge(
        'TestComboStringNode',
        priceBadge(
          '(widgets.mode = "pro") ? {"type":"usd","usd":0.10} : {"type":"usd","usd":0.05}',
          [{ name: 'mode', type: 'COMBO' }]
        ),
        [{ name: 'mode', value: 'Pro' }] // Should be lowercased to "pro"
      )

      getNodeDisplayPrice(node)
      await new Promise((r) => setTimeout(r, 50))
      const price = getNodeDisplayPrice(node)
      expect(price).toBe(creditsLabel(0.1))
    })

    it('should handle BOOLEAN widget', async () => {
      const { getNodeDisplayPrice } = useNodePricing()
      const node = createMockNodeWithPriceBadge(
        'TestBooleanNode',
        priceBadge('{"type":"usd","usd": widgets.premium ? 0.10 : 0.05}', [
          { name: 'premium', type: 'BOOLEAN' }
        ]),
        [{ name: 'premium', value: true }]
      )

      getNodeDisplayPrice(node)
      await new Promise((r) => setTimeout(r, 50))
      const price = getNodeDisplayPrice(node)
      expect(price).toBe(creditsLabel(0.1))
    })

    it('should handle STRING widget (lowercased)', async () => {
      const { getNodeDisplayPrice } = useNodePricing()
      const node = createMockNodeWithPriceBadge(
        'TestStringNode',
        priceBadge(
          '$contains(widgets.model, "pro") ? {"type":"usd","usd":0.10} : {"type":"usd","usd":0.05}',
          [{ name: 'model', type: 'STRING' }]
        ),
        [{ name: 'model', value: 'ProModel' }] // Should be lowercased to "promodel"
      )

      getNodeDisplayPrice(node)
      await new Promise((r) => setTimeout(r, 50))
      const price = getNodeDisplayPrice(node)
      expect(price).toBe(creditsLabel(0.1))
    })
  })

  describe('complex expressions', () => {
    it('should handle lookup tables', async () => {
      const { getNodeDisplayPrice } = useNodePricing()
      const node = createMockNodeWithPriceBadge(
        'TestLookupNode',
        priceBadge(
          `(
            $rates := {"720p": 0.05, "1080p": 0.10};
            {"type":"usd","usd": $lookup($rates, widgets.resolution)}
          )`,
          [{ name: 'resolution', type: 'COMBO' }]
        ),
        [{ name: 'resolution', value: '1080p' }]
      )

      getNodeDisplayPrice(node)
      await new Promise((r) => setTimeout(r, 50))
      const price = getNodeDisplayPrice(node)
      expect(price).toBe(creditsLabel(0.1))
    })

    it('should handle multiple widgets', async () => {
      const { getNodeDisplayPrice } = useNodePricing()
      const node = createMockNodeWithPriceBadge(
        'TestMultiWidgetNode',
        priceBadge(
          `(
            $rate := (widgets.mode = "pro") ? 0.10 : 0.05;
            {"type":"usd","usd": $rate * widgets.duration}
          )`,
          [
            { name: 'mode', type: 'COMBO' },
            { name: 'duration', type: 'INT' }
          ]
        ),
        [
          { name: 'mode', value: 'pro' },
          { name: 'duration', value: 10 }
        ]
      )

      getNodeDisplayPrice(node)
      await new Promise((r) => setTimeout(r, 50))
      const price = getNodeDisplayPrice(node)
      expect(price).toBe(creditsLabel(1.0))
    })

    it('should handle conditional pricing based on widget values', async () => {
      const { getNodeDisplayPrice } = useNodePricing()
      const node = createMockNodeWithPriceBadge(
        'TestConditionalNode',
        priceBadge(
          `(
            $mode := (widgets.resolution = "720p") ? "std" : "pro";
            $rates := {"std": 0.084, "pro": 0.112};
            {"type":"usd","usd": $lookup($rates, $mode) * widgets.duration}
          )`,
          [
            { name: 'resolution', type: 'COMBO' },
            { name: 'duration', type: 'COMBO' }
          ]
        ),
        [
          { name: 'resolution', value: '1080p' },
          { name: 'duration', value: 5 }
        ]
      )

      getNodeDisplayPrice(node)
      await new Promise((r) => setTimeout(r, 50))
      const price = getNodeDisplayPrice(node)
      expect(price).toBe(creditsLabel(0.56))
    })
  })

  describe('range and list results', () => {
    it('should format range_usd result', async () => {
      const { getNodeDisplayPrice } = useNodePricing()
      const node = createMockNodeWithPriceBadge(
        'TestRangeNode',
        priceBadge('{"type":"range_usd","min_usd":0.05,"max_usd":0.10}')
      )

      getNodeDisplayPrice(node)
      await new Promise((r) => setTimeout(r, 50))
      const price = getNodeDisplayPrice(node)
      expect(price).toMatch(/\d+-\d+ credits\/Run/)
    })

    it('should format list_usd result', async () => {
      const { getNodeDisplayPrice } = useNodePricing()
      const node = createMockNodeWithPriceBadge(
        'TestListNode',
        priceBadge('{"type":"list_usd","usd":[0.05, 0.10, 0.15]}')
      )

      getNodeDisplayPrice(node)
      await new Promise((r) => setTimeout(r, 50))
      const price = getNodeDisplayPrice(node)
      expect(price).toMatch(/\d+\/\d+\/\d+ credits\/Run/)
    })

    it('should respect custom suffix in format options', async () => {
      const { getNodeDisplayPrice } = useNodePricing()
      const node = createMockNodeWithPriceBadge(
        'TestSuffixNode',
        priceBadge('{"type":"usd","usd":0.07,"format":{"suffix":"/second"}}')
      )

      getNodeDisplayPrice(node)
      await new Promise((r) => setTimeout(r, 50))
      const price = getNodeDisplayPrice(node)
      expect(price).toBe(creditsLabel(0.07, '/second'))
    })
  })

  describe('input connectivity', () => {
    it('should handle connected input check', async () => {
      const { getNodeDisplayPrice } = useNodePricing()
      const node = createMockNodeWithPriceBadge(
        'TestInputNode',
        priceBadge(
          'inputs.image.connected ? {"type":"usd","usd":0.10} : {"type":"usd","usd":0.05}',
          [],
          ['image']
        ),
        [],
        [{ name: 'image', connected: true }]
      )

      getNodeDisplayPrice(node)
      await new Promise((r) => setTimeout(r, 50))
      const price = getNodeDisplayPrice(node)
      expect(price).toBe(creditsLabel(0.1))
    })

    it('should handle disconnected input check', async () => {
      const { getNodeDisplayPrice } = useNodePricing()
      const node = createMockNodeWithPriceBadge(
        'TestInputDisconnectedNode',
        priceBadge(
          'inputs.image.connected ? {"type":"usd","usd":0.10} : {"type":"usd","usd":0.05}',
          [],
          ['image']
        ),
        [],
        [{ name: 'image', connected: false }]
      )

      getNodeDisplayPrice(node)
      await new Promise((r) => setTimeout(r, 50))
      const price = getNodeDisplayPrice(node)
      expect(price).toBe(creditsLabel(0.05))
    })
  })

  describe('edge cases', () => {
    it('should return empty string for non-API nodes', () => {
      const { getNodeDisplayPrice } = useNodePricing()
      const node: any = {
        id: 'test',
        widgets: [],
        constructor: {
          nodeData: {
            name: 'RegularNode',
            api_node: false
          }
        }
      }

      const price = getNodeDisplayPrice(node)
      expect(price).toBe('')
    })

    it('should return empty string for nodes without price_badge', () => {
      const { getNodeDisplayPrice } = useNodePricing()
      const node: any = {
        id: 'test',
        widgets: [],
        constructor: {
          nodeData: {
            name: 'ApiNodeNoPricing',
            api_node: true
          }
        }
      }

      const price = getNodeDisplayPrice(node)
      expect(price).toBe('')
    })

    it('should handle null widget value gracefully', async () => {
      const { getNodeDisplayPrice } = useNodePricing()
      const node = createMockNodeWithPriceBadge(
        'TestNullWidgetNode',
        priceBadge(
          '{"type":"usd","usd": (widgets.count != null) ? widgets.count * 0.01 : 0.05}',
          [{ name: 'count', type: 'INT' }]
        ),
        [{ name: 'count', value: null }]
      )

      getNodeDisplayPrice(node)
      await new Promise((r) => setTimeout(r, 50))
      const price = getNodeDisplayPrice(node)
      expect(price).toBe(creditsLabel(0.05))
    })

    it('should handle missing widget gracefully', async () => {
      const { getNodeDisplayPrice } = useNodePricing()
      const node = createMockNodeWithPriceBadge(
        'TestMissingWidgetNode',
        priceBadge(
          '{"type":"usd","usd": (widgets.count != null) ? widgets.count * 0.01 : 0.05}',
          [{ name: 'count', type: 'INT' }]
        ),
        []
      )

      getNodeDisplayPrice(node)
      await new Promise((r) => setTimeout(r, 50))
      const price = getNodeDisplayPrice(node)
      expect(price).toBe(creditsLabel(0.05))
    })

    it('should handle undefined widget value gracefully', async () => {
      const { getNodeDisplayPrice } = useNodePricing()
      const node = createMockNodeWithPriceBadge(
        'TestUndefinedWidgetNode',
        priceBadge(
          '{"type":"usd","usd": (widgets.count != null) ? widgets.count * 0.01 : 0.05}',
          [{ name: 'count', type: 'INT' }]
        ),
        [{ name: 'count', value: undefined }]
      )

      getNodeDisplayPrice(node)
      await new Promise((r) => setTimeout(r, 50))
      const price = getNodeDisplayPrice(node)
      expect(price).toBe(creditsLabel(0.05))
    })
  })

  describe('getNodePricingConfig', () => {
    it('should return pricing config for nodes with price_badge', () => {
      const { getNodePricingConfig } = useNodePricing()
      const node = createMockNodeWithPriceBadge(
        'TestConfigNode',
        priceBadge('{"type":"usd","usd":0.05}')
      )

      const config = getNodePricingConfig(node)
      expect(config).toBeDefined()
      expect(config?.engine).toBe('jsonata')
      expect(config?.expr).toBe('{"type":"usd","usd":0.05}')
      expect(config?.depends_on).toBeDefined()
    })

    it('should return undefined for nodes without price_badge', () => {
      const { getNodePricingConfig } = useNodePricing()
      const node: any = {
        id: 'test',
        widgets: [],
        constructor: {
          nodeData: {
            name: 'NoPricingNode',
            api_node: true
          }
        }
      }

      const config = getNodePricingConfig(node)
      expect(config).toBeUndefined()
    })

    it('should return undefined for non-API nodes', () => {
      const { getNodePricingConfig } = useNodePricing()
      const node: any = {
        id: 'test',
        widgets: [],
        constructor: {
          nodeData: {
            name: 'RegularNode',
            api_node: false
          }
        }
      }

      const config = getNodePricingConfig(node)
      expect(config).toBeUndefined()
    })
  })
})
