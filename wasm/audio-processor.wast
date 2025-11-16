(module
  ;; Memory section - 1MB page
  (memory (export "memory") 1)

  ;; Console log function for debugging
  (func $console.log (import "console" "log") (param i32 i32))

  ;; WebAssembly audio processor functions

  ;; Volume adjustment function
  ;; apply_volume(ptr: i32, length: i32, volume: f32) -> void
  (func (export "apply_volume") (param $ptr i32) (param $len i32) (param $vol f32)
    (local $i i32)
    (local $sample f32)

    (local.set $i (i32.const 0))

    (loop $loop
      ;; Load float32 at ptr + i*4
      (local.set $sample (f32.load (i32.add (local.get $ptr) (i32.shl (local.get $i) (i32.const 2)))))
      ;; Multiply by volume
      (local.set $sample (f32.mul (local.get $sample) (local.get $vol)))
      ;; Store back
      (f32.store (i32.add (local.get $ptr) (i32.shl (local.get $i) (i32.const 2))) (local.get $sample))

      ;; Increment counter
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      ;; Continue loop if i < length
      (br_if $loop (i32.lt_u (local.get $i) (local.get $len)))
    )
  )

  ;; Echo effect function
  ;; apply_echo(inputPtr: i32, outputPtr: i32, length: i32, delaySamples: i32, decay: f32) -> void
  (func (export "apply_echo") (param $inputPtr i32) (param $outputPtr i32) (param $len i32) (param $delay i32) (param $decay f32)
    (local $i i32)
    (local $currentSample f32)
    (local $delayedSample f32)

    (local.set $i (i32.const 0))

    (loop $loop
      ;; Load current sample from input
      (local.set $currentSample (f32.load (i32.add (local.get $inputPtr) (i32.shl (local.get $i) (i32.const 2)))))
      ;; Store original sample to output
      (f32.store (i32.add (local.get $outputPtr) (i32.shl (local.get $i) (i32.const 2))) (local.get $currentSample))

      ;; Add echo if we're past the delay
      (if (i32.ge_u (local.get $i) (local.get $delay))
        (then
          ;; Load delayed sample from input
          (local.set $delayedSample (f32.load (i32.add (local.get $inputPtr) (i32.shl (i32.sub (local.get $i) (local.get $delay)) (i32.const 2)))))
          ;; Apply decay and add to current sample in output
          (local.set $delayedSample (f32.mul (local.get $delayedSample) (local.get $decay)))
          (local.set $currentSample (f32.add (local.get $currentSample) (local.get $delayedSample)))
          ;; Store the result back to output
          (f32.store (i32.add (local.get $outputPtr) (i32.shl (local.get $i) (i32.const 2))) (local.get $currentSample))
        )
      )

      ;; Increment counter
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      ;; Continue loop if i < length
      (br_if $loop (i32.lt_u (local.get $i) (local.get $len)))
    )
  )

  ;; Malloc function (simple bump allocator)
  (global $heap (mut i32) (i32.const 65536)) ;; Start heap at 64KB

  (func (export "malloc") (param $size i32) (result i32)
    (local $ptr i32)
    (global.get $heap)
    ;; Align to 4 bytes
    (local.set $ptr (i32.and (i32.add (global.get $heap) (i32.const 3)) (i32.const 0xFFFFFFFC)))
    (global.set $heap (i32.add (local.get $ptr) (local.get $size)))
    (local.get $ptr)
  )

  ;; Free function (no-op for now)
  (func (export "free") (param $ptr i32)
    ;; Just a placeholder - no actual memory management
  )

  ;; Test function for validation
  (func (export "add") (param $a i32) (param $b i32) (result i32)
    (i32.add (local.get $a) (local.get $b))
  )
)
