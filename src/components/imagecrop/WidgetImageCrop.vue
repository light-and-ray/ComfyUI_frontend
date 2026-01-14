<template>
  <div
    class="widget-expands relative flex h-full w-full flex-col gap-1"
    @pointerdown.stop
    @pointermove.stop
    @pointerup.stop
  >
    <!-- Image preview container -->
    <div
      ref="containerEl"
      class="relative min-h-0 flex-1 overflow-hidden rounded-[5px] bg-node-component-surface"
    >
      <div v-if="isLoading" class="flex size-full items-center justify-center">
        <span class="text-sm">{{ $t('imageCrop.loading') }}</span>
      </div>

      <div
        v-else-if="!imageUrl"
        class="flex size-full flex-col items-center justify-center text-center"
      >
        <i class="mb-2 icon-[lucide--image] h-12 w-12" />
        <p class="text-sm">{{ $t('imageCrop.noInputImage') }}</p>
      </div>

      <img
        v-else
        ref="imageEl"
        :src="imageUrl"
        :alt="$t('imageCrop.cropPreviewAlt')"
        draggable="false"
        class="block size-full object-contain select-none brightness-50"
        @load="handleImageLoad"
        @error="handleImageError"
        @dragstart.prevent
      />

      <div
        v-if="imageUrl && !isLoading"
        class="absolute box-content cursor-move overflow-hidden border-2 border-white"
        :style="cropBoxStyle"
        @pointerdown="handleDragStart"
        @pointermove="handleDragMove"
        @pointerup="handleDragEnd"
      >
        <div class="pointer-events-none size-full" :style="cropImageStyle" />
      </div>

      <div
        v-for="handle in resizeHandles"
        v-show="imageUrl && !isLoading"
        :key="handle.direction"
        :class="['absolute', handle.class]"
        :style="handle.style"
        @pointerdown="(e) => handleResizeStart(e, handle.direction)"
        @pointermove="handleResizeMove"
        @pointerup="handleResizeEnd"
      />
    </div>

    <!-- Number inputs -->
    <div class="grid shrink-0 grid-cols-[auto_1fr] gap-x-2 gap-y-1">
      <label class="content-center text-xs text-node-component-slot-text">
        {{ $t('imageCrop.x') }}
      </label>
      <input
        v-model.number="cropX"
        type="number"
        :min="0"
        class="h-7 rounded-lg border-none bg-component-node-widget-background px-2 text-xs text-component-node-foreground focus:outline-0"
      />
      <label class="content-center text-xs text-node-component-slot-text">
        {{ $t('imageCrop.y') }}
      </label>
      <input
        v-model.number="cropY"
        type="number"
        :min="0"
        class="h-7 rounded-lg border-none bg-component-node-widget-background px-2 text-xs text-component-node-foreground focus:outline-0"
      />
      <label class="content-center text-xs text-node-component-slot-text">
        {{ $t('imageCrop.width') }}
      </label>
      <input
        v-model.number="cropWidth"
        type="number"
        :min="1"
        class="h-7 rounded-lg border-none bg-component-node-widget-background px-2 text-xs text-component-node-foreground focus:outline-0"
      />
      <label class="content-center text-xs text-node-component-slot-text">
        {{ $t('imageCrop.height') }}
      </label>
      <input
        v-model.number="cropHeight"
        type="number"
        :min="1"
        class="h-7 rounded-lg border-none bg-component-node-widget-background px-2 text-xs text-component-node-foreground focus:outline-0"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTemplateRef } from 'vue'

import { useImageCrop } from '@/composables/useImageCrop'
import type { CropRegionValue } from '@/lib/litegraph/src/types/widgets'
import type { NodeId } from '@/platform/workflow/validation/schemas/workflowSchema'

const props = defineProps<{
  nodeId: NodeId
}>()

const modelValue = defineModel<CropRegionValue>({
  default: () => ({ x: 0, y: 0, width: 512, height: 512 })
})

const imageEl = useTemplateRef<HTMLImageElement>('imageEl')
const containerEl = useTemplateRef<HTMLDivElement>('containerEl')

const {
  imageUrl,
  isLoading,

  cropX,
  cropY,
  cropWidth,
  cropHeight,

  cropBoxStyle,
  cropImageStyle,
  resizeHandles,

  handleImageLoad,
  handleImageError,
  handleDragStart,
  handleDragMove,
  handleDragEnd,
  handleResizeStart,
  handleResizeMove,
  handleResizeEnd
} = useImageCrop(props.nodeId, { imageEl, containerEl, modelValue })
</script>
