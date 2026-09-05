import * as THREE from 'three';

// World-space detail stays attached to the ice through orbiting and stretching;
// the source mesh has no UVs, so no seams or stretched bitmap texels are needed.
const iceNoise = /* glsl */ `
float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash31(i), hash31(i + vec3(1,0,0)), f.x),
                 mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
                 mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  return noise3(p) * 0.53 + noise3(p * 2.03 + 13.1) * 0.27
    + noise3(p * 4.11 + 7.7) * 0.13 + noise3(p * 8.31 + 5.3) * 0.07;
}
float relief(vec3 p) {
  vec3 warp = p + vec3(noise3(p * 2.2), noise3(p * 2.2 + 8.3), noise3(p * 2.2 + 4.7)) * 0.24;
  float flutes = fbm(warp * vec3(6.0, 0.85, 6.0));
  float fracture = 1.0 - abs(fbm(warp * 8.0) * 2.0 - 1.0);
  float crags = abs(noise3(p * 2.8) - 0.5);
  return flutes * 0.32 + fracture * 0.12 + crags * 0.8 + noise3(p * 38.0) * 0.006;
}
`;

export function createIceMaterial(waterLevel: number, stretch: number, reliefTextureUrl: string) {
  const texture = new THREE.TextureLoader().load(reliefTextureUrl);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  // This is scalar relief data, not display color: keep its linear values.
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.65,
    metalness: 0,
    clearcoat: 0.16,
    clearcoatRoughness: 0.34,
    ior: 1.31,
    specularIntensity: 0.4,
    envMapIntensity: 0.32,
  });
  material.addEventListener('dispose', () => texture.dispose());
  material.onBeforeCompile = shader => {
    shader.uniforms.uRelief = { value: texture };
    shader.uniforms.uWaterLevel = { value: waterLevel };
    shader.uniforms.uStretch = { value: stretch };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      varying vec3 vIceWorldPosition;
      varying vec3 vIceWorldNormal;
    `).replace('#include <begin_vertex>', `#include <begin_vertex>
      vIceWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
    `).replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vIceWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D uRelief;
      uniform float uWaterLevel;
      uniform float uStretch;
      varying vec3 vIceWorldPosition;
      varying vec3 vIceWorldNormal;
      ${iceNoise}
      float glacialTexture(vec3 p, vec3 n, float blur) {
        vec3 weights = pow(abs(n), vec3(4.0));
        weights /= max(dot(weights, vec3(1.0)), 0.001);
        return texture2D(uRelief, p.zy * 0.22, blur).r * weights.x
          + texture2D(uRelief, p.xz * 0.22, blur).r * weights.y
          + texture2D(uRelief, p.xy * 0.22, blur).r * weights.z;
      }
    `).replace('#include <color_fragment>', `#include <color_fragment>
      float depth = max(0.0, uWaterLevel - vIceWorldPosition.y);
      float submerged = (1.0 - smoothstep(uWaterLevel - 0.045, uWaterLevel + 0.025, vIceWorldPosition.y));
      // Undo only part of the geometric stretch: long glacial flutes, fine surface grain.
      vec3 p = vIceWorldPosition;
      p.y = uWaterLevel + (p.y - uWaterLevel) / sqrt(uStretch);
      float broad = fbm(p * vec3(1.6, 0.7, 1.6));
      float flutes = fbm(p * vec3(2.1, 0.35, 2.1) + broad * 1.4);
      float crystal = glacialTexture(p, normalize(vIceWorldNormal), 0.0);
      float fracture = mix(fbm(p * vec3(12.0, 2.2, 12.0) + broad * 3.0), crystal, 0.7);
      float veins = smoothstep(0.58, 0.82, crystal);
      float fissure = smoothstep(0.53, 0.72, flutes);
      float snow = smoothstep(-0.35, 0.8, vIceWorldNormal.y);
      vec3 dryIce = mix(vec3(0.30, 0.49, 0.65), vec3(0.91, 0.96, 0.97), 0.62 + snow * 0.38);
      dryIce *= 0.74 + 0.38 * crystal;
      dryIce *= 1.0 - smoothstep(0.58, 0.76, fracture) * 0.25;
      vec3 wetIce = mix(vec3(0.002, 0.025, 0.15), vec3(0.010, 0.22, 0.46), smoothstep(0.22, 0.66, flutes));
      wetIce *= (1.0 - fissure * 0.6) * (0.45 + crystal * 0.95);
      wetIce += vec3(0.008, 0.05, 0.08) * veins;
      diffuseColor.rgb = mix(dryIce, wetIce, submerged);
    `).replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(0.72, 0.34 + fracture * 0.22, submerged);
    `).replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      // Screen derivatives turn the 3D relief field into a UV-free bump normal.
      // Filter subpixel detail to keep distant/phone views from sparkling.
      float detailFilter = 1.0 - smoothstep(0.015, 0.10, max(length(dFdx(p)), length(dFdy(p))));
      float smoothCrystal = glacialTexture(p, normalize(vIceWorldNormal), 3.0);
      float iceHeight = (relief(p) * 0.65 + smoothCrystal * 0.12) * mix(0.14, 0.24, submerged) * detailFilter;
      vec3 dpdx = dFdx(-vViewPosition), dpdy = dFdy(-vViewPosition);
      vec3 r1 = cross(dpdy, normal), r2 = cross(normal, dpdx);
      float det = dot(dpdx, r1);
      vec3 gradient = sign(det) * (dFdx(iceHeight) * r1 + dFdy(iceHeight) * r2);
      normal = normalize(abs(det) * normal - gradient);
    `).replace('#include <opaque_fragment>', `#include <opaque_fragment>
      vec3 detailNormal = inverseTransformDirection(normal, viewMatrix);
      vec3 worldNormal = normalize(mix(vIceWorldNormal, detailNormal, 0.22));
      vec3 toEye = normalize(cameraPosition - vIceWorldPosition);
      float rim = pow(1.0 - max(dot(worldNormal, toEye), 0.0), 2.1);
      float upward = smoothstep(-0.45, 0.65, worldNormal.y);
      float lightFacing = max(dot(worldNormal, normalize(vec3(-0.65, 0.8, 0.55))), 0.0);
      // Blue body absorption and cyan scattering along thin, broken ice edges.
      // Depth is a property of the ice, independent of the current camera height.
      float attenuation = exp(-depth * 0.025);
      vec3 absorbed = gl_FragColor.rgb * exp(-depth * vec3(0.16, 0.048, 0.020));
      float innerLight = smoothstep(0.30, 0.70, flutes) * (0.02 + lightFacing * 0.12) * (0.4 + crystal);
      float ledge = pow(max(-worldNormal.y, 0.0), 1.5);
      float edgeLight = (rim * (0.35 + upward * 0.28) + ledge * 1.6) * (0.4 + fracture);
      vec3 scattering = vec3(0.015, 0.48, 0.78) * (innerLight + edgeLight + veins * 0.065);
      float surfaceShade = 0.38 + 0.62 * (1.0 - exp(-depth * 1.4));
      vec3 underwater = (absorbed + scattering) * attenuation * surfaceShade;
      // A little dark blue survives at the foot; no emissive neon outline.
      underwater = mix(vec3(0.001, 0.004, 0.014), underwater, exp(-depth * 0.013));
      gl_FragColor.rgb = mix(gl_FragColor.rgb, underwater, submerged);
    `);
  };
  material.customProgramCacheKey = () => 'glacial-ice-v1';
  return material;
}
