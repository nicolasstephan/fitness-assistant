import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { groupForMuscle } from "./data/muscle-groups.js";

const DRACO_PATH = new URL("../vendor/three/examples/jsm/libs/draco/gltf/", import.meta.url).href;

const COLORS = {
  base: 0xc4b5ad,
  primary: 0xe03131,
  secondary: 0xf59f00,
  selected: 0x1c7ed6,
  skeleton: 0xece4d2,
};

/**
 * 3D muscle viewer. Highlights are expressed in muscle-group ids (see data/muscle-groups.js).
 */
export class MuscleViewer {
  constructor(container) {
    this.container = container;
    this.muscleMeshes = [];
    this.highlight = { primary: new Set(), secondary: new Set() };
    this.selected = null; // mesh
    this.xray = true; // default: x-ray on, skeleton off
    this.skeletonVisible = false;
    this.insets = { top: 0, bottom: 0 }; // px of the stage covered by floating UI
    this.onPick = () => {};

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.enablePan = false; // always orbit around the body's center
    this.controls.addEventListener("change", () => this.requestRender());
    this.controls.addEventListener("start", () => (this.anim = null)); // user takes over

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7f7a, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1.5, 2, 3);
    const rim = new THREE.DirectionalLight(0xffffff, 0.9);
    rim.position.set(-1.5, 1, -3);
    this.scene.add(key, rim);

