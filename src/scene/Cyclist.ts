import { CanvasTexture, Mesh, PlaneGeometry, ShaderMaterial, type PerspectiveCamera, Vector3 } from 'three';

const TEX = 256;
/** Rider and bicycle height in world units, and how fast they ride. */
const SIZE = 4.2;
const SPEED = 1.15;

/**
 * A small figure riding the track, as in the photograph: drawn as a silhouette
 * on a canvas each frame, so the legs pedal and the scarf streams in the actual
 * wind at the rider's position.
 */
export class Cyclist {
  readonly mesh: Mesh;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: CanvasTexture;
  private readonly material: ShaderMaterial;
  private readonly geometry = new PlaneGeometry(1, 1);
  private readonly pos = new Vector3();
  /** Smoothed apparent wind on the scarf, in sprite space. */
  private scarf = { x: -1, y: 0.1 };

  constructor(
    private readonly path: (x: number) => number,
    private readonly height: (x: number, z: number) => number,
    private readonly span: [number, number],
  ) {
    this.canvas.width = TEX;
    this.canvas.height = TEX;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas for the cyclist.');
    this.ctx = ctx;
    this.texture = new CanvasTexture(this.canvas);
    this.material = new ShaderMaterial({
      glslVersion: '300 es' as never,
      transparent: true,
      depthWrite: false,
      uniforms: { uMap: { value: this.texture }, uRight: { value: new Vector3(1, 0, 0) }, uUp: { value: new Vector3(0, 1, 0) }, uCentre: { value: this.pos }, uSize: { value: SIZE } },
      vertexShader: /* glsl */ `
        uniform vec3 uRight;
        uniform vec3 uUp;
        uniform vec3 uCentre;
        uniform float uSize;
        out vec2 vUv;
        void main() {
          vUv = uv;
          // stands upright on the ground, turned to face the viewer
          vec3 p = uCentre + uRight * position.x * uSize + vec3(0.0, 1.0, 0.0) * (position.y + 0.47) * uSize;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        in vec2 vUv;
        uniform sampler2D uMap;
        out vec4 outColor;
        void main() {
          vec4 c = texture(uMap, vUv);
          if (c.a < 0.01) discard;
          outColor = c;
        }`,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }

  /** Position along the track at a time, looping across the frame. */
  update(time: number, camera: PerspectiveCamera, wind: (x: number, z: number) => [number, number]): void {
    const [a, b] = this.span;
    const travel = (time * SPEED) % (b - a);
    const x = a + travel;
    const z = this.path(x);
    this.pos.set(x, this.height(x, z) - 0.02, z);
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    right.y = 0;
    right.normalize();
    this.material.uniforms.uRight.value.copy(right);
    // the scarf streams with the wind the rider feels: the real wind, minus the rider's own motion
    const [wu, wv] = wind(x, z);
    const ax = wu - SPEED;
    const ay = Math.abs(wv) * 0.15 + 0.4;
    const k = 0.08;
    this.scarf.x += (ax - this.scarf.x) * k;
    this.scarf.y += (ay - this.scarf.y) * k;
    this.draw(time);
    this.texture.needsUpdate = true;
  }

  private draw(time: number): void {
    const g = this.ctx;
    const s = TEX;
    g.clearRect(0, 0, s, s);
    g.save();
    g.scale(s / 100, s / 100);
    // soft shadow straight below: the sun is high
    g.fillStyle = 'rgba(10, 30, 8, 0.38)';
    g.beginPath();
    g.ellipse(50, 97, 26, 2.6, 0, 0, Math.PI * 2);
    g.fill();
    const ink = '#1d2a25';
    const crank = time * 5.2;
    // wheels
    g.strokeStyle = ink;
    g.lineWidth = 1.5;
    for (const cx of [32, 68]) {
      g.beginPath();
      g.arc(cx, 84, 12, 0, Math.PI * 2);
      g.stroke();
    }
    // frame
    g.lineWidth = 1.7;
    g.strokeStyle = '#21423a';
    g.beginPath();
    g.moveTo(32, 84);
    g.lineTo(46, 84);
    g.lineTo(42, 66);
    g.lineTo(62, 66);
    g.lineTo(68, 84);
    g.moveTo(46, 84);
    g.lineTo(60, 66);
    g.moveTo(42, 66);
    g.lineTo(40, 62);
    g.moveTo(62, 66);
    g.lineTo(60, 58);
    g.lineTo(64, 57);
    g.stroke();
    // legs, pedalling
    const pedal = (phase: number) => [46 + Math.cos(crank + phase) * 5, 84 + Math.sin(crank + phase) * 5];
    g.strokeStyle = '#15191a';
    g.lineWidth = 3.4;
    g.lineCap = 'round';
    for (const ph of [0, Math.PI]) {
      const [px, py] = pedal(ph);
      const kx = (41 + px) / 2 + 5;
      const ky = (60 + py) / 2 - 3;
      g.beginPath();
      g.moveTo(41, 60);
      g.quadraticCurveTo(kx, ky, px, py);
      g.stroke();
    }
    // body: white shirt, leaning forward to the bars
    g.fillStyle = '#f2f1ec';
    g.beginPath();
    g.moveTo(39, 61);
    g.quadraticCurveTo(40, 46, 47, 40);
    g.lineTo(52, 42);
    g.quadraticCurveTo(48, 52, 45, 61);
    g.closePath();
    g.fill();
    // arm to the handlebar
    g.strokeStyle = '#e7d6c3';
    g.lineWidth = 2.2;
    g.beginPath();
    g.moveTo(49, 44);
    g.quadraticCurveTo(57, 50, 62, 57);
    g.stroke();
    // head and hair
    g.fillStyle = '#e6c9ad';
    g.beginPath();
    g.arc(50, 36, 4.2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1b1514';
    g.beginPath();
    g.arc(49.2, 34.6, 4.4, Math.PI * 0.9, Math.PI * 2.15);
    g.fill();
    // scarf: a long ribbon from the neck, rippling along its length
    const len = 26 + Math.min(10, Math.hypot(this.scarf.x, this.scarf.y) * 2);
    const dirX = Math.sign(this.scarf.x || -1);
    g.strokeStyle = '#c47c45';
    g.lineWidth = 2.6;
    g.beginPath();
    g.moveTo(50, 41);
    for (let i = 1; i <= 12; i++) {
      const u = i / 12;
      const wave = Math.sin(time * 9 - u * 7) * 2.4 * u;
      g.lineTo(50 + dirX * u * len, 41 - u * this.scarf.y * 6 + wave);
    }
    g.stroke();
    g.restore();
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
    this.geometry.dispose();
  }
}
