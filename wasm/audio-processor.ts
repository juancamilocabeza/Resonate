export declare function logString(ptr: i32, len: i32): void;

// Volume adjustment function using direct memory access
export function apply_volume(length: i32, volume: f32): i32 {
  const inputPtr = 0; // Assume input data starts at memory offset 0
  const result = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    const samplePtr = inputPtr + (i * 4); // Float32 = 4 bytes
    const sample = load<f32>(samplePtr);
    result[i] = sample * volume;
  }

  // Copy result back to memory (overwriting input)
  for (let i = 0; i < length; i++) {
    const samplePtr = inputPtr + (i * 4);
    store<f32>(samplePtr, result[i]);
  }

  return 0; // Success
}

// Simplified volume adjustment that takes a pointer
export function apply_volume_ptr(ptr: i32, length: i32, volume: f32): void {
  for (let i = 0; i < length; i++) {
    const samplePtr = ptr + (i * 4); // Float32 = 4 bytes
    const currentSample = load<f32>(samplePtr);
    store<f32>(samplePtr, currentSample * volume);
  }
}

// Echo effect function (simplified)
export function apply_echo(ptr: i32, length: i32, delaySamples: i32, decay: f32): void {
  for (let i = 0; i < length; i++) {
    const currentSamplePtr = ptr + (i * 4);
    const currentSample = load<f32>(currentSamplePtr);

    if (i >= delaySamples) {
      const delayedSamplePtr = ptr + ((i - delaySamples) * 4);
      const delayedSample = load<f32>(delayedSamplePtr);
      store<f32>(currentSamplePtr, currentSample + (delayedSample * decay));
    }
  }
}

// Simple test function
export function add(x: i32, y: i32): i32 {
  return x + y;
}