    const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0, ...extra });
    this.materials = {
      base: mat(COLORS.base),
      primary: mat(COLORS.primary, { emissive: 0x4a0000 }),
      secondary: mat(COLORS.secondary, { emissive: 0x3a2000 }),
      selected: mat(COLORS.selected, { emissive: 0x002050 }),
      skeleton: mat(COLORS.skeleton, { roughness: 0.8 }),
    };

    this.model = new THREE.Group();
    this.scene.add(this.model);

    new ResizeObserver(() => this.resize()).observe(container);
    this.setupPicking();
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  async load(musclesUrl, skeletonUrl, onProgress = () => {}) {
    const draco = new DRACOLoader().setDecoderPath(DRACO_PATH);
    const loader = new GLTFLoader().setDRACOLoader(draco);
    const progress = { m: 0, s: 0 };
    const report = () => onProgress((progress.m * 0.6 + progress.s * 0.4));
    const track = (key) => (e) => {
      if (e.total) progress[key] = e.loaded / e.total;
      report();
    };

    const [muscles, skeleton] = await Promise.all([
      loader.loadAsync(musclesUrl, track("m")),
      loader.loadAsync(skeletonUrl, track("s")),
    ]);

    muscles.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.userData.group = groupForMuscle(o.userData.muscle)?.id ?? null;
      o.material = this.materials.base;
      o.renderOrder = 1;
      this.muscleMeshes.push(o);
    });
    skeleton.scene.traverse((o) => {
      if (o.isMesh) o.material = this.materials.skeleton;
    });
    this.skeleton = skeleton.scene;
    this.skeleton.visible = this.skeletonVisible;
    this.model.add(skeleton.scene, muscles.scene);

    // center on origin, scale to ~1.8 units tall
    const box = new THREE.Box3().setFromObject(this.model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = 1.8 / size.y;
    this.model.scale.setScalar(s);
    this.model.position.copy(center).multiplyScalar(-s);
    this.height = 1.8;

    this.setView("front", false);
    this.applyMaterials();
  }

  setView(view, animate = true) {
    const angles = { front: 0, back: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 };
    const to = new THREE.Spherical(this.fitDistance(), Math.PI / 2 - 0.05, angles[view] ?? 0);
    this.controls.target.set(0, 0, 0);
    if (!animate) {
      this.camera.position.setFromSpherical(to);
      this.controls.update();
      this.requestRender();
      return;
    }
    const from = new THREE.Spherical().setFromVector3(this.camera.position);
    // rotate the short way round
    let dTheta = (to.theta - from.theta) % (2 * Math.PI);
    if (dTheta > Math.PI) dTheta -= 2 * Math.PI;
    if (dTheta < -Math.PI) dTheta += 2 * Math.PI;
    to.theta = from.theta + dTheta;
    this.anim = { from, to, t0: performance.now(), duration: 600 };
  }

  /**
   * Floating UI covers `top` / `bottom` px of the stage: the body is fitted into the free band
   * between them and centered there (view offset), and the camera eases to the new distance.
   */
  setInsets(top, bottom) {
    if (Math.abs(top - this.insets.top) < 2 && Math.abs(bottom - this.insets.bottom) < 2) return;
    this.insets = { top, bottom };
    this.resize();
    if (!this.height) return;
    const from = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    const to = from.clone();
    to.radius = this.fitDistance();
    this.anim = { from, to, t0: performance.now(), duration: 300 };
  }

  fitDistance() {
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const h = this.container.clientHeight;
    const free = h ? Math.max(0.35, (h - this.insets.top - this.insets.bottom) / h) : 1;
    const fitH = (this.height * 1.08) / 2 / Math.tan(vFov / 2) / free;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const fitW = (this.height * 0.5) / 2 / Math.tan(hFov / 2);
    return Math.max(fitH, fitW);
  }

  setHighlight(primary = [], secondary = []) {
    this.highlight.primary = new Set(primary);
    this.highlight.secondary = new Set(secondary.filter((g) => !this.highlight.primary.has(g)));
    this.applyMaterials();
  }

  setSelected(mesh) {
    this.selected = mesh;
    this.applyMaterials();
  }

  setXray(on) {
    this.xray = on;
    this.applyMaterials();
  }

  setSkeletonVisible(on) {
    this.skeletonVisible = on;
    if (this.skeleton) this.skeleton.visible = on;
    this.requestRender();
  }

  /**
   * Color muscle groups individually (Map groupId -> css hex), e.g. a weekly-volume heatmap.
   * Overrides the primary/secondary highlight while set; pass null to go back.
   */
  setGroupColors(colors) {
    this.groupColors = colors;
    this.applyMaterials();
  }

  colorMaterial(hex) {
    if (!hex) return null;
    this.colorMaterials ??= new Map();
    if (!this.colorMaterials.has(hex)) {
      this.colorMaterials.set(hex, new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: 0.65, metalness: 0 }));
    }
    return this.colorMaterials.get(hex);
  }

  applyMaterials() {
    const { base, secondary } = this.materials;
    // x-ray: unhighlighted muscles almost invisible, secondary ones see-through so primary ones stay visible
    for (const [mat, opacity] of [[base, 0.12], [secondary, 0.45]]) {
      mat.transparent = this.xray;
      mat.opacity = this.xray ? opacity : 1;
      mat.depthWrite = !this.xray;
      mat.needsUpdate = true;
    }

    for (const m of this.muscleMeshes) {
      const g = m.userData.group;
      if (m === this.selected) m.material = this.materials.selected;
      else if (this.groupColors) m.material = (g && this.colorMaterial(this.groupColors.get(g))) || base;
      else if (g && this.highlight.primary.has(g)) m.material = this.materials.primary;
      else if (g && this.highlight.secondary.has(g)) m.material = this.materials.secondary;
      else m.material = base;
      m.renderOrder = m.material === base ? 2 : m.material === secondary ? 1 : 0;
    }
    this.requestRender();
  }

  setupPicking() {
    const el = this.renderer.domElement;
    const raycaster = new THREE.Raycaster();
    let down = null;
    el.addEventListener("pointerdown", (e) => (down = { x: e.clientX, y: e.clientY }));
    el.addEventListener("pointerup", (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      const r = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, this.camera);
      // in x-ray mode, only highlighted muscles are pickable
      const targets = this.xray ? this.muscleMeshes.filter((m) => m.material !== this.materials.base) : this.muscleMeshes;
      const hit = raycaster.intersectObjects(targets, false)[0];
      this.onPick(hit ? hit.object : null);
    });
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // shift the image so the body's center sits in the middle of the uncovered band
    const shift = Math.round((this.insets.bottom - this.insets.top) / 2);
    if (shift) this.camera.setViewOffset(w, h, 0, shift, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  requestRender() {
    this.needsRender = true;
  }

  tick() {
    // damping keeps emitting "change" while the camera settles; render only when something changed
    if (this.anim) {
      const { from, to, t0, duration } = this.anim;
      const t = Math.min(1, (performance.now() - t0) / duration);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; // ease in-out
      const s = new THREE.Spherical(
        from.radius + (to.radius - from.radius) * e,
        from.phi + (to.phi - from.phi) * e,
        from.theta + (to.theta - from.theta) * e,
      );
      this.camera.position.setFromSpherical(s).add(this.controls.target);
      this.requestRender();
      if (t === 1) this.anim = null;
    }
    this.controls.update();
    if (!this.needsRender) return;
    this.needsRender = false;
    this.renderer.render(this.scene, this.camera);
  }
}
