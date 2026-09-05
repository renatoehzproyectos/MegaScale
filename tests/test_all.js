/**
 * Test suite for MegaScale (Phases 1 - 6)
 */

import assert from 'node:assert';
import { PerformancePredictor } from '../core/predictor/PerformancePredictor.js';
import { OscillationDetector } from '../core/scheduler/OscillationDetector.js';
import { BottleneckEngine } from '../optimization/draw-call/BottleneckEngine.js';
import { OptimizationGraph } from '../optimization/presentation/OptimizationGraph.js';
import { TemporalUpscaler } from '../upscaling/temporal/TemporalUpscaler.js';
import { MemoryManager } from '../optimization/memory/MemoryManager.js';
import { CPUMonitor } from '../benchmark/cpu/CPUMonitor.js';
import { MemoryProfiler } from '../benchmark/memory/MemoryProfiler.js';
import { ShaderOptimizer } from '../optimization/shader/ShaderOptimizer.js';
import { FramebufferOptimizer } from '../optimization/framebuffer/FramebufferOptimizer.js';
import { ProfileManager, PROFILES } from '../profiles/ProfileManager.js';
import { BenchmarkSuite } from '../benchmark/regression/BenchmarkSuite.js';
import { CompatibilityManager } from '../detection/renderer-detection/CompatibilityManager.js';
import MegaScale from '../dist/megascale.js';

console.log('--- RUNNING MEGASCALE VERIFICATION SUITE ---');

// 1. Predictor & Anti-Oscillation
console.log('[Test 1] Predictor & OscillationDetector');
const predictor = new PerformancePredictor();
predictor.addSample(1.0, 30);
predictor.addSample(0.8, 42);
predictor.addSample(0.6, 60);
assert(predictor.hasModel(), 'Predictor should build model with 3 points');
const predictedFps = predictor.predictFps(0.7);
assert(predictedFps > 30 && predictedFps < 65, 'Predicted FPS should be in reasonable range');

const osc = new OscillationDetector();
osc.recordChange('down');
osc.recordChange('up');
osc.recordChange('down');
osc.recordChange('up');
assert(osc.isOscillating(), 'Should detect flip-flop oscillation');

// 2. Bottleneck Engine & Optimization Graph
console.log('[Test 2] BottleneckEngine & OptimizationGraph');
const bn = new BottleneckEngine();
bn.record(1.0, 30);
bn.record(0.8, 45);
bn.record(0.6, 62);
const bnResult = bn.detect();
assert(bnResult.bottleneck === 'gpu-bound', 'Negative correlation between scale^2 and FPS should be gpu-bound');

const optGraph = new OptimizationGraph();
const config = optGraph.proposeConfiguration({ gpuTier: 2, bottleneck: 'gpu-bound', webgpuAvailable: false });
assert(config.profile === 'performance', 'GPU tier 2 should suggest performance profile');
assert(config.dynamicResolution === true, 'Dynamic resolution should be active for GPU bound');

// 3. Temporal Upscaler Halton Sequence & WGSL
console.log('[Test 3] TemporalUpscaler');
const dummyBackend = { isReady: false };
const temporal = new TemporalUpscaler(dummyBackend);
const j1 = temporal.getNextJitter();
const j2 = temporal.getNextJitter();
assert(typeof j1.x === 'number' && typeof j1.y === 'number', 'Jitter x/y should be numbers');
assert(j1.x !== j2.x || j1.y !== j2.y, 'Consecutive jitter samples should differ');

// 4. MemoryManager
console.log('[Test 4] MemoryManager');
const mm = new MemoryManager({ maxBudgetMB: 64 });
const fakeTexture = { id: 101 };
const resId = mm.register('texture', fakeTexture, 1024 * 1024);
assert(mm.allocatedBytes === 1024 * 1024, 'MemoryManager should record 1MB');
mm.unregister(resId);
assert(mm.allocatedBytes === 0, 'MemoryManager should subtract released bytes');

// 5. CPUMonitor & MemoryProfiler
console.log('[Test 5] CPUMonitor & MemoryProfiler');
const cpu = new CPUMonitor();
const t0 = cpu.startFrame();
cpu.endFrame(t0);
const metrics = cpu.getMetrics();
assert(typeof metrics.avgCpuMs === 'number', 'CPU metrics should return avgCpuMs');

const memProf = new MemoryProfiler();
memProf.setAllocatedVram(16 * 1024 * 1024);
const memSample = memProf.sample();
assert(memSample.vramMB === 16, 'MemoryProfiler should track VRAM');

// 6. ShaderOptimizer & FramebufferOptimizer
console.log('[Test 6] ShaderOptimizer & FramebufferOptimizer');
const glslTest = `
precision highp float;
uniform sampler2D tex;
in vec2 uv;
out vec4 color;
void main() {
  float a = 1.0 / 2.0;
  color = texture(tex, uv) * a;
}
`;
const analysis = ShaderOptimizer.analyze(glslTest);
assert(analysis.hints.length > 0, 'ShaderOptimizer should produce optimization hints');
const optCode = ShaderOptimizer.optimizeSafe(glslTest, { targetPrecision: 'mediump' });
assert(optCode.includes('precision mediump float;'), 'ShaderOptimizer should apply precision change');

const fboOpt = new FramebufferOptimizer(null);
const fboConfig = fboOpt.getRecommendedFBOConfig({ extensions: ['EXT_color_buffer_float'] });
assert(fboConfig.useHalfFloat === true, 'FBO optimizer should suggest half float');

// 7. ProfileManager
console.log('[Test 7] ProfileManager');
const pm = new ProfileManager('balanced');
assert(pm.activeProfile.name === 'balanced');
const autoProf = pm.resolveAutoProfile(1, 'gpu');
assert(autoProf.name === 'ultra-performance', 'Tier 1 GPU should resolve to ultra-performance');

// 8. BenchmarkSuite (8 scenes)
console.log('[Test 8] BenchmarkSuite (Scientific 8 Scenes)');
const suite = new BenchmarkSuite();
const suiteResults = suite.runAll();
assert(suiteResults.scenes.length === 8, 'BenchmarkSuite should evaluate all 8 scenes');
assert(suiteResults.allPassed === true, 'All 8 scenes must pass validation');
assert(suiteResults.avgNetGainPct > 0, 'Average net gain must be positive');
console.log(`Average Net Performance Gain: +${suiteResults.avgNetGainPct}%`);

// 9. CompatibilityManager & MegaScale Entry Point
console.log('[Test 9] CompatibilityManager & MegaScale export');
const mockCanvas = { width: 800, height: 600, getContext: () => null };
const compat = new CompatibilityManager(mockCanvas);
const adapter = compat.resolveAdapter({ renderer: 'canvas2d', canvas2d: true });
compat.applyScale(0.75);
assert(mockCanvas.width === 600 && mockCanvas.height === 450, 'Canvas scale should be 600x450');

assert(MegaScale.version === '1.0.0', 'MegaScale version should be 1.0.0');
console.log('--- ALL TESTS PASSED SUCCESSFULLY! ---');
