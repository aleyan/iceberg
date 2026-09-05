import * as THREE from "three";

const fullscreenVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;

const noise = /* glsl */ `
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x),
      f.y
    );
  }

  float fbm(vec2 p) {
    return noise(p) * 0.55
      + noise(p * 2.03 + 5.7) * 0.26
      + noise(p * 4.13 + 11.3) * 0.13
      + noise(p * 8.3) * 0.06;
  }
`;

const waves = /* glsl */ `
  float waveHeight(vec2 point, float time) {
    float a = sin(point.x * 0.43 + time * 0.72) * 0.105;
    float b = sin(point.y * 0.34 - time * 0.48 + point.x * 0.15) * 0.078;
    float c = sin((point.x - point.y) * 0.71 + time * 0.31) * 0.042;
    float d = sin(point.x * 1.63 + point.y * 1.17 - time * 0.91) * 0.018;
    return a + b + c + d;
  }

  vec2 waveSlope(vec2 point, float time) {
    float a = cos(point.x * 0.43 + time * 0.72) * 0.105;
    float b = cos(point.y * 0.34 - time * 0.48 + point.x * 0.15) * 0.078;
    float c = cos((point.x - point.y) * 0.71 + time * 0.31) * 0.042;
    float d = cos(point.x * 1.63 + point.y * 1.17 - time * 0.91) * 0.018;
    return vec2(a * 0.43 + b * 0.15 + c * 0.71 + d * 1.63,
                b * 0.34 - c * 0.71 + d * 1.17);
  }
`;

// A horizontal cloud layer gives the sky perspective foreshortening. Both the
// backdrop and reflections use world directions, so clouds remain at infinity
// during descent and move consistently with the camera during orbit.
const skySampling = /* glsl */ `
  uniform sampler2D uSky;
  uniform mat3 uCameraRotation;
  uniform vec2 uProjectionScale;
  uniform float uViewHeight;
  uniform float uAspect;
  uniform float uYaw;

  const vec3 horizonHaze = vec3(0.075, 0.22, 0.38);

  vec3 sampleSkyDirection(vec3 direction, float blur) {
    vec3 ray = normalize(direction);
    float elevation = max(ray.y, 0.0);
    // Intersect a distant cloud deck. The small curvature term bounds texture
    // frequency at grazing angles, where atmospheric haze hides the detail.
    vec2 cloudUv = vec2(-ray.x, -ray.z) * 0.18 / (elevation + 0.10) + 0.5;
    vec3 color = texture2D(uSky, cloudUv, blur).rgb * vec3(0.68, 0.80, 1.0);
    float haze = exp(-elevation * 18.0);
    return mix(color, horizonHaze, haze);
  }

  vec3 sampleSky(vec2 screenUv, float blur) {
    vec3 viewRay = vec3((screenUv * 2.0 - 1.0) / uProjectionScale, -1.0);
    return sampleSkyDirection(uCameraRotation * viewRay, blur);
  }
`;

// Keep the existing detailed grid around the iceberg, then expand cell sizes
// geometrically toward a subpixel horizon rather than ending at a nearby edge.
function createOceanSurfaceGeometry() {
  const coordinates: number[] = [];
  for (let i = 32; i > 0; i -= 1) coordinates.push(-45 * (4096 / 45) ** (i / 32));
  for (let i = 0; i <= 128; i += 1) coordinates.push(-45 + 90 * i / 128);
  for (let i = 1; i <= 32; i += 1) coordinates.push(45 * (4096 / 45) ** (i / 32));
  const geometry = new THREE.PlaneGeometry(1, 1, coordinates.length - 1, coordinates.length - 1);
  const positions = geometry.getAttribute("position");
  for (let row = 0; row < coordinates.length; row += 1) {
    for (let column = 0; column < coordinates.length; column += 1) {
      positions.setXY(row * coordinates.length + column, coordinates[column], -coordinates[row]);
    }
  }
  geometry.computeBoundingSphere();
  return geometry;
}

function frontEdgeZ(x: number) {
  const bulge = 1.9 * Math.exp(-0.5 * (x / 4) ** 2);
  return 2.7 + bulge + 0.12 * Math.sin(x * 0.75);
}

