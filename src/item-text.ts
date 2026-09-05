import * as THREE from 'three';

type TextLabel = { button: HTMLButtonElement; position: THREE.Vector3; width: number; height: number };

/** One atlas and one draw call. The ordinary ice depth buffer clips each glyph. */
export function createItemText(scene: THREE.Scene) {
  let mesh: THREE.InstancedMesh | undefined;
  let texture: THREE.CanvasTexture | undefined;
  const viewport = new THREE.Vector2();

  function disposeMesh() {
    if (mesh) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.ShaderMaterial).dispose();
      mesh.dispose();
      mesh = undefined;
    }
    texture?.dispose();
  }

  return {
    rebuild(labels: TextLabel[]) {
      disposeMesh();
      if (!labels.length) return;
      const density = Math.min(window.devicePixelRatio, 1.5);
      const padding = 5;
      const atlasWidth = 2048;
      let x = 0, y = 0, rowHeight = 0;
      const cells = labels.map(label => {
        const rect = label.button.getBoundingClientRect();
        label.width = rect.width; label.height = rect.height;
        const width = Math.ceil((rect.width + padding * 2) * density);
        const height = Math.ceil((rect.height + padding * 2) * density);
        if (x + width > atlasWidth) { x = 0; y += rowHeight; rowHeight = 0; }
        const cell = { x, y, width, height, rect };
        x += width; rowHeight = Math.max(rowHeight, height);
        return cell;
      });
      const canvas = document.createElement('canvas');
      canvas.width = atlasWidth;
      canvas.height = y + rowHeight;
      const context = canvas.getContext('2d')!;
      context.scale(density, density);
      context.fillStyle = '#effbff';
      context.shadowColor = '#00142c';
      context.shadowBlur = 4 * density;
      context.shadowOffsetY = density;
      const range = document.createRange();
      const glyphs: { value: string; x: number; y: number; font: string }[] = [];
      // DOM ranges preserve the browser's wrapping, including inline code.
      labels.forEach((label, index) => {
        const cell = cells[index];
        const walker = document.createTreeWalker(label.button, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const text = node.textContent ?? '';
          const style = getComputedStyle(node.parentElement!);
          context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          let offset = 0;
          for (const character of text) {
            const start = offset;
            offset += character.length;
            if (/\s/.test(character)) continue;
            range.setStart(node, start);
            range.setEnd(node, offset);
            const rect = range.getBoundingClientRect();
            const metrics = context.measureText(character);
            const ascent = metrics.fontBoundingBoxAscent;
            const descent = metrics.fontBoundingBoxDescent;
            const baseline = rect.top + (rect.height - ascent - descent) / 2 + ascent;
            glyphs.push({ value: character, font: context.font,
              x: cell.x / density + padding + rect.left - cell.rect.left,
              y: cell.y / density + padding + baseline - cell.rect.top });
          }
        }
      });
      // Paint all shadows first, so neighboring glyphs cannot darken each other.
      for (const shadow of [true, false]) {
        context.shadowBlur = shadow ? 4 * density : 0;
        context.shadowOffsetY = shadow ? density : 0;
        for (const glyph of glyphs) {
          context.font = glyph.font;
          context.fillText(glyph.value, glyph.x, glyph.y);
        }
      }
      texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      const geometry = new THREE.PlaneGeometry(1, 1);
      const rects: number[] = [], sizes: number[] = [], offsets: number[] = [];
      labels.forEach((label, index) => {
        const cell = cells[index];
        rects.push(cell.x / canvas.width, 1 - (cell.y + cell.height) / canvas.height,
          cell.width / canvas.width, cell.height / canvas.height);
        sizes.push(cell.width / density, cell.height / density);
        offsets.push(16 - label.height / 2);
      });
      geometry.setAttribute('atlasRect', new THREE.InstancedBufferAttribute(new Float32Array(rects), 4));
      geometry.setAttribute('labelSize', new THREE.InstancedBufferAttribute(new Float32Array(sizes), 2));
      geometry.setAttribute('labelOffset', new THREE.InstancedBufferAttribute(new Float32Array(offsets), 1));
      const material = new THREE.ShaderMaterial({
        uniforms: { uAtlas: { value: texture }, uViewport: { value: viewport } },
        transparent: true,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
        vertexShader: /* glsl */ `
          uniform vec2 uViewport;
          attribute vec4 atlasRect;
          attribute vec2 labelSize;
          attribute float labelOffset;
          varying vec2 vAtlasUv;
          void main() {
            vec4 anchor = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(0., 0., 0., 1.);
            vec2 pixels = position.xy * labelSize + vec2(0., labelOffset);
            gl_Position = anchor;
            gl_Position.xy += pixels * 2. / uViewport * anchor.w;
            vAtlasUv = atlasRect.xy + uv * atlasRect.zw;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uAtlas;
          varying vec2 vAtlasUv;
          void main() {
            gl_FragColor = texture2D(uAtlas, vAtlasUv);
            if (gl_FragColor.a < 0.02) discard;
            #include <colorspace_fragment>
          }
        `,
      });
      mesh = new THREE.InstancedMesh(geometry, material, labels.length);
      const matrix = new THREE.Matrix4();
      labels.forEach((label, index) => mesh!.setMatrixAt(index, matrix.makeTranslation(label.position)));
      mesh.frustumCulled = false;
      mesh.renderOrder = 6;
      mesh.name = 'Iceberg item names';
      scene.add(mesh);
    },
    resize(width: number, height: number) { viewport.set(width, height); },
    dispose: disposeMesh,
  };
}
