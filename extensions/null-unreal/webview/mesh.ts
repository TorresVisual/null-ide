import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ToWebview } from '../src/viewer/messages';
import { Frame, mountFrame } from './frame';
import { renderTree, row } from './rows';

type Ready = Extract<ToWebview, { type: 'ready' }>;

function banner(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'note';
  p.textContent = text;
  return p;
}

function button(text: string, pressed: boolean, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.setAttribute('aria-pressed', String(pressed));
  b.addEventListener('click', onClick);
  return b;
}

// Falls back to the properties tree, with the reason on top, when the GLB is missing or does not load.
function fallback(m: Ready, frame: Frame, reason: string): void {
  frame.body.replaceChildren(banner(`3D view not available: ${reason}`));
  renderTree(m.data, frame.body);
}

function inspect(m: Ready, frame: Frame): void {
  const heading = document.createElement('h2');
  heading.textContent = 'LODs and slots';
  const lods = Array.isArray(m.data.lods) ? (m.data.lods as Record<string, unknown>[]) : [];
  const lodRows = lods.map((lod, i) => {
    const d = document.createElement('details');
    d.open = true;
    const s = document.createElement('summary');
    s.textContent = `LOD ${i}`;
    d.append(s);
    for (const k of ['vertices', 'sections', 'triangles']) d.append(row(k, lod[k]));
    return d;
  });
  frame.inspector.replaceChildren(
    heading,
    ...lodRows,
    row('Material slots', m.data.materialSlots),
    row('Morph targets', m.data.morphTargets),
    row('Bones', Array.isArray(m.data.bones) ? m.data.bones.length : { unreadable: 'bone list missing' }),
  );
  frame.showInspector();
}

// Orbit view of the GLB export with wireframe and skeleton toggles. The GLB is the only mesh data the page loads.
function renderMesh(m: Ready, frame: Frame, url: string): void {
  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  const canvas = document.createElement('canvas');
  canvas.className = 'texture-canvas';
  canvas.setAttribute('aria-label', `${m.name} 3D view`);
  const wrap = document.createElement('div');
  wrap.className = 'canvas-wrap';
  wrap.append(canvas);
  frame.body.append(toolbar, wrap);
  inspect(m, frame);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  const scene = new THREE.Scene();
  scene.background = null;
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(1, 2, 1.5);
  scene.add(sun);

  let skeleton: THREE.SkeletonHelper | undefined;
  let meshes: THREE.Mesh[] = [];
  let wireframe = false;
  const setWireframe = (on: boolean) => {
    wireframe = on;
    for (const mesh of meshes) {
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        (mat as THREE.MeshStandardMaterial).wireframe = on;
      }
    }
  };
  const wire = button('Wireframe', false, () => {
    setWireframe(!wireframe);
    wire.setAttribute('aria-pressed', String(wireframe));
  });
  const bones = button('Skeleton', false, () => {
    if (skeleton) skeleton.visible = !skeleton.visible;
    bones.setAttribute('aria-pressed', String(skeleton?.visible ?? false));
  });
  toolbar.append(wire, bones);

  const resize = () => {
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(wrap);
  resize();

  new GLTFLoader().load(
    url,
    (gltf) => {
      scene.add(gltf.scene);
      gltf.scene.traverse((o) => {
        if (o instanceof THREE.Mesh) meshes.push(o);
      });
      const skinned = meshes.find((o): o is THREE.SkinnedMesh => (o as THREE.SkinnedMesh).isSkinnedMesh);
      if (skinned) {
        skeleton = new THREE.SkeletonHelper(skinned);
        skeleton.visible = false;
        scene.add(skeleton);
      } else {
        bones.disabled = true;
      }
      // Frame the camera on the loaded bounds.
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const radius = Math.max(size.length() / 2, 1);
      controls.target.copy(center);
      camera.position.copy(center).add(new THREE.Vector3(radius * 1.6, radius * 0.8, radius * 1.6));
      camera.near = radius / 100;
      camera.far = radius * 100;
      camera.updateProjectionMatrix();
    },
    undefined,
    (err) => {
      renderer.dispose();
      fallback(m, frame, err instanceof Error ? err.message : 'the model did not load');
    },
  );

  const tick = () => {
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const frame = mountFrame((m: ToWebview) => {
  if (m.type !== 'ready') return;
  const model = m.sidecars.model;
  if (typeof model !== 'string') {
    fallback(m, frame, typeof model === 'object' ? model.unreadable : 'no GLB was exported');
    return;
  }
  renderMesh(m, frame, model);
});