function createGlassEdgeGeometry(waterLevel: number, stretch: number) {
  const columns = 128;
  const rows = 28;
  const width = 42;
  const depth = 3.4 * Math.sqrt(stretch);
  const thickness = 0.72;
  const positions: number[] = [];
  const indices: number[] = [];
  const rowStride = columns + 1;
  const surfaceStride = (rows + 1) * rowStride;

  for (let surface = 0; surface < 2; surface += 1) {
    for (let row = 0; row <= rows; row += 1) {
      const depthRatio = row / rows;
      for (let column = 0; column <= columns; column += 1) {
        const x = (column / columns - 0.5) * width;
        positions.push(
          x,
          waterLevel - depth * depthRatio,
          frontEdgeZ(x) - surface * thickness,
        );
      }
    }
  }

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const a = row * rowStride + column;
      const b = a + 1;
      const c = a + rowStride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);

      const backA = surfaceStride + a;
      const backB = surfaceStride + b;
      const backC = surfaceStride + c;
      const backD = surfaceStride + d;
      indices.push(backA, backB, backC, backB, backD, backC);
    }
  }

  for (let column = 0; column < columns; column += 1) {
    const frontA = column;
    const frontB = column + 1;
    const backA = surfaceStride + column;
    const backB = surfaceStride + column + 1;
    indices.push(frontA, frontB, backA, frontB, backB, backA);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return { geometry, depth };
}

/**
 * Split-level ocean with a real world-space water surface. The foreground
 * cutaway rotates around the vertical axis to face the camera, but never pitches
 * independently of the iceberg, so their waterlines remain coincident.
 */
