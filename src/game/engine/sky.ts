import * as THREE from 'three';

export const SKY = {
  top: new THREE.Color('#5d8fc9'),
  horizon: new THREE.Color('#e9dcbc'),
  fog: new THREE.Color('#c9cfae'),
  sunDir: new THREE.Vector3(-0.55, 0.42, -0.72).normalize(),
};

/** Gradient sky dome with a soft sun glow; follows the camera. */
export function createSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(400, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: SKY.top },
      uHorizon: { value: SKY.horizon },
      uFog: { value: SKY.fog },
      uSun: { value: SKY.sunDir },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `
      uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uFog; uniform vec3 uSun; varying vec3 vDir;
      void main(){
        float h = vDir.y;
        vec3 c = mix(uHorizon, uTop, smoothstep(0.0, 0.55, h));
        c = mix(uFog, c, smoothstep(-0.05, 0.12, h));
        float s = max(dot(normalize(vDir), uSun), 0.0);
        c += vec3(1.0, 0.85, 0.6) * (pow(s, 600.0) * 2.5 + pow(s, 12.0) * 0.25);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

export function createLights(scene: THREE.Scene) {
  const hemi = new THREE.HemisphereLight('#d8e8ff', '#5b6a35', 1.7);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffe6c4', 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -26;
  s.right = 26;
  s.top = 26;
  s.bottom = -26;
  s.near = 1;
  s.far = 120;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  return { hemi, sun };
}
