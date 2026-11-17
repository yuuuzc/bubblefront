// Fixed-timestep driver: the sim always advances in 1/60s slices no matter what
// the display refresh rate is, and hands the renderer an interpolation alpha.
export function createLoop({ msPerTick, onStep, onRender, maxSteps = 6 }) {
  let acc = 0;
  let last = 0;
  let speed = 1;
  let paused = false;
  let raf = 0;
  let frameCount = 0;

  const frame = (now) => {
    if (!last) last = now;
    let dt = now - last;
    last = now;
    if (dt > 250) dt = msPerTick;          // returning from a background tab
    if (!paused) acc += dt * speed;
    let steps = 0;
    while (acc >= msPerTick && steps < maxSteps) {
      onStep();
      acc -= msPerTick;
      steps++;
    }
    if (steps === maxSteps && acc >= msPerTick) acc = 0;   // give up catch-up
    onRender(paused ? 1 : acc / msPerTick, steps);
    frameCount++;
    raf = requestAnimationFrame(frame);
  };

  return {
    start() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } },
    stop() { if (raf) cancelAnimationFrame(raf); raf = 0; },
    setSpeed(v) { speed = v; },
    getSpeed: () => speed,
    setPaused(v) { paused = v; if (v) acc = 0; },
    getPaused: () => paused,
    get fpsFrames() { return frameCount; },
    stepOnce() { onStep(); },
  };
}