export function createOcean(
  scene: THREE.Scene,
  waterLevel: number,
  skyTextureUrl: string,
  overview = false,
) {
  const sky = new THREE.TextureLoader().load(skyTextureUrl);
  sky.colorSpace = THREE.SRGBColorSpace;
  sky.wrapS = sky.wrapT = THREE.MirroredRepeatWrapping;

  const backgroundUniforms = {
    uSky: { value: sky },
    uCameraRotation: { value: new THREE.Matrix3() },
    uProjectionScale: { value: new THREE.Vector2() },
    uResolution: { value: new THREE.Vector2() },
    uTime: { value: 0 },
    uViewHeight: { value: 12 },
    uFocusY: { value: waterLevel },
    uViewUpY: { value: 1 },
    uWaterLevel: { value: waterLevel },
    uIcebergDepth: { value: 24 },
    uAspect: { value: 1 },
    uYaw: { value: 0 },
  };
  const backgroundMaterial = new THREE.ShaderMaterial({
    uniforms: backgroundUniforms,
    depthTest: false,
    depthWrite: false,
    vertexShader: fullscreenVertexShader,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uFocusY;
      uniform float uViewUpY;
      uniform float uWaterLevel;
      uniform float uIcebergDepth;
      uniform vec2 uResolution;
      ${noise}
      ${skySampling}

      void main() {
        vec2 vUv = gl_FragCoord.xy / uResolution;
        // World height on the camera-facing plane through the iceberg center.
        // The foreground lip is not a depth reference:
        // its perspective magnification made the ocean turn black too early.
        float worldY = uFocusY + (vUv.y - 0.5) * uViewHeight * uViewUpY;
        float depth = max(0.0, uWaterLevel - worldY);
        float relativeDepth = depth / uIcebergDepth;
        float x = (vUv.x - 0.5) * uViewHeight * uAspect;
        vec3 skyColor = sampleSky(vUv, 0.0);

        float sideFalloff = exp(-abs(x) * 0.10);
        vec3 deepOcean = mix(
          vec3(0.002, 0.07, 0.29),
          vec3(0.0015, 0.025, 0.11),
          smoothstep(0.0, 0.55, relativeDepth)
        );
        deepOcean = mix(deepOcean, vec3(0.0007, 0.005, 0.026),
          smoothstep(0.35, 0.90, relativeDepth));
        float abyss = smoothstep(0.85, 1.18, relativeDepth);
        deepOcean = mix(deepOcean, vec3(0.00012, 0.0003, 0.0009), abyss);
        deepOcean *= 0.72 + 0.28 * sideFalloff;
        float shaftX = (x + 3.0 * cos(uYaw) + 0.9 * sin(uYaw)) / (1.0 + depth * 0.055);
        float drift = uTime * 0.025;
        float shafts = pow(fbm(vec2(shaftX * 1.7 + drift, 3.4)), 4.0) * 1.1;
        shafts += pow(noise(vec2(shaftX * 6.0 - drift, 8.1)), 8.0) * 0.10;
        float broken = 0.6 + 0.4 * fbm(vec2(x * 0.5, depth * 0.45 - drift));
        deepOcean += vec3(0.006, 0.13, 0.30) * shafts * broken * exp(-relativeDepth * 3.5) * (1.0 - abyss)
          * smoothstep(0.0, 0.4, depth);
        deepOcean *= 1.0 - exp(-depth * 2.0) * 0.22;

        #ifdef UNDERWATER_BACKGROUND
          gl_FragColor = vec4(deepOcean, 1.0);
        #else
          gl_FragColor = vec4(skyColor, 1.0);
        #endif
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const fullscreenGeometry = new THREE.PlaneGeometry(2, 2);
  const background = new THREE.Mesh(fullscreenGeometry, backgroundMaterial);
  background.frustumCulled = false;
  background.renderOrder = -100;
  scene.add(background);

  const waterUniforms = {
    ...backgroundUniforms,
    uSurfaceVisibility: { value: 1 },
    uSurfaceDistance: { value: 12 },
    uWaterLevel: backgroundUniforms.uWaterLevel,
    uCameraPosition: { value: new THREE.Vector3() },
    uShallow: { value: new THREE.Color(0x147fa8) },
    uDeep: { value: new THREE.Color(0x010c20) },
    uSkyTint: { value: new THREE.Color(0x8acfe0) },
  };
  const surfaceMaterial = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vWorldPosition;
      varying float vWave;
      varying vec2 vCutawayPosition;
      ${waves}

      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        float wave = waveHeight(world.xz, uTime)
          * (1.0 - smoothstep(45.0, 200.0, length(position.xy)));
        world.y += wave;
        vWorldPosition = world.xyz;
        vWave = wave;
        vCutawayPosition = vec2(position.x, -position.y);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uCameraPosition;
      uniform vec3 uShallow;
      uniform vec3 uDeep;
      uniform vec3 uSkyTint;
      uniform float uSurfaceVisibility;
      uniform float uSurfaceDistance;
      uniform float uWaterLevel;
      varying vec3 vWorldPosition;
      varying float vWave;
      varying vec2 vCutawayPosition;
      ${noise}
      ${waves}
      ${skySampling}

      float frontEdge(float x) {
        float bulge = 1.9 * exp(-0.5 * pow(x / 4.0, 2.0));
        return 2.7 + bulge + 0.12 * sin(x * 0.75);
      }

      void main() {
        float edgeDistance = frontEdge(vCutawayPosition.x) - vCutawayPosition.y;
        if (edgeDistance < 0.0) discard;

        // Analytic slopes avoid triangle-shaped facets in the reflected sky.
        float surfaceDistance = length(uCameraPosition.xz - vWorldPosition.xz);
        float waveDetail = 1.0 - smoothstep(45.0, 200.0, surfaceDistance);
        vec2 slope = waveSlope(vWorldPosition.xz, uTime) * waveDetail;
        vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
        vec3 viewDirection = normalize(uCameraPosition - vWorldPosition);
        float fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 3.0);
        float smallRipples = mix(0.5, fbm(vWorldPosition.xz * 1.8 + uTime * vec2(0.11, -0.08)), waveDetail);
        float glint = smoothstep(0.62, 0.9, smallRipples) * (0.35 + fresnel * 0.65);
        float edgeGlass = 1.0 - smoothstep(0.0, 0.34, edgeDistance);
        float edgeCore = 1.0 - smoothstep(0.0, 0.075, edgeDistance);
        float crest = smoothstep(0.055, 0.17, vWave);

        vec3 body = mix(uDeep, uShallow, 0.34 + smallRipples * 0.25);
        vec3 color = mix(body, uSkyTint, fresnel * 0.68);
        color += glint * vec3(0.09, 0.30, 0.38);
        color += edgeGlass * vec3(0.08, 0.42, 0.62);
        color += edgeCore * vec3(0.30, 0.82, 1.0);
        color += crest * vec3(0.035, 0.16, 0.20);
        vec3 reflectedRay = reflect(-viewDirection, normal);
        vec3 reflectedSky = sampleSkyDirection(reflectedRay, 1.5);
        float reflectance = 0.0204 + 0.9796 * pow(
          1.0 - max(dot(normal, viewDirection), 0.0), 5.0
        );
        // The top is opaque: apparent transmission is blue water body color,
        // not alpha blending with the fullscreen sky behind the ocean mesh.
        vec3 topColor = mix(body, reflectedSky, reflectance);
        topColor += glint * vec3(0.04, 0.10, 0.15);
        topColor += (edgeGlass * 0.3 + edgeCore) * vec3(0.05, 0.22, 0.32);
        // Resolve the distant ocean into the same atmosphere as the sky;
        // wave contrast and cloud reflections disappear before the horizon.
        topColor = mix(topColor, horizonHaze, 1.0 - exp(-surfaceDistance / 220.0));
        float alpha = 0.25 + fresnel * 0.43 + glint * 0.08;
        alpha = max(alpha, edgeGlass * 0.68 + edgeCore * 0.18);
        // A distant, upward-facing sheet should not cling to the horizon
        // throughout the dive. Fade its underside as the camera submerges;
        // the foreground meniscus keeps its physical geometry and alignment.
        float belowSurface = 1.0 - smoothstep(uWaterLevel - 0.25, uWaterLevel + 0.10, uCameraPosition.y);
        float distantFade = 1.0 - smoothstep(
          uSurfaceDistance * 0.75, uSurfaceDistance * 2.0,
          length(uCameraPosition - vWorldPosition)
        );
        float undersideAlpha = min(alpha, 0.9) * uSurfaceVisibility * distantFade;
        gl_FragColor = vec4(mix(topColor, color, belowSurface),
          mix(1.0, undersideAlpha, belowSurface));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  const waterRig = new THREE.Group();
  scene.add(waterRig);
  const water = new THREE.Mesh(createOceanSurfaceGeometry(), surfaceMaterial);
  water.rotation.x = -Math.PI / 2;
  water.position.y = waterLevel;
  water.renderOrder = 4;
  waterRig.add(water);

  const glassEdge = createGlassEdgeGeometry(waterLevel, overview ? 1 : 2);
  const glassUniforms = {
    uTime: backgroundUniforms.uTime,
    uCameraPosition: waterUniforms.uCameraPosition,
    uWaterLevel: { value: waterLevel },
    uEdgeDepth: { value: glassEdge.depth },
    uShallow: { value: new THREE.Color(0x1aa9d2) },
    uDeep: { value: new THREE.Color(0x01152e) },
  };
  const glassMaterial = new THREE.ShaderMaterial({
    uniforms: glassUniforms,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uWaterLevel;
      uniform float uEdgeDepth;
      varying vec3 vWorldPosition;
      varying float vDepth;
      varying float vRipple;
      ${waves}

      void main() {
        vDepth = clamp((uWaterLevel - position.y) / uEdgeDepth, 0.0, 1.0);
        float ripple = sin(position.x * 1.45 + uTime * 0.58)
          * sin(position.y * 1.12 - uTime * 0.37);
        float lipEnvelope = (1.0 - exp(-vDepth * 38.0)) * exp(-vDepth * 4.8);
        vec3 displaced = position;
        displaced.z += ripple * lipEnvelope * 0.16;
        vec4 world = modelMatrix * vec4(displaced, 1.0);
        world.y += waveHeight(world.xz, uTime) * exp(-vDepth * 7.0);
        vWorldPosition = world.xyz;
        vRipple = ripple * lipEnvelope;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uCameraPosition;
      uniform vec3 uShallow;
      uniform vec3 uDeep;
      varying vec3 vWorldPosition;
      varying float vDepth;
      varying float vRipple;

      void main() {
        vec3 dx = dFdx(vWorldPosition);
        vec3 dy = dFdy(vWorldPosition);
        vec3 normal = normalize(cross(dx, dy));
        vec3 viewDirection = normalize(uCameraPosition - vWorldPosition);
        float fresnel = pow(1.0 - abs(dot(normal, viewDirection)), 2.25);
        float meniscus = exp(-vDepth * 65.0);
        float verticalGlass = exp(-vDepth * 6.3);
        float rippleGlow = smoothstep(0.18, 0.78, abs(vRipple)) * verticalGlass;
        vec3 color = mix(uShallow, uDeep, smoothstep(0.0, 0.88, vDepth));
        color += fresnel * vec3(0.13, 0.53, 0.78);
        color += verticalGlass * vec3(0.08, 0.37, 0.62);
        color += meniscus * vec3(0.42, 0.92, 1.0);
        color += rippleGlow * vec3(0.14, 0.52, 0.69);
        float alpha = 0.055 + fresnel * 0.25 + verticalGlass * 0.24 + rippleGlow * 0.10;
        alpha = max(alpha, meniscus * 0.82);
        // Dissolve the lower edge rather than exposing a rectangular glass band.
        alpha *= 1.0 - smoothstep(0.45, 1.0, vDepth);
        gl_FragColor = vec4(color, min(alpha, 0.86));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const curtain = new THREE.Mesh(glassEdge.geometry, glassMaterial);
  curtain.renderOrder = 5;
  waterRig.add(curtain);

  // Use the actual animated cutaway as the sky/ocean mask. A projected center
  // point cannot describe its curved lip when the camera pitches or submerges.
  // Keep every lip vertex (including the back edge and cap) identical, and only
  // extend the bottom row to carry the ocean color through the entire abyss.
  const underwaterGeometry = glassEdge.geometry.clone();
  const underwaterPositions = underwaterGeometry.getAttribute("position");
  for (let index = 0; index < underwaterPositions.count; index += 1) {
    if (underwaterPositions.getY(index) <= waterLevel - glassEdge.depth + 0.001) {
      underwaterPositions.setY(index, waterLevel - 200);
    }
  }
  const underwaterMaterial = new THREE.ShaderMaterial({
    uniforms: {
      ...backgroundUniforms,
      ...glassUniforms,
      uBackdropHalfWidth: { value: Math.abs(underwaterPositions.getX(0)) },
    },
    defines: { UNDERWATER_BACKGROUND: 1 },
    // Sharing this shader also shares the exact wave phase and lip displacement.
    vertexShader: `uniform float uBackdropHalfWidth;
${glassMaterial.vertexShader}`.replace(
      "gl_Position = projectionMatrix * viewMatrix * world;",
      `gl_Position = projectionMatrix * viewMatrix * world;
       // Carry the outer columns beyond the viewport in wide overview shots.
       // Interior lip vertices still project exactly like the visible glass.
       if (abs(position.x) >= uBackdropHalfWidth - 0.001 && gl_Position.w > 0.0) {
         gl_Position.x = sign(position.x) * max(abs(gl_Position.x), gl_Position.w * 1.01);
       }`,
    ),
    fragmentShader: backgroundMaterial.fragmentShader,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  const underwater = new THREE.Mesh(underwaterGeometry, underwaterMaterial);
  underwater.frustumCulled = false;
  underwater.renderOrder = -99;
  waterRig.add(underwater);

  return {
    setIcebergBounds(bounds: THREE.Box3) {
      backgroundUniforms.uIcebergDepth.value = Math.max(1, waterLevel - bounds.min.y);
    },
    update(
      camera: THREE.PerspectiveCamera,
      target: THREE.Vector3,
      distance: number,
      yaw: number,
      time: number,
      resolution: THREE.Vector2,
    ) {
      backgroundUniforms.uResolution.value.copy(resolution);
      waterUniforms.uProjectionScale.value.set(
        camera.projectionMatrix.elements[0], camera.projectionMatrix.elements[5],
      );
      waterRig.position.set(target.x, 0, target.z);
      waterRig.rotation.y = yaw;
      waterRig.updateWorldMatrix(true, true);

      backgroundUniforms.uCameraRotation.value.setFromMatrix4(camera.matrixWorld);
      backgroundUniforms.uViewHeight.value =
        2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      backgroundUniforms.uFocusY.value = target.y;
      backgroundUniforms.uViewUpY.value = camera.matrixWorld.elements[5];
      const cameraDepth = Math.max(0, waterLevel - camera.position.y);
      const surfaceFadeDepth = Math.min(
        backgroundUniforms.uViewHeight.value * 0.50,
        backgroundUniforms.uIcebergDepth.value * 0.25,
      );
      waterUniforms.uSurfaceDistance.value = distance;
      waterUniforms.uSurfaceVisibility.value = 1 - THREE.MathUtils.smoothstep(
        cameraDepth, surfaceFadeDepth * 0.15, surfaceFadeDepth,
      );
      backgroundUniforms.uAspect.value = camera.aspect;
      backgroundUniforms.uYaw.value = yaw;
      backgroundUniforms.uTime.value = time;
      waterUniforms.uCameraPosition.value.copy(camera.position);
    },
    dispose() {
      fullscreenGeometry.dispose();
      backgroundMaterial.dispose();
      water.geometry.dispose();
      surfaceMaterial.dispose();
      glassEdge.geometry.dispose();
      glassMaterial.dispose();
      underwaterGeometry.dispose();
      underwaterMaterial.dispose();
      sky.dispose();
    },
  };
}
