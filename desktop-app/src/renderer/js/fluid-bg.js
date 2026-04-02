/* ═══════════════════════════════════════════════════════════════════
   Pure Path — Interactive Fluid Background (Three.js + GLSL)
   "Electric Ether" — deep midnight base, violet & blue liquid flow
   ═══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const canvas = document.getElementById('fluid-canvas');
  if (!canvas || typeof THREE === 'undefined') return;

  /* ─── Fragment Shader ──────────────────────────────────────────── */
  const fragmentShader = `
    precision highp float;

    uniform float uTime;
    uniform vec2  uMouse;
    uniform vec2  uResolution;
    uniform vec3  uColorBg;
    uniform vec3  uColorViolet;
    uniform vec3  uColorBlue;
    uniform vec3  uColorDarkViolet;
    uniform vec3  uColorFrost;

    // ── Simplex 2D noise ──
    vec3 mod289(vec3 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
    vec2 mod289v2(vec2 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
    vec3 permute(vec3 x) { return mod289((x * 34.0 + 1.0) * x); }

    float snoise(vec2 v) {
      const vec4 C = vec4(
        0.211324865405187,   // (3.0-sqrt(3.0))/6.0
        0.366025403784439,   //  0.5*(sqrt(3.0)-1.0)
       -0.577350269189626,   // -1.0+2.0*C.x
        0.024390243902439    //  1.0/41.0
      );
      vec2 i = floor(v + dot(v, C.yy));
      vec2 x0 = v - i + dot(i, C.xx);
      vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      vec4 x12 = x0.xyxy + C.xxzz;
      x12.xy -= i1;
      i = mod289v2(i);
      vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
                                + i.x + vec3(0.0, i1.x, 1.0));
      vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
      m = m * m;
      m = m * m;
      vec3 x_  = 2.0 * fract(p * C.www) - 1.0;
      vec3 h   = abs(x_) - 0.5;
      vec3 ox  = floor(x_ + 0.5);
      vec3 a0  = x_ - ox;
      m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
      vec3 g;
      g.x  = a0.x  * x0.x  + h.x  * x0.y;
      g.yz = a0.yz * x12.xz + h.yz * x12.yw;
      return 130.0 * dot(m, g);
    }

    // ── Fractal Brownian Motion ──
    float fbm(vec2 p) {
      float value = 0.0;
      float amplitude = 0.5;
      float frequency = 1.0;
      for (int i = 0; i < 5; i++) {
        value += amplitude * snoise(p * frequency);
        amplitude *= 0.5;
        frequency *= 2.0;
      }
      return value;
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / uResolution.xy;
      float aspect = uResolution.x / uResolution.y;
      vec2 p = vec2(uv.x * aspect, uv.y);

      float t = uTime * 0.06;

      // Mouse influence (smooth, calm ripple)
      vec2 mouse = vec2(uMouse.x * aspect, uMouse.y);
      float mouseDist = length(p - mouse);
      float mouseRipple = smoothstep(0.45, 0.0, mouseDist) * 0.12;
      float mouseWarp = sin(mouseDist * 12.0 - uTime * 1.5) * mouseRipple;

      // Flowing warped coordinates
      vec2 q = vec2(
        fbm(p + vec2(0.0, 0.0) + t),
        fbm(p + vec2(5.2, 1.3) + t * 0.7)
      );
      vec2 r = vec2(
        fbm(p + 4.0 * q + vec2(1.7, 9.2) + t * 0.3 + mouseWarp),
        fbm(p + 4.0 * q + vec2(8.3, 2.8) + t * 0.4 + mouseWarp)
      );

      float f = fbm(p + 3.5 * r);

      // Color palette from uniforms
      vec3 deepBg    = uColorBg;
      vec3 violet    = uColorViolet;
      vec3 blue      = uColorBlue;
      vec3 darkViolet= uColorDarkViolet;
      vec3 frostHint = uColorFrost;

      // Layer mixing
      vec3 color = deepBg;
      color = mix(color, darkViolet * 0.5, clamp(f * 0.8, 0.0, 1.0));
      color = mix(color, violet * 0.3,     clamp(length(q) * 0.6, 0.0, 1.0));
      color = mix(color, blue * 0.2,       clamp(r.x * 0.7, 0.0, 1.0));

      // Subtle frost highlights near mouse
      color += frostHint * mouseRipple * 0.4;

      // Vignette (darken edges)
      float vig = 1.0 - smoothstep(0.3, 1.1, length(uv - 0.5) * 1.3);
      color *= (0.65 + 0.35 * vig);

      // Final output — keep it subtle and calming
      color = mix(deepBg, color, 0.65);

      gl_FragColor = vec4(color, 1.0);
    }
  `;

  const vertexShader = `
    void main() {
      gl_Position = vec4(position, 1.0);
    }
  `;

  /* ─── Three.js Setup ───────────────────────────────────────────── */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 1;

  const uniforms = {
    uTime: { value: 0.0 },
    uMouse: { value: new THREE.Vector2(0.5, 0.5) },
    uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    uColorBg: { value: new THREE.Color(0.039, 0.055, 0.090) },
    uColorViolet: { value: new THREE.Color(0.545, 0.361, 0.965) },
    uColorBlue: { value: new THREE.Color(0.231, 0.510, 0.965) },
    uColorDarkViolet: { value: new THREE.Color(0.25, 0.15, 0.45) },
    uColorFrost: { value: new THREE.Color(0.65, 0.72, 0.82) }
  };

  /* ─── HMR / Boot Synchronization ───────────────────────────────── */
  (function syncInitialTheme() {
    const activeThemeId = localStorage.getItem('purepath_active_theme') || 'electric-ether';
    if (activeThemeId === 'electric-ether') return; // Default is already loaded natively

    fetch(`themes/${activeThemeId}.json`)
      .then(r => r.json())
      .then(theme => {
        const w = theme.webgl;
        if (w) {
          // Immediately set the uniform properties without animation smoothing
          uniforms.uColorBg.value.setRGB(w.deepBg[0], w.deepBg[1], w.deepBg[2]);
          uniforms.uColorViolet.value.setRGB(w.violet[0], w.violet[1], w.violet[2]);
          uniforms.uColorBlue.value.setRGB(w.blue[0], w.blue[1], w.blue[2]);
          uniforms.uColorDarkViolet.value.setRGB(w.darkViolet[0], w.darkViolet[1], w.darkViolet[2]);
          uniforms.uColorFrost.value.setRGB(w.frostHint[0], w.frostHint[1], w.frostHint[2]);
        }
      }).catch(e => console.error('[fluid-bg] HMR Sync failed:', e));
  })();

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
  });

  const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  scene.add(plane);

  /* ─── Mouse tracking (smoothed) ────────────────────────────────── */
  const mouseTarget = { x: 0.5, y: 0.5 };
  const mouseCurrent = { x: 0.5, y: 0.5 };

  document.addEventListener('mousemove', (e) => {
    mouseTarget.x = e.clientX / window.innerWidth;
    mouseTarget.y = 1.0 - (e.clientY / window.innerHeight);
  });

  function onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);
    uniforms.uResolution.value.set(w, h);
  }
  window.addEventListener('resize', onResize);

  /* ─── Theme Integration ────────────────────────────────────────── */
  window.addEventListener('themeChanged', (e) => {
    const wColors = e.detail.webgl;
    if (!wColors) return;

    // Smoothly transition colors using GSAP
    gsap.to(uniforms.uColorBg.value, { r: wColors.deepBg[0], g: wColors.deepBg[1], b: wColors.deepBg[2], duration: 1.2, ease: "power2.out" });
    gsap.to(uniforms.uColorViolet.value, { r: wColors.violet[0], g: wColors.violet[1], b: wColors.violet[2], duration: 1.2, ease: "power2.out" });
    gsap.to(uniforms.uColorBlue.value, { r: wColors.blue[0], g: wColors.blue[1], b: wColors.blue[2], duration: 1.2, ease: "power2.out" });
    gsap.to(uniforms.uColorDarkViolet.value, { r: wColors.darkViolet[0], g: wColors.darkViolet[1], b: wColors.darkViolet[2], duration: 1.2, ease: "power2.out" });
    gsap.to(uniforms.uColorFrost.value, { r: wColors.frostHint[0], g: wColors.frostHint[1], b: wColors.frostHint[2], duration: 1.2, ease: "power2.out" });
  });

  /* ─── Animation Loop ───────────────────────────────────────────── */
  let isFluidEnabled = localStorage.getItem('purepath_fluid_enabled') !== 'false';
  let accumulatedTime = 0;
  let lastFrameTime = performance.now();

  window.addEventListener('fluidAnimationToggled', (e) => {
    isFluidEnabled = e.detail.enabled;
    localStorage.setItem('purepath_fluid_enabled', isFluidEnabled.toString());
  });

  function animate() {
    requestAnimationFrame(animate);

    const now = performance.now();
    const delta = (now - lastFrameTime) / 1000.0;
    lastFrameTime = now;

    if (isFluidEnabled) {
      accumulatedTime += delta;
    }
    
    uniforms.uTime.value = accumulatedTime;

    // Smooth mouse follow (lerp)
    mouseCurrent.x += (mouseTarget.x - mouseCurrent.x) * 0.04;
    mouseCurrent.y += (mouseTarget.y - mouseCurrent.y) * 0.04;
    uniforms.uMouse.value.set(mouseCurrent.x, mouseCurrent.y);

    renderer.render(scene, camera);
  }

  animate();
})();
